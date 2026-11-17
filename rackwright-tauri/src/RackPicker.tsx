import { v } from "./theme";
import { fmtDims } from "./units";
import { useSettings } from "./settings/context";
import { useMemo, useState } from "react";
import { GENERIC_MAX_U, GENERIC_MIN_U, KINDS, RACK_MODELS, RackKind, RackModel, kindLabel } from "./racks";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px" } as const;

/** Small icon for the picker list: the outline of each rack kind, with its height scaled to U (52U fills the box). */
export function FramePreview({ kind, u = 42 }: { kind: string; u?: number }) {
  const W = 38, H = 46, frame = v("icon-frame"), post = v("icon-post"), slot = v("icon-slot"), inside = v("row-hover");
  const h = Math.max(10, Math.round((Math.min(u, 52) / 52) * (H - 4))), w = 26;
  const x = (W - w) / 2, y = H - 2 - h, r = x + w, b = y + h;
  const slots = [];
  const step = Math.max(2, h / Math.max(2, Math.round(u / 4)));
  for (let yy = y + 3 + step; yy < b - 3; yy += step) slots.push(<line key={yy} x1={x + 4} x2={r - 4} y1={yy} y2={yy} stroke={slot} strokeWidth={0.8} />);
  let body;
  switch (kind) {
    case "open4":
      body = <><rect x={x + 3} y={y + 1} width={w - 6} height={h - 2} fill={inside} />{slots}
        <rect x={x} y={y} width={3} height={h} fill={post} /><rect x={r - 3} y={y} width={3} height={h} fill={post} />
        <rect x={x} y={y} width={w} height={2} fill={frame} /><rect x={x} y={b - 2} width={w} height={2} fill={frame} /></>;
      break;
    case "twopost":
      body = <>{slots}<rect x={x + 2} y={y} width={3} height={h} fill={post} /><rect x={r - 5} y={y} width={3} height={h} fill={post} />
        <rect x={x - 2} y={b - 2} width={9} height={2} fill={frame} /><rect x={r - 7} y={b - 2} width={9} height={2} fill={frame} /></>;
      break;
    case "wall":
      body = <><rect x={x - 3} y={y + 2} width={2} height={h - 4} fill={post} />
        <rect x={x} y={y} width={w} height={h} rx={2} fill={inside} stroke={frame} strokeWidth={1.4} />{slots}
        <rect x={r - 4} y={y + h / 2 - 3} width={2} height={6} rx={1} fill={post} /></>;
      break;
    case "desktop":
      body = <><rect x={x} y={y} width={w} height={h} rx={1.5} fill={inside} stroke={frame} strokeWidth={1.4} />{slots}
        <path d={`M${x + 5} ${y} v-3 h${w - 10} v3`} fill="none" stroke={post} strokeWidth={1.4} /></>;
      break;
    default: // cabinet
      body = <><rect x={x} y={y} width={w} height={h} rx={2} fill={inside} stroke={frame} strokeWidth={1.4} />{slots}
        <rect x={x} y={y} width={w} height={3} rx={1} fill={frame} /></>;
  }
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flex: "none" }}>{body}</svg>;
}

export interface PickResult { model: RackModel; u: number; name: string }

/** Modal list of rack models. Enter picks, Esc cancels. */
export default function RackPicker({ title, okLabel, defaultName, defaults, onPick, onCancel }: {
  title: string; okLabel: string; defaultName: string; defaults?: { model?: string; u?: number }; onPick: (r: PickResult) => void; onCancel: () => void;
}) {
  const units = useSettings().prefs.units ?? "mm";
  const [kind, setKind] = useState<RackKind | "">("");
  const [q, setQ] = useState("");
  const defModel = defaults?.model ? RACK_MODELS.find((m) => m.id === defaults.model) : undefined;
  const [selId, setSelId] = useState(defModel ? defModel.id : "apc-ar3100");
  const [gu, setGu] = useState(() => {
    if (defModel?.generic && typeof defaults?.u === "number" && Number.isFinite(defaults.u))
      return String(Math.min(GENERIC_MAX_U, Math.max(GENERIC_MIN_U, Math.round(defaults.u))));
    return "42";
  });
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
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        else if (e.key === "Enter") { e.preventDefault(); ok(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      }}>
      <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 640, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 13 }}>
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
        <div style={{ overflow: "auto", border: `1px solid ${v("border-subtle")}`, borderRadius: 4, minHeight: 200, flex: 1 }}>
          {list.length === 0 && <div style={{ padding: 12, opacity: 0.7 }}>No racks match. Try a shorter search.</div>}
          {list.map((m) => {
            const on = m.id === chosen?.id;
            return (
              <div key={m.id} onClick={() => { setSelId(m.id); if (m.generic) setGu(String(m.u)); }} onDoubleClick={ok}
                ref={(el) => { if (el && on) el.scrollIntoView({ block: "nearest" }); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", cursor: "pointer", background: on ? v("accent-soft") : "transparent", borderBottom: `1px solid ${v("border-faint")}` }}>
                <FramePreview kind={m.kind} u={m.generic ? (Number(gu) || m.u) : m.u} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{m.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.65 }}>{kindLabel(m.kind)}{m.approx ? " (size approximate)" : ""}</div>
                </div>
                <div style={{ width: 90, textAlign: "right", fontSize: 12 }}>{m.generic ? "4-52U" : `${m.u}U`}</div>
                <div style={{ width: 110, textAlign: "right", fontSize: 12, opacity: 0.8 }}>{m.generic ? "" : fmtDims(m.width_mm, m.depth_mm, units)}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, flex: 1, minWidth: 160 }}>Rack name<br />
            <input style={{ ...inp, width: "100%", boxSizing: "border-box" }} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {chosen?.generic && (
            <label style={{ fontSize: 12 }}>Height (U)<br />
              <input type="number" min={GENERIC_MIN_U} max={GENERIC_MAX_U} style={{ ...inp, width: 70, borderColor: guOk ? v("border") : v("danger") }} value={gu} onChange={(e) => setGu(e.target.value)} /></label>
          )}
          <span>
            <button style={btn} onClick={onCancel}>Cancel</button>
            <button style={{ ...btn, marginRight: 0, opacity: canOk ? 1 : 0.5 }} disabled={!canOk} onClick={ok}>{okLabel}</button>
          </span>
        </div>
        {chosen?.generic && !guOk && <div style={{ fontSize: 12, color: v("danger"), marginTop: 4 }}>Pick a height from {GENERIC_MIN_U} to {GENERIC_MAX_U}U.</div>}
      </div>
    </div>
  );
}
