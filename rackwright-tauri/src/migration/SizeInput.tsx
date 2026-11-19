// A number box that keeps what is being typed and tells the parent only about valid values.
import { useEffect, useState } from "react";
import { v } from "../theme";
import { parseSize } from "./fit";

export const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 6px", fontSize: 12 } as const;

export default function SizeInput({ value, whole, width = 64, label, blankKeeps, onChange }: { value: number | undefined; whole: boolean; width?: number; label: string; blankKeeps?: boolean; onChange: (n: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    const cur = parseSize(text, whole);
    if (cur !== null && cur !== value) setText(value === undefined ? "" : String(value)); // changed from outside
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="text" inputMode="decimal" aria-label={label} style={{ ...inp, width, textAlign: "right" }} value={text}
      onBlur={() => { if (blankKeeps && parseSize(text, whole) === undefined) setText(value === undefined ? "" : String(value)); }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseSize(e.target.value, whole);
        if (n !== null && !(blankKeeps && n === undefined)) onChange(n);
      }} />
  );
}
