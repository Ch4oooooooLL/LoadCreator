import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Small hover / focus / click info affordance for parameters whose meaning is
 * not obvious. Shows a speech-bubble with a short definition (and optional
 * longer explanation) so the form stays compact while remaining self-documenting.
 */
export default function InfoTip({
  text,
  title,
  label = "?",
}: {
  text: ReactNode;
  title?: string;
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
      {open && (
        <span className="infoTipBubble" role="tooltip">
          {title && <b>{title}</b>}
          <span>{text}</span>
        </span>
      )}
    </span>
  );
}
