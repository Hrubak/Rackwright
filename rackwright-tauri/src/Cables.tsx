import React, { memo, useMemo, useState } from "react";
import { findBundles } from "./bundles";
import { isOutlet } from "./edit";
import type { Cable, Device, Doc, Route } from "./types";

export type CableColorMode = "own" | "type";
export type Focus = { kind: "cable" | "dev" | "rack"; id: number } | null;

// ---- cable kinds and the by-type palette (Okabe-Ito inspired, readable on the dark canvas)
export type Kind = "rj45" | "fiber" | "dac" | "power" | "console" | "other";
export function cableKind(type?: string): Kind {
  const t = (type || "").toLowerCase();
  if (/^cat\s?\d|rj45|copper|ethernet/.test(t)) return "rj45";
  if (/om\d|os\d|fib|\blc\b|\bsc\b|\bmpo\b/.test(t)) return "fiber";
  if (/dac|twinax|sfp|aoc|qsfp/.test(t)) return "dac";
  if (/power|iec|c13|c14|mains/.test(t)) return "power";
  if (/console|rollover|serial/.test(t)) return "console";
  return "other";
}
export const TYPE_COLORS: Record<string, string> = {
  cat5e: "#6fa8f0", cat6: "#2f7be0", cat6a: "#3f5fd6",
  om3: "#3fd6dc", om4: "#1fb4c6", os2: "#f0e442",
  dac: "#9aa0a8", power: "#2a2c30", console: "#a8d8f8", other: "#b48ad8",
};
export function typeKey(type?: string): string {
  const t = (type || "").toLowerCase().replace(/[\s_-]/g, "");
  const k = cableKind(type);
  if (k === "rj45") return /6a/.test(t) ? "cat6a" : /5e|5/.test(t) ? "cat5e" : "cat6";
  if (k === "fiber") return /os\d/.test(t) ? "os2" : /om[45]/.test(t) ? "om4" : "om3";
  return k;
}
export function typeColor(type?: string): string { return TYPE_COLORS[typeKey(type)]; }
export function typeLabel(type?: string): string { return (type || "").trim() || "Unknown"; }

const lum = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
// Faint separation stroke: dark under light cables, light under near-black ones.
const under = (c: string) => (lum(c) < 0.2 ? "#9aa0aa" : "#000");

// ---- geometry
export function roundedPath(pts: [number, number][], rmax = 6): string {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  if (p.length < 2) return "";
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length; i++) {
    const [x, y] = p[i];
    if (i === p.length - 1) { d += `L${x} ${y}`; break; }
    const [px, py] = p[i - 1], [nx, ny] = p[i + 1];
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
    const ux = (x - px) / l1, uy = (y - py) / l1, vx = (nx - x) / l2, vy = (ny - y) / l2;
    if (Math.abs(ux * vy - uy * vx) < 1e-6) { d += `L${x} ${y}`; continue; } // straight on
    const r = Math.min(rmax, l1 / 2, l2 / 2);
    d += `L${+(x - ux * r).toFixed(2)} ${+(y - uy * r).toFixed(2)}Q${x} ${y} ${+(x + vx * r).toFixed(2)} ${+(y + vy * r).toFixed(2)}`;
  }
  return d;
}

// ---- plugs: drawn at the port, body extends along +y (flipped by dir), about 10 px long
const HEAD = "#c9ced5", EDGE = "#4a4f57";
function Plug({ kind, x, y, dir, color, outlet }: { kind: Kind; x: number; y: number; dir: number; color: string; outlet: boolean }) {
  const sw = { stroke: EDGE, strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" as const };
  let g: React.ReactNode;
  if (kind === "fiber") {
    g = <>
      {[-1.7, 1.7].map((o) => <g key={o}>
        <rect x={o - 1.2} y={0} width={2.4} height={2.6} fill="#f4f6f8" {...sw} />
        <rect x={o - 1.4} y={2.6} width={2.8} height={6.6} rx={1} fill={color} {...sw} />
      </g>)}
      <rect x={-3.2} y={3.6} width={6.4} height={1.6} rx={0.6} fill="#d8dce1" {...sw} />
    </>;
  } else if (kind === "dac") {
    g = <>
      <rect x={-3} y={0} width={6} height={6} rx={0.8} fill="#b9bfc7" {...sw} />
      <line x1={-1.6} y1={1.2} x2={-1.6} y2={4.8} stroke="#7b818a" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <line x1={1.6} y1={1.2} x2={1.6} y2={4.8} stroke="#7b818a" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <rect x={-1.6} y={6} width={3.2} height={4} rx={1} fill={color} {...sw} />
    </>;
  } else if (kind === "power") {
    const c13 = outlet; // outlet end carries the C13 plug, the inlet end a C14 style plug
    const edge = c13 ? "#7d838c" : "#9aa0a8";
    g = <>
      <path d="M-3.6 0H3.6V3.6L2.2 5.6H-2.2L-3.6 3.6Z" fill={c13 ? "#202226" : "#14151a"} stroke={edge} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      {!c13 && <><rect x={-1.6} y={0.9} width={1} height={2} fill="#b9bfc7" /><rect x={0.6} y={0.9} width={1} height={2} fill="#b9bfc7" /></>}
      <rect x={-2} y={5.6} width={4} height={4.4} rx={1.2} fill="#2b2d31" stroke={edge} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </>;
  } else if (kind === "console") {
    g = <>
      <rect x={-2.8} y={0} width={5.6} height={4.6} rx={0.8} fill={HEAD} {...sw} />
      <rect x={-2.4} y={4.6} width={4.8} height={5.2} rx={1.2} fill={color} {...sw} />
      <line x1={-2.8} y1={2.2} x2={2.8} y2={2.2} stroke="#7a8fa6" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
    </>;
  } else { // RJ45
    g = <>
      <rect x={-3} y={0} width={6} height={4.8} rx={0.6} fill={HEAD} {...sw} />
      <rect x={-1.5} y={-0.7} width={3} height={1.4} rx={0.5} fill="#e4e8ec" {...sw} />
      <path d="M-2.6 4.8H2.6L2 9.8H-2L-2.6 4.8Z" fill={color} stroke={EDGE} strokeWidth={0.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </>;
  }
  return <g transform={`translate(${x} ${y}) scale(1 ${dir < 0 ? -1 : 1})`} style={{ pointerEvents: "none" }}>{g}</g>;
}

// ---- one cable, memoised on primitives so hover changes only touch cables whose state changed
type CState = "normal" | "dim" | "rel" | "sel";
interface ShapeProps {
  id: number; d: string; color: string; dash?: string; state: CState; kind: Kind;
  a: [number, number]; b: [number, number]; da: number; db: number; oa: boolean; ob: boolean;
  onPick: (id: number) => void; onEnter: (id: number, e: React.MouseEvent) => void; onMove: (e: React.MouseEvent) => void; onLeave: () => void;
}
const CableShape = memo(function CableShape(p: ShapeProps) {
  const { state, color } = p;
  return (
    <g opacity={state === "dim" ? 0.18 : 1} style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); p.onPick(p.id); }}
      onMouseEnter={(e) => p.onEnter(p.id, e)} onMouseMove={p.onMove} onMouseLeave={p.onLeave}>
      {state === "sel" && <path d={p.d} fill="none" stroke="#ffd33d" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />}
      {state === "rel" && <path d={p.d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.28} />}
      <path d={p.d} fill="none" stroke={under(color)} strokeOpacity={0.4} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.dash} />
      <path d={p.d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.dash} />
      <Plug kind={p.kind} x={p.a[0]} y={p.a[1]} dir={p.da} color={color} outlet={p.oa} />
      <Plug kind={p.kind} x={p.b[0]} y={p.b[1]} dir={p.db} color={color} outlet={p.ob} />
    </g>
  );
});

const Harness = memo(function Harness({ routes, faded }: { routes: Route[]; faded: boolean }) {
  const bs = useMemo(() => findBundles(routes), [routes]);
  return (
    <g style={{ pointerEvents: "none" }} opacity={faded ? 0.35 : 1}>
      {bs.map((b, i) => {
        const pad = 4, th = b.fixedMax - b.fixedMin + 2 * pad, len = b.hi - b.lo;
        const f0 = b.fixedMin - pad, rx = Math.min(th / 2, 6);
        const n = len < 60 ? 1 : Math.floor((len - 20) / 60) + 1, first = n === 1 ? b.lo + len / 2 : b.lo + (len - (n - 1) * 60) / 2;
        const ties = Array.from({ length: n }, (_, k) => first + k * 60);
        const rect = b.axis === "v" ? { x: f0, y: b.lo, width: th, height: len } : { x: b.lo, y: f0, width: len, height: th };
        return (
          <g key={i}>
            <rect {...rect} rx={rx} fill="#cfd6e0" fillOpacity={0.09} stroke="#cfd6e0" strokeOpacity={0.2} strokeWidth={0.8} />
            {ties.map((t, k) => b.axis === "v"
              ? <rect key={k} x={f0 - 1} y={t - 1.2} width={th + 2} height={2.4} rx={1.2} fill="#8d96a3" fillOpacity={0.75} />
              : <rect key={k} x={t - 1.2} y={f0 - 1} width={2.4} height={th + 2} rx={1.2} fill="#8d96a3" fillOpacity={0.75} />)}
          </g>
        );
      })}
    </g>
  );
});

interface TipInfo { id: number; x: number; y: number }

// Cursor position in the cable layer's own (world) coordinates.
function place(e: React.MouseEvent): { x: number; y: number } {
  const el = e.currentTarget as SVGGElement;
  const m = (el.parentNode as SVGGraphicsElement | null)?.getScreenCTM(), svg = el.ownerSVGElement;
  if (!svg || !m) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(m.inverse()); return { x: q.x, y: q.y };
}

export default function Cables({ doc, routes, selected, hoverDev, onSelect, colorMode, zoom }: {
  doc: Doc; routes: Route[]; selected: Focus; hoverDev: number | null; onSelect: (s: Focus) => void; colorMode: CableColorMode; zoom: number;
}) {
  const [hovC, setHovC] = useState<TipInfo | null>(null);
  const cmap = useMemo(() => new Map<number, Cable>(doc.cables.map((c) => [c.id, c])), [doc.cables]);
  const pinfo = useMemo(() => {
    const m = new Map<number, { dev: Device; name: string; outlet: boolean }>();
    for (const d of doc.devices) for (const p of d.ports) m.set(p.id, { dev: d, name: p.name, outlet: isOutlet(p) });
    return m;
  }, [doc.devices]);
  // geometry only changes with the routes, the colour mode or edited cables
  const shapes = useMemo(() => routes.map((r) => {
    const c = cmap.get(r.cable), n = r.pts.length;
    return {
      id: r.cable, d: roundedPath(r.pts), dash: c?.style === "dashed" ? "6 4" : undefined, kind: cableKind(c?.type),
      color: colorMode === "type" ? typeColor(c?.type) : c?.color || "#999",
      a: r.pts[0], b: r.pts[n - 1], da: r.dir_a, db: r.dir_b,
      oa: !!pinfo.get(c?.a ?? -1)?.outlet, ob: !!pinfo.get(c?.b ?? -1)?.outlet,
      ends: c ? [pinfo.get(c.a)?.dev.id, pinfo.get(c.b)?.dev.id] : [],
    };
  }), [routes, cmap, colorMode, pinfo]);

  const focus: Focus = hovC ? { kind: "cable", id: hovC.id } : hoverDev != null ? { kind: "dev", id: hoverDev } : selected;
  const active = !!focus && (focus.kind === "cable" || focus.kind === "dev");
  const stateOf = (s: (typeof shapes)[number]): CState => {
    if (selected?.kind === "cable" && selected.id === s.id) return "sel";
    if (!active || !focus) return "normal";
    if (focus.kind === "cable") return s.id === focus.id ? "rel" : "dim";
    return s.ends[0] === focus.id || s.ends[1] === focus.id ? "rel" : "dim";
  };

  const onPick = useMemo(() => (id: number) => onSelect({ kind: "cable", id }), [onSelect]);
  const onEnter = useMemo(() => (id: number, e: React.MouseEvent) => setHovC({ id, ...place(e) }), []);
  const onMove = useMemo(() => (e: React.MouseEvent) => { const q = place(e); setHovC((h) => (h ? { ...h, ...q } : h)); }, []);
  const onLeave = useMemo(() => () => setHovC(null), []);

  const hid = hovC?.id;
  const tip = useMemo(() => {
    const c = hid != null ? cmap.get(hid) : undefined; if (!c) return null;
    const end = (pid: number) => { const i = pinfo.get(pid); return i ? `${i.dev.name} ${i.name}`.trim() : "?"; };
    const ex = c as Cable & { length?: number; unit?: string };
    const len = ex.length ? `${ex.length} ${ex.unit || ""}`.trim() : "";
    return [c.label || `Cable ${c.id}`, `${end(c.a)} to ${end(c.b)}`, [typeLabel(c.type), len].filter(Boolean).join(", ")];
  }, [hid, cmap, pinfo]);

  return (
    <g>
      <Harness routes={routes} faded={active} />
      {shapes.map((s) => <CableShape key={s.id} {...s} state={stateOf(s)} onPick={onPick} onEnter={onEnter} onMove={onMove} onLeave={onLeave} />)}
      {hovC && tip && (
        <g transform={`translate(${hovC.x + 10 / zoom} ${hovC.y + 12 / zoom}) scale(${1 / zoom})`} style={{ pointerEvents: "none" }}>
          <rect width={Math.max(...tip.map((t) => t.length)) * 5.6 + 12} height={tip.length * 14 + 8} rx={4} fill="#0b0c0e" fillOpacity={0.94} stroke="#3a3d42" />
          {tip.map((t, i) => <text key={i} x={6} y={15 + i * 14} fontSize={10.5} fill={i === 0 ? "#e6e8eb" : "#a9afb7"} fontWeight={i === 0 ? 600 : 400}>{t}</text>)}
        </g>
      )}
    </g>
  );
}

// ---- HTML overlay for the canvas corner: colour mode switch and the by-type legend
export function CableOverlay({ cables, mode, onMode }: { cables: Cable[]; mode: CableColorMode; onMode: (m: CableColorMode) => void }) {
  const rows = useMemo(() => {
    const m = new Map<string, { label: string; color: string; n: number }>();
    for (const c of cables) {
      const label = typeLabel(c.type), k = label.toLowerCase();
      const r = m.get(k); if (r) r.n++; else m.set(k, { label, color: typeColor(c.type), n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [cables]);
  const box: React.CSSProperties = { background: "#0b0c0eee", border: "1px solid #3a3d42", borderRadius: 5, fontSize: 11.5, color: "#c9ced4" };
  return (
    <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", pointerEvents: "none" }}>
      {mode === "type" && rows.length > 0 && (
        <div style={{ ...box, padding: "5px 9px", pointerEvents: "auto", minWidth: 110 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 7, lineHeight: "17px" }}>
              <span style={{ width: 18, height: 3, borderRadius: 2, background: r.color, boxShadow: lum(r.color) < 0.2 ? "0 0 0 1px #9aa0aa" : undefined }} />
              <span style={{ flex: 1 }}>{r.label}</span><span style={{ opacity: 0.6 }}>{r.n}</span>
            </div>
          ))}
        </div>
      )}
      <label style={{ ...box, padding: "3px 8px", pointerEvents: "auto" }}>Cable color{" "}
        <select value={mode} onChange={(e) => onMode(e.target.value as CableColorMode)} style={{ background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 3, fontSize: 11.5 }}>
          <option value="own">own</option><option value="type">by type</option>
        </select>
      </label>
    </div>
  );
}
