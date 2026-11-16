import { useMemo, useState } from "react";
import RackFrame from "./RackFrame";
import { GENERIC_MAX_U, GENERIC_MIN_U, KINDS, RACK_MODELS, RackKind, RackModel, dimsText, kindLabel } from "./racks";
import { RAIL, RW } from "./types";

const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "4px 6px" } as const;

export function FramePreview({ kind }: { kind: string }) {
  const w = RW + 2 * RAIL, h = 640;
  return (
    <svg width={38} height={46} viewBox={`0 0 ${w} ${h}`} style={{ flex: "none" }}>
      <rect x={0} y={0} width={w} height={h} rx={14} fill="#1d2025" stroke="#3a3d42" strokeWidth={8} />
      <RackFrame kind={kind} x={0} y={0} w={w} h={h} />
      <rect x={RAIL - 3} y={46} width={RW + 6} height={h - 70} fill="#0b0c0e" stroke="#2c2f35" strokeWidth={4} />
    </svg>
  );
}

export interface PickResult { model: RackModel; u: number; name: string }

/** Modal list of rack models. Enter picks, Esc cancels. */
export default function RackPicker({ title, okLabel, defaultName, onPick, onCancel }: {
  title: string; okLabel: string; defaultName: string; onPick: (r: PickResult) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<RackKind | "">("");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState("apc-ar3100");
  const [gu, setGu] = useState("42");
  const [name, setName] = useState(defaultName);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return RACK_MODELS.filter((m) => (!kind || m.kind === kind) &&
      words.every((w) => `${m.name} ${m.u}u ${kindLabel(m.kind)}`.toLowerCase().includes(w)));
  }, [kind, q]);
  const sel = RACK_MODELS.find((m) => m.id === selId);
  const chosen = sel && list.includes(sel) ? sel : list[0];
  const guN = parseInt(gu);
  const guOk = guN >= GENERIC_MIN_U && guN <= GENERIC_MAX_U;
  const canOk = !!chosen && (!chosen.generic || guOk);

  const ok = () => {
    if (!chosen || !canOk) return;
    onPick({ model: chosen, u: chosen.generic ? guN : chosen.u, name: name.trim() || defaultName });
  };
  const move = (dir: number) => {
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((m) => m.id === chosen?.id));
    const n = list[Math.min(list.length - 1, Math.max(0, i + dir))];
    setSelId(n.id); if (n.generic) setGu(String(n.u));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        else if (e.key === "Enter") { e.preventDefault(); ok(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      }}>
      <div style={{ background: "#1b1d21", padding: 14, borderRadius: 6, width: 640, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", border: "1px solid #3a3d42", color: "#e6e8eb", fontSize: 13 }}>
        <div style={{ display: "flex", marginBottom: 10 }}>
          <b style={{ flex: 1, fontSize: 14 }}>{title}</b>
          <button style={{ ...btn, marginRight: 0, padding: "1px 8px" }} onClick={onCancel}>x</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...inp, flex: 1, minWidth: 160 }} autoFocus placeholder="Search model or size" value={q} onChange={(e) => setQ(e.target.value)} />
          <select style={inp} value={kind} onChange={(e) => setKind(e.target.value as RackKind | "")}>
            <option value="">All kinds</option>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
        <div style={{ overflow: "auto", border: "1px solid #2c2f35", borderRadius: 4, minHeight: 200, flex: 1 }}>
          {list.length === 0 && <div style={{ padding: 12, opacity: 0.7 }}>No racks match. Try a shorter search.</div>}
          {list.map((m) => {
            const on = m.id === chosen?.id;
            return (
              <div key={m.id} onClick={() => { setSelId(m.id); if (m.generic) setGu(String(m.u)); }} onDoubleClick={ok}
                ref={(el) => { if (el && on) el.scrollIntoView({ block: "nearest" }); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", cursor: "pointer", background: on ? "#2a3a52" : "transparent", borderBottom: "1px solid #22252b" }}>
                <FramePreview kind={m.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{m.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.65 }}>{kindLabel(m.kind)}{m.approx ? " (size approximate)" : ""}</div>
                </div>
                <div style={{ width: 90, textAlign: "right", fontSize: 12 }}>{m.generic ? "4-52U" : `${m.u}U`}</div>
                <div style={{ width: 110, textAlign: "right", fontSize: 12, opacity: 0.8 }}>{m.generic ? "" : m.width_mm && m.depth_mm ? `${m.width_mm} x ${m.depth_mm}` : dimsText(m.width_mm, m.depth_mm)}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, flex: 1, minWidth: 160 }}>Rack name<br />
            <input style={{ ...inp, width: "100%", boxSizing: "border-box" }} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {chosen?.generic && (
            <label style={{ fontSize: 12 }}>Height (U)<br />
              <input type="number" min={GENERIC_MIN_U} max={GENERIC_MAX_U} style={{ ...inp, width: 70, borderColor: guOk ? "#3a3d42" : "#f85149" }} value={gu} onChange={(e) => setGu(e.target.value)} /></label>
          )}
          <span>
            <button style={btn} onClick={onCancel}>Cancel</button>
            <button style={{ ...btn, marginRight: 0, opacity: canOk ? 1 : 0.5 }} disabled={!canOk} onClick={ok}>{okLabel}</button>
          </span>
        </div>
        {chosen?.generic && !guOk && <div style={{ fontSize: 12, color: "#f85149", marginTop: 4 }}>Pick a height from {GENERIC_MIN_U} to {GENERIC_MAX_U}U.</div>}
      </div>
    </div>
  );
}
