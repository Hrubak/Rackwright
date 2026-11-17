import { v } from "./theme";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem { label: string; run?: () => void; shortcut?: string; disabled?: boolean; hint?: string; checked?: boolean; items?: MenuItem[] }
export const SEP: MenuItem = { label: "-" };

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
const flat = { ...btn, background: "transparent", border: "none", marginRight: 0 } as const;
const panel = { background: v("panel"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: 4, minWidth: 190, boxShadow: `0 4px 14px ${v("shadow")}` } as const;

function Panel({ items, close, style }: { items: MenuItem[]; close: () => void; style: React.CSSProperties }) {
  return (
    <div onMouseDown={(e) => e.stopPropagation()} style={{ ...panel, zIndex: 60, ...style }}>
      {items.map((it, i) => it === SEP || it.label === "-"
        ? <div key={i} style={{ height: 1, background: v("border"), margin: "4px 0" }} />
        : <Row key={it.label + i} it={it} close={close} />)}
    </div>
  );
}

function Row({ it, close }: { it: MenuItem; close: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button disabled={it.disabled} title={it.hint}
        style={{ ...flat, display: "flex", width: "100%", textAlign: "left", alignItems: "center", gap: 8, opacity: it.disabled ? 0.5 : 1, cursor: it.disabled ? "default" : "pointer" }}
        onClick={() => { if (it.items) return; close(); it.run?.(); }}>
        <span style={{ width: 14 }}>{it.checked ? "✓" : ""}</span>
        <span style={{ flex: 1 }}>{it.label}</span>
        {it.shortcut && <span style={{ color: v("text-dim"), marginLeft: 16 }}>{it.shortcut}</span>}
        {it.items && <span style={{ color: v("text-dim") }}>▸</span>}
      </button>
      {it.items && open && <Panel items={it.items} close={close} style={{ position: "absolute", left: "100%", top: -5 }} />}
    </div>
  );
}

/** Button with a dropdown. The panel is position:fixed so overflow:hidden parents do not clip it. */
export function DropButton({ label, items, title }: { label: ReactNode; items: MenuItem[]; title?: string }) {
  const [at, setAt] = useState<{ x: number; y: number; r?: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", esc, true); // capture + stop: Escape must not also clear the selection
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", esc, true); };
  }, [at]);
  return (
    <>
      <button ref={ref} style={btn} title={title} onClick={() => {
        const b = ref.current!.getBoundingClientRect();
        setAt(at ? null : { x: b.left, y: b.bottom + 2, r: b.left + 240 > window.innerWidth ? window.innerWidth - b.right : undefined });
      }}>{label}</button>
      {at && <Panel items={items} close={() => setAt(null)} style={{ position: "fixed", top: at.y, ...(at.r != null ? { right: at.r } : { left: at.x }) }} />}
    </>
  );
}

export function MenuBar({ menus }: { menus: { label: string; items: MenuItem[] }[] }) {
  const [cur, setCur] = useState<{ i: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!cur) return;
    const close = () => setCur(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", esc, true); // capture + stop: Escape must not also clear the selection
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", esc, true); };
  }, [cur]);
  const show = (i: number, el: HTMLElement) => { const b = el.getBoundingClientRect(); setCur({ i, x: b.left, y: b.bottom + 2 }); };
  return (
    <>
      {menus.map((m, i) => (
        <button key={m.label} style={{ ...flat, background: cur?.i === i ? v("hover") : "transparent" }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => cur?.i === i ? setCur(null) : show(i, e.currentTarget)}
          onMouseEnter={(e) => { if (cur && cur.i !== i) show(i, e.currentTarget); }}>{m.label}</button>
      ))}
      {cur && <Panel items={menus[cur.i].items} close={() => setCur(null)} style={{ position: "fixed", left: cur.x, top: cur.y }} />}
    </>
  );
}
