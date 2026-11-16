import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc } from "../types";
import type { Sel } from "../RackView";
import { fgFor, shade } from "../Plate";
import { infraLayout, InfraEdge, InfraNode } from "./infra";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const POWER = "#d9a441", DATA = "#7d8ea6";

export default function InfraView({ doc, selected, onSelect }: { doc: Doc; selected: Sel; onSelect: (s: Sel) => void }) {
  const lay = useMemo(() => infraLayout(doc), [doc]);
  const [power, setPower] = useState(true);
  const [hov, setHov] = useState<string | null>(null);
  const [view, setView] = useState({ x: 40, y: 40, z: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const fit = () => {
    const b = svgRef.current?.getBoundingClientRect(); if (!b || !lay.width) return;
    // leave room at the top for the controls bar (power toggle, Fit)
    const top = 56;
    const z = Math.max(0.2, Math.min(1.3, (b.width - 60) / lay.width, (b.height - top - 30) / Math.max(1, lay.height)));
    setView({ z, x: (b.width - lay.width * z) / 2, y: top });
  };
  useEffect(fit, [lay.width, lay.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeById = useMemo(() => new Map(lay.nodes.map((n) => [n.id, n])), [lay]);
  const selId = selected?.kind === "dev" ? selected.id : null;
  const edges = lay.edges.filter((e) => power || !e.power);
  const edgePath = (e: InfraEdge) => {
    const a = nodeById.get(e.a), b = nodeById.get(e.b); if (!a || !b) return null;
    const [u, l] = a.y <= b.y ? [a, b] : [b, a];
    if (Math.abs(u.y - l.y) < 1) { // same row: a loop under the boxes
      const x1 = u.x + u.w / 2, x2 = l.x + l.w / 2, y = u.y + u.h, dip = 14 + Math.min(40, Math.abs(x2 - x1) / 8) + (e.power ? 6 : 0);
      return { d: `M${x1} ${y}C${x1} ${y + dip},${x2} ${y + dip},${x2} ${y}`, mx: (x1 + x2) / 2, my: y + dip * 0.75 };
    }
    const off = e.power ? 8 : 0;
    const x1 = u.x + u.w / 2 + off, y1 = u.y + u.h, x2 = l.x + l.w / 2 + off, y2 = l.y, m = (y1 + y2) / 2;
    return { d: `M${x1} ${y1}C${x1} ${m},${x2} ${m},${x2} ${y2}`, mx: (x1 + x2) / 2, my: m };
  };
  const tip = (e: InfraEdge) => e.cables.map((c) => `${c.a} - ${c.b}${c.type ? ` (${c.type})` : ""}`).join("\n");
  const rel = (e: InfraEdge) => selId != null && (e.a === selId || e.b === selId);

  const node = (n: InfraNode) => {
    const d = n.dev, col = d.color || "#3b6ea8", fg = fgFor(col), on = selId === n.id;
    return (
      <g key={n.id} style={{ cursor: "pointer" }} onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "dev", id: n.id }); }}>
        <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} fill={col} stroke={on ? "#ffd33d" : shade(col, -70)} strokeWidth={on ? 2.5 : 1} />
        <text x={n.x + 8} y={n.y + 18} fontSize={12.5} fontWeight={700} fill={fg} style={{ pointerEvents: "none" }}>{clip(d.name, 22)}</text>
        <text x={n.x + 8} y={n.y + 34} fontSize={10} fill={fg} opacity={0.85} style={{ pointerEvents: "none" }}>{clip(d.ip || d.model || d.type, 26)}</text>
        <title>{`${d.name}\n${d.type}${d.model ? " - " + d.model : ""}${d.ip ? "\n" + d.ip : ""}`}</title>
      </g>
    );
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg ref={svgRef} style={{ width: "100%", height: "100%", background: "#14161a" }}
        onWheel={(e) => {
          const f = e.deltaY < 0 ? 1.1 : 1 / 1.1, bb = svgRef.current!.getBoundingClientRect(), mx = e.clientX - bb.left, my = e.clientY - bb.top;
          setView((v) => { const z = Math.min(4, Math.max(0.1, v.z * f)), g = z / v.z; return { z, x: mx - (mx - v.x) * g, y: my - (my - v.y) * g }; });
        }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; }}
        onMouseMove={(e) => { const p = pan.current; if (p) setView((v) => ({ ...v, x: p.vx + e.clientX - p.sx, y: p.vy + e.clientY - p.sy })); }}
        onMouseUp={() => { pan.current = null; }} onMouseLeave={() => { pan.current = null; }}
        onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          {edges.map((e) => {
            const p = edgePath(e); if (!p) return null;
            const col = e.power ? POWER : DATA, on = hov === e.key || rel(e);
            const dim = selId != null && !rel(e) && hov !== e.key;
            return (
              <g key={e.key} opacity={dim ? 0.2 : 1} onMouseEnter={() => setHov(e.key)} onMouseLeave={() => setHov(null)}>
                <path d={p.d} fill="none" stroke="transparent" strokeWidth={12} />
                <path d={p.d} fill="none" stroke={col} strokeWidth={on ? 3 : 1.6} strokeDasharray={e.power ? "6 4" : undefined} strokeLinecap="round" />
                {e.count > 1 && <g style={{ pointerEvents: "none" }}><circle cx={p.mx} cy={p.my} r={8} fill="#14161a" stroke={col} /><text x={p.mx} y={p.my} fontSize={10} textAnchor="middle" dominantBaseline="central" fill="#e6e8eb">{e.count}</text></g>}
                <title>{`${e.power ? "Power" : "Data"}: ${lay.nodes.find((n) => n.id === e.a)?.dev.name} - ${lay.nodes.find((n) => n.id === e.b)?.dev.name}\n${tip(e)}`}</title>
              </g>
            );
          })}
          {hov && (() => {
            const e = lay.edges.find((x) => x.key === hov), p = e && edgePath(e); if (!e || !p) return null;
            const lines = e.cables.slice(0, 6).map((c) => `${c.a} - ${c.b}`); if (e.cables.length > 6) lines.push(`+${e.cables.length - 6} more`);
            const w = Math.max(...lines.map((s) => s.length)) * 6 + 14;
            return <g style={{ pointerEvents: "none" }} transform={`translate(${p.mx + 10} ${p.my + 10})`}>
              <rect width={w} height={lines.length * 14 + 8} rx={4} fill="#0b0c0e" fillOpacity={0.95} stroke="#3a3d42" />
              {lines.map((s, i) => <text key={i} x={7} y={16 + i * 14} fontSize={10.5} fill="#e6e8eb">{s}</text>)}
            </g>;
          })()}
          {lay.extras.map((x) => {
            const host = x.host != null ? nodeById.get(x.host) : null, vm = x.kind === "vm";
            return (
              <g key={x.key} style={{ cursor: "pointer" }} onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "dev", id: x.devId }); }}>
                {host && vm && <line x1={host.x + host.w / 2} y1={host.y + host.h} x2={x.x + x.w / 2} y2={x.y} stroke="#9aa3b2" strokeDasharray="4 3" />}
                <rect x={x.x} y={x.y} width={x.w} height={x.h} rx={vm ? 3 : 14} fill="#1d2025" stroke={selId === x.devId ? "#ffd33d" : vm ? "#5fc3d4" : "#4a4f57"} strokeDasharray={vm ? "4 3" : undefined} />
                <text x={x.x + 8} y={x.y + 14} fontSize={10.5} fontWeight={600} fill="#e6e8eb" style={{ pointerEvents: "none" }}>{clip(x.title, 25)}</text>
                <text x={x.x + 8} y={x.y + 27} fontSize={9.5} fill="#9aa0a8" style={{ pointerEvents: "none" }}>{clip(x.sub, 28)}</text>
                <title>{`${x.title}\n${x.sub}`}</title>
              </g>
            );
          })}
          {lay.nodes.map(node)}
        </g>
      </svg>
      <div style={{ position: "absolute", left: 10, top: 10, display: "flex", gap: 10, alignItems: "center", background: "#0b0c0eee", border: "1px solid #3a3d42", borderRadius: 5, padding: "4px 10px", fontSize: 12, color: "#c9ced4" }}>
        <label><input type="checkbox" checked={power} onChange={(e) => setPower(e.target.checked)} /> Show power cables</label>
        <span><svg width={26} height={6}><line x1={0} y1={3} x2={26} y2={3} stroke={DATA} strokeWidth={2} /></svg> data</span>
        <span><svg width={26} height={6}><line x1={0} y1={3} x2={26} y2={3} stroke={POWER} strokeWidth={2} strokeDasharray="6 4" /></svg> power</span>
        <button style={{ background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, cursor: "pointer" }} onClick={fit}>Fit</button>
      </div>
      {!lay.nodes.length && <div style={{ position: "absolute", left: 20, top: 60, opacity: 0.6 }}>Nothing to show yet. Add switches, firewalls or servers in the Rack view.</div>}
    </div>
  );
}
