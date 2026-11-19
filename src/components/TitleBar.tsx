import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "@/lib/loadDeckApi";
import type { ModuleDescriptor } from "@/lib/caseApi";
import { CATEGORY_LABELS, STATUS_LABELS, moduleMeta } from "@/app/moduleRegistry";
import { SaveIcon, SearchIcon, UploadIcon } from "@/components/Icons";

interface TitleBarProps {
  activeId: string;
  activeModule?: ModuleDescriptor;
  templateBusy?: boolean;
  onOpenHome: () => void;
  onOpenPalette: () => void;
  onImportTemplate: () => void;
  onExportTemplate: () => void;
}

export default function TitleBar({
  activeId,
  activeModule,
  templateBusy,
  onOpenHome,
  onOpenPalette,
  onImportTemplate,
  onExportTemplate,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      appWindow
        .isMaximized()
        .then((value) => { if (!disposed) setMaximized(value); })
        .catch(() => {});
    };

    sync();
    appWindow
      .onResized(sync)
      .then((fn) => { if (disposed) fn(); else unlisten = fn; })
      .catch(() => {});

    return () => { disposed = true; unlisten?.(); };
  }, [desktop]);

  const run = useCallback((action: "minimize" | "toggleMaximize" | "close") => {
    if (!desktop) return;
    void getCurrentWindow()[action]();
  }, [desktop]);

  const meta = activeModule ? moduleMeta(activeModule.id) : null;

  return (
    <header className={"appTopBar" + (maximized ? " isMaximized" : "")}>
      <div className="topBarBrand">
        <button type="button" className="topBarBrandBtn" onClick={onOpenHome} title="返回工具箱主页">
          <span className="topBarLogo">LC</span>
          <span className="topBarName">LoadCreator</span>
          <span className="topBarVer">2.0</span>
        </button>
      </div>

      <div className="topBarDrag" data-tauri-drag-region={desktop ? "" : undefined}>
        <div className="topBarBreadcrumb" data-tauri-drag-region={desktop ? "" : undefined}>
          {activeId === "home" || !activeModule ? (
            <span className="crumbCurrent">CAE 工况工具箱 · 离线求解器增量 Deck 生成器</span>
          ) : (
            <>
              <span className="crumbGroup">{CATEGORY_LABELS[activeModule.category] ?? activeModule.category}</span>
              <span className="crumbSep">/</span>
              <span className="crumbCurrent">{activeModule.title}</span>
              {meta && <span className={"solverPill " + activeModule.solver}>{meta.solTag}</span>}
              <span className={"statusPill " + activeModule.status}>
                {STATUS_LABELS[activeModule.status] ?? activeModule.status}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="topBarRight">
        <div className="topBarTemplateGroup" role="group" aria-label="参数模板导入导出">
          <button
            type="button"
            className="topBarToolBtn"
            disabled={templateBusy}
            onClick={onImportTemplate}
            title="从 XML / JSON 模板文件导入所有模块的填写值与选择项"
          >
            <UploadIcon size={13} />
            <span>导入模板</span>
          </button>
          <button
            type="button"
            className="topBarToolBtn"
            disabled={templateBusy}
            onClick={onExportTemplate}
            title="将当前所有模块的填写值与选择项导出为 XML / JSON 模板"
          >
            <SaveIcon size={13} />
            <span>导出模板</span>
          </button>
        </div>

        <button type="button" className="topBarSearchBtn" onClick={onOpenPalette} title="快速查找并启动工具 (Ctrl+K)">
          <SearchIcon size={13} />
          <span>启动工具</span>
          <kbd>Ctrl K</kbd>
        </button>

        {!desktop && <span className="webModePill" title="当前在浏览器预览模式，生成与导出需由 Tauri 桌面端执行">Web 预览</span>}

        {desktop && (
          <div className="appWindowControls">
            <button type="button" aria-label="最小化" title="最小化" onClick={() => run("minimize")}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0 5h10" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
            <button type="button" aria-label={maximized ? "向下还原" : "最大化"} title={maximized ? "向下还原" : "最大化"} onClick={() => run("toggleMaximize")}>
              {maximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1">
                  <path d="M2.5 2.5V1.5h6v6h-1" />
                  <rect x="1.5" y="3.5" width="5" height="5" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1">
                  <rect x="0.5" y="0.5" width="9" height="9" />
                </svg>
              )}
            </button>
            <button type="button" className="danger" aria-label="关闭" title="关闭" onClick={() => run("close")}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
