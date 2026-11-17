import { v } from "../theme";
import { useEffect, useRef, useState } from "react";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;

export interface ExportItem { label: string; run: () => void; hint?: string; disabled?: boolean }

/** "Export" toolbar dropdown. The panel is position:fixed so the toolbar's overflow:hidden does not clip it. */
export default function ExportMenu({ items }: { items: ExportItem[] }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", close); };
  }, [at]);
  return (
    <>
      <button ref={ref} style={btn} title="Export this rack" onClick={() => {
        const b = ref.current!.getBoundingClientRect();
        setAt(at ? null : { x: b.left, y: b.bottom + 2 });
      }}>Export ▾</button>
      {at && (
        <div onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", left: at.x, top: at.y, zIndex: 50, background: v("panel"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: 4, minWidth: 190, boxShadow: `0 4px 14px ${v("shadow")}` }}>
          {items.map((it) => (
            <button key={it.label} disabled={it.disabled} title={it.hint}
              style={{ ...btn, display: "block", width: "100%", textAlign: "left", marginRight: 0, border: "none", background: "transparent", opacity: it.disabled ? 0.5 : 1, cursor: it.disabled ? "default" : "pointer" }}
              onClick={() => { setAt(null); it.run(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </>
  );
}
