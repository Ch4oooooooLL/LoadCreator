import { useEffect, useRef, useState } from "react";

interface NumericInputProps {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  placeholder?: string;
}

/**
 * Free-form numeric cell. Keeps the raw text while focused so the user can type
 * intermediate states such as "-", "1." or "0.15" without the value snapping
 * back to 0 (a known pitfall of directly controlled number inputs).
 */
export default function NumericInput({ value, onCommit, className, placeholder }: NumericInputProps) {
  const [text, setText] = useState(() => String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      className={className ? `numberInput ${className}` : "numberInput"}
      value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const trimmed = next.trim();
        if (trimmed === "") return;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) onCommit(parsed);
      }}
      onBlur={() => {
        focused.current = false;
        const trimmed = text.trim();
        const parsed = trimmed === "" ? 0 : Number(trimmed);
        if (!Number.isFinite(parsed)) {
          setText(String(value));
          return;
        }
        setText(String(parsed));
        onCommit(parsed);
      }}
    />
  );
}
