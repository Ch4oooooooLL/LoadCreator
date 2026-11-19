import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface TooltipMeta {
  title?: string;
  keyword?: string;
  summary?: string;
  text: ReactNode;
}

function TooltipPortal({
  anchorEl,
  open,
  title,
  keyword,
  summary,
  text,
}: TooltipMeta & {
  anchorEl: HTMLElement | null;
  open: boolean;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; ready: boolean }>({
    left: 0,
    top: 0,
    ready: false,
  });

  const reposition = useCallback(() => {
    if (!anchorEl || !bubbleRef.current) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const bubbleRect = bubbleRef.current.getBoundingClientRect();
    const margin = 10;
    const gap = 8;

    let left = anchorRect.left + anchorRect.width / 2 - bubbleRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - bubbleRect.width - margin));

    let top = anchorRect.bottom + gap;
    if (top + bubbleRect.height > window.innerHeight - margin) {
      const aboveTop = anchorRect.top - bubbleRect.height - gap;
      if (aboveTop >= margin) {
        top = aboveTop;
      } else {
        top = Math.max(margin, window.innerHeight - bubbleRect.height - margin);
      }
    }
    setCoords({ left, top, ready: true });
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    reposition();
  }, [open, reposition, title, keyword, summary, text]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, reposition]);

  if (!open || !anchorEl || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={bubbleRef}
      className="infoTipPortalBubble"
      role="tooltip"
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        opacity: coords.ready ? 1 : 0,
      }}
    >
      {(title || keyword) && (
        <div className="infoTipPortalHead">
          {title && <b>{title}</b>}
          {keyword && <code>{keyword}</code>}
        </div>
      )}
      {summary && <div className="infoTipPortalSummary">{summary}</div>}
      {text && <div className="infoTipPortalBody">{text}</div>}
    </div>,
    document.body,
  );
}

/**
 * Small hover / focus / click info affordance (`?` dot) with viewport-safe portal bubble.
 */
export default function InfoTip({
  text,
  title,
  keyword,
  summary,
  label = "?",
}: TooltipMeta & {
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <span
      className="infoTip"
      ref={rootRef}
      tabIndex={0}
      role="button"
      aria-label={title ? `说明：${title}` : "参数说明"}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <span className="infoTipDot" aria-hidden="true">{label}</span>
      <TooltipPortal
        anchorEl={rootRef.current}
        open={open}
        title={title}
        keyword={keyword}
        summary={summary}
        text={text}
      />
    </span>
  );
}

/**
 * Wraps any option item / checkbox card / field label so hovering directly over
 * the control or its text displays the explanation bubble at the cursor position.
 */
export function HoverTipWrap({
  title,
  keyword,
  summary,
  text,
  className,
  children,
}: TooltipMeta & {
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  const showSoon = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), 110);
  };

  const hideNow = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      ref={wrapRef}
      className={className ? `hoverTipTarget ${className}` : "hoverTipTarget"}
      onMouseEnter={showSoon}
      onMouseLeave={hideNow}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={hideNow}
    >
      {children}
      <TooltipPortal
        anchorEl={wrapRef.current}
        open={open}
        title={title}
        keyword={keyword}
        summary={summary}
        text={text}
      />
    </div>
  );
}
