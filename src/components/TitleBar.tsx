import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "@/lib/loadDeckApi";

/**
 * 自绘窗口标题栏（decorations: false）。
 *
 * 这里刻意不放图标和名称：侧栏顶部已经有品牌区，标题栏再放一遍会重复。
 * 左侧 268px 保持与侧栏同色，让墨绿从窗口左上角一路贯通下去，
 * 因此这条栏只承担两件事——可拖动，以及承载窗口按钮。
 *
 * 拖拽交给 Tauri 内置的 data-tauri-drag-region（自带双击最大化），
 * 不手工调 startDragging，避免和原生拖拽抢同一个 mousedown。
 * 浏览器里（npm run dev）没有窗口控件，直接不渲染。
 */
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;
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
  }, []);

  const run = useCallback((action: "minimize" | "toggleMaximize" | "close") => {
    if (!isDesktop()) return;
    void getCurrentWindow()[action]();
  }, []);

  if (!isDesktop()) return null;

  return (
    <header
      className={"appTitleBar" + (maximized ? " isMaximized" : "")}
      data-tauri-drag-region
    >
      <div className="appTitleBarSpacer" data-tauri-drag-region />

      <div className="appWindowControls">
        <button type="button" aria-label="最小化" title="最小化" onClick={() => run("minimize")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button type="button" aria-label={maximized ? "向下还原" : "最大化"} title={maximized ? "向下还原" : "最大化"} onClick={() => run("toggleMaximize")}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M2.5 2.5V1.5h6v6h-1" />
              <rect x="1.5" y="3.5" width="5" height="5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button type="button" className="danger" aria-label="关闭" title="关闭" onClick={() => run("close")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
