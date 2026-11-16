import { useMemo, useState } from "react";
import { CATALOG, Tpl } from "./edit";
import type { Device } from "./types";

const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "4px 6px" } as const;
const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "5px 12px", marginLeft: 6, cursor: "pointer" } as const;
const TYPES = Array.from(new Set(CATALOG.map((t) => t.type))).sort();

/** Pick a catalog model to swap a device to. Same type by default. */
export default function ModelPicker({ dev, onPick, onCancel }: { dev: Device; onPick: (t: Tpl) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState(dev.type);
  const [sel, setSel] = useState<number | null>(null);
  const list = useMemo(() => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return CATALOG.map((c, i) => ({ c, i })).filter(({ c }) => {
      if (typeF && c.type !== typeF) return false;
      const hay = `${c.name} ${c.type} ${c.group || ""} ${c.model || ""}`.toLowerCase();
      return w.every((x) => hay.includes(x));
    }).slice(0, 200);
  }, [q, typeF]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
      <div style={{ background: "#1b1d21", padding: 14, borderRadius: 6, width: 480, border: "1px solid #3a3d42", fontSize: 12 }}>
        <div style={{ marginBottom: 6, opacity: 0.8 }}>Change the model of {dev.name}. Name, IP, notes, position and cables are kept.</div>
        <input style={{ ...inp, width: "100%", boxSizing: "border-box", marginBottom: 4 }} placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <select style={{ ...inp, width: "100%", marginBottom: 4 }} value={typeF} onChange={(e) => setTypeF(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <div style={{ height: 300, overflow: "auto", border: "1px solid #2c2f35" }}>
          {list.map(({ c, i }) => (
            <div key={i} onClick={() => setSel(i)} onDoubleClick={() => onPick(c)}
              style={{ padding: "4px 8px", borderBottom: "1px solid #24272c", cursor: "pointer", background: sel === i ? "#2a3a52" : undefined }}>
              {c.name} <span style={{ opacity: 0.55 }}>{c.u_size}U {c.type}{c.half ? " half" : ""}</span>
            </div>
          ))}
          {!list.length && <div style={{ padding: 10, opacity: 0.6 }}>Nothing matches.</div>}
        </div>
        <div style={{ marginTop: 8, textAlign: "right" }}>
          <button style={btn} onClick={onCancel}>Cancel</button>
          <button style={btn} disabled={sel == null} onClick={() => sel != null && onPick(CATALOG[sel])}>Change model</button>
        </div>
      </div>
    </div>
  );
}
