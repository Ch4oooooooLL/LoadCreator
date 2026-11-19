import { useMemo, useState } from "react";
import type { Diagnostic, PreviewResult } from "@/lib/caseApi";
import ModulePreview from "@/modules/previews/ModulePreview";
import type { Draft } from "@/lib/caseDrafts";
import { ActivityIcon, CheckIcon, CodeIcon, CopyIcon, DownloadIcon, PlayCheckIcon, ShieldAlertIcon } from "@/components/Icons";

export type InspectorTab = "visual" | "audit" | "deck";

interface InspectorPaneProps {
  activeId: string;
  solver: string;
  draft: Draft;
  preview: PreviewResult | null;
  stale: boolean;
  busy: boolean;
  tab: InspectorTab;
  gravityRowIndex?: number;
  onSelectGravityRow?: (index: number) => void;
  onTabChange: (tab: InspectorTab) => void;
  onValidate: () => void;
  onExport: () => void;
  onCopyText: (text: string, label: string) => void;
}

function DiagList({ items }: { items: Diagnostic[] }) {
  if (items.length === 0) return <p className="emptyMuted">校验通过，无错误或警告诊断。</p>;
  return (
    <ul className="diagList">
      {items.map((d, i) => (
        <li key={i} className={"diagItem " + d.severity}>
          <div className="diagHead">
            <span className="diagSev">{d.severity.toUpperCase()}</span>
            <code className="diagCode">{d.code}</code>
            {d.fieldPath && <span className="diagField">{d.fieldPath}</span>}
          </div>
          <p className="diagMsg">{d.message}</p>
          {d.hint && <small className="diagHint">{d.hint}</small>}
        </li>
      ))}
    </ul>
  );
}

export default function InspectorPane({
  activeId,
  solver,
  draft,
  preview,
  stale,
  busy,
  tab,
  gravityRowIndex = 0,
  onSelectGravityRow,
  onTabChange,
  onValidate,
  onExport,
  onCopyText,
}: InspectorPaneProps) {
  const [deckView, setDeckView] = useState<"deck" | "manifest">("deck");

  const errorCount = useMemo(
    () => preview?.diagnostics.filter((d) => d.severity === "error").length ?? 0,
    [preview],
  );
  const warnCount = useMemo(
    () => preview?.diagnostics.filter((d) => d.severity === "warning").length ?? 0,
    [preview],
  );
  const totalCards = useMemo(
    () => (preview ? Object.values(preview.summary.cardCounts).reduce((a, b) => a + b, 0) : 0),
    [preview],
  );

  const manifestPreview = useMemo(() => {
    if (!preview || !preview.femPreview) return "";
    return JSON.stringify(
      {
        schemaVersion: 2,
        caseKind: preview.kind,
        solver,
        externalReferences: preview.externalReferences,
        generatedIdMap: preview.idPlan,
        validationStatus: "generated",
      },
      null,
      2,
    );
  }, [preview, solver]);

  const codeText = deckView === "manifest" ? manifestPreview : preview?.femPreview ?? "";
  const codeLines = useMemo(() => (codeText ? codeText.split(/\r?\n/) : []), [codeText]);

  let statusTone = "idle";
  let statusText = "尚未执行求解器校验 · 当前显示前端实时预览";
  if (preview) {
    if (stale) {
      statusTone = "stale";
      statusText = "参数已修改 · 校验结果已过期，请重新校验";
    } else if (preview.summary.canExport) {
      statusTone = "pass";
      statusText = `校验通过 · ${preview.summary.lineCount} 行 · ${totalCards} 张卡片`;
    } else {
      statusTone = "error";
      statusText = `阻止导出 · ${errorCount} 项错误${warnCount ? ` · ${warnCount} 项警告` : ""}`;
    }
  }

  return (
    <aside className="inspectorPane" aria-label="工程实时检视器">
      <div className={"inspectorStatus " + statusTone}>
        <div className="inspectorStatusLeft">
          <span className="statusDot" />
          <span>{statusText}</span>
        </div>
        <div className="inspectorStatusActions">
          <button type="button" className="btnXs" disabled={busy} onClick={onValidate}>
            {busy ? "校验中…" : preview && !stale ? "重新校验" : "立即校验"}
          </button>
          {preview?.summary.canExport && !stale && (
            <button type="button" className="btnXs primary" disabled={busy} onClick={onExport}>
              <DownloadIcon size={12} /> 导出
            </button>
          )}
        </div>
      </div>

      <div className="inspectorTabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "visual"}
          className={"inspectorTab" + (tab === "visual" ? " active" : "")}
          onClick={() => onTabChange("visual")}
        >
          <ActivityIcon size={14} />
          <span>实时图形视图</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "audit"}
          className={"inspectorTab" + (tab === "audit" ? " active" : "")}
          onClick={() => onTabChange("audit")}
        >
          <ShieldAlertIcon size={14} />
          <span>诊断与台账</span>
          {preview && (
            <span className={"tabCounter " + (errorCount > 0 ? "err" : warnCount > 0 ? "warn" : "ok")}>
              {errorCount > 0 ? `${errorCount} 错` : warnCount > 0 ? `${warnCount} 警` : "PASS"}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "deck"}
          className={"inspectorTab" + (tab === "deck" ? " active" : "")}
          onClick={() => onTabChange("deck")}
        >
          <CodeIcon size={14} />
          <span>{solver === "radioss" ? ".rad Deck" : "FEM Deck"}</span>
          {preview?.summary.lineCount ? (
            <span className="tabCounter neutral">{preview.summary.lineCount}L</span>
          ) : null}
        </button>
      </div>

      <div className="inspectorBody">
        {tab === "visual" && (
          <ModulePreview
            activeId={activeId}
            draft={draft}
            gravityRowIndex={gravityRowIndex}
            onSelectGravityRow={onSelectGravityRow}
          />
        )}

        {tab === "audit" && (
          preview ? (
            <div className="auditWrap">
              <div className="kpiStrip4">
                <div><span>SOL / 类型</span><b>{preview.summary.sol ?? (solver === "radioss" ? "RAD" : "—")}</b></div>
                <div><span>子工况数</span><b>{preview.summary.subcaseCount}</b></div>
                <div><span>外部引用</span><b>{preview.externalReferences.length}</b></div>
                <div><span>分配 ID</span><b>{preview.idPlan.length}</b></div>
              </div>

              <div className="auditSection">
                <div className="auditSectionHead">
                  <h4>诊断信息</h4>
                  <span>{preview.diagnostics.length} 条</span>
                </div>
                <DiagList items={preview.diagnostics} />
              </div>

              <div className="auditSection">
                <div className="auditSectionHead">
                  <h4>外部实体引用</h4>
                  <span className="unverifiedTag">UNVERIFIED_EXTERNAL</span>
                </div>
                {preview.externalReferences.length === 0 ? (
                  <p className="emptyMuted">无外部实体引用。</p>
                ) : (
                  <table className="auditTable">
                    <thead>
                      <tr><th>类型</th><th>ID</th><th>说明 / 归属</th><th>状态</th></tr>
                    </thead>
                    <tbody>
                      {preview.externalReferences.map((r, i) => (
                        <tr key={i}>
                          <td><code>{r.kind}</code></td>
                          <td className="mono">{r.id}</td>
                          <td>{r.label || r.usedBy}</td>
                          <td><span className="statusPill warn">{r.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="auditSection">
                <div className="auditSectionHead">
                  <h4>确定性 ID 分配台账</h4>
                  <span>{preview.idPlan.length} 项</span>
                </div>
                {preview.idPlan.length === 0 ? (
                  <p className="emptyMuted">无自动分配实体。</p>
                ) : (
                  <table className="auditTable">
                    <thead>
                      <tr><th>实体族</th><th>逻辑键</th><th>分配 ID</th></tr>
                    </thead>
                    <tbody>
                      {preview.idPlan.map((a, i) => (
                        <tr key={i}>
                          <td><code>{a.kind}</code></td>
                          <td className="mono">{a.key}</td>
                          <td className="mono boldId">{a.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            <div className="inspectorEmpty">
              <PlayCheckIcon size={28} />
              <h4>尚未运行后端求解器校验</h4>
              <p>点击“立即校验”或按 Ctrl+Enter，调用 Rust 内核生成诊断、外部引用台账与 ID 计划。</p>
              <button type="button" className="primaryBtn" disabled={busy} onClick={onValidate}>
                立即校验参数
              </button>
            </div>
          )
        )}

        {tab === "deck" && (
          preview ? (
            <div className="deckWrap">
              <div className="deckToolbar">
                <div className="segControl">
                  <button
                    type="button"
                    className={"segBtn" + (deckView === "deck" ? " active" : "")}
                    onClick={() => setDeckView("deck")}
                  >
                    {solver === "radioss" ? "Radioss (.rad)" : "OptiStruct (.fem)"}
                  </button>
                  <button
                    type="button"
                    className={"segBtn" + (deckView === "manifest" ? " active" : "")}
                    onClick={() => setDeckView("manifest")}
                  >
                    Manifest (.json)
                  </button>
                </div>
                <button
                  type="button"
                  className="btnMini"
                  disabled={!codeText}
                  onClick={() => onCopyText(codeText, deckView === "manifest" ? "Manifest JSON" : "求解器 Deck")}
                >
                  <CopyIcon size={13} /> 复制文本
                </button>
              </div>

              {Object.keys(preview.summary.cardCounts).length > 0 && deckView === "deck" && (
                <div className="cardChips">
                  {Object.entries(preview.summary.cardCounts).map(([name, count]) => (
                    <span key={name} className="cardChip">{name} <b>×{count}</b></span>
                  ))}
                </div>
              )}

              {codeText ? (
                <div className="codeTerminal">
                  <div className="codeLines">
                    {codeLines.map((line, idx) => (
                      <div className="codeLine" key={idx}>
                        <span className="codeLn">{idx + 1}</span>
                        <span className="codeTxt">{line || " "}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="inspectorEmpty">
                  <ShieldAlertIcon size={26} />
                  <h4>存在阻止生成的错误</h4>
                  <p>请切换至“诊断与台账”修复 ERROR 级别问题后重新生成。</p>
                </div>
              )}
              <p className="deckFootNote">
                <CheckIcon size={12} /> 离线生成的增量文本（Generated）；导入 HyperMesh 2023.0 与求解需实机确认。
              </p>
            </div>
          ) : (
            <div className="inspectorEmpty">
              <CodeIcon size={28} />
              <h4>Deck 文本尚未生成</h4>
              <p>点击“校验 / 生成预览”即可查看 Rust 求解器生成器输出的完整文本与卡片统计。</p>
              <button type="button" className="primaryBtn" disabled={busy} onClick={onValidate}>
                生成 Deck 预览
              </button>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
