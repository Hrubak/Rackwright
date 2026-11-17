import React, { memo, useMemo, useState } from "react";
import { v } from "./theme";
import { findBundles } from "./bundles";
import { isOutlet } from "./edit";
import type { Cable, Device, Doc, Route } from "./types";
import { CableOpts, DEFAULT_OPTS, Stub, StubEnd, dotCables, layoutStubs, visibleCables } from "./cableView";

export type CableColorMode = "own" | "type";
export type Focus = { kind: "cable" | "dev" | "rack"; id: number } | null;

// ---- cable kinds and the by-type palette (Okabe-Ito inspired, readable on the dark canvas)
export type { Kind } from "./cableKind";
import { cableKind, type Kind } from "./cableKind";
export { cableKind };
export const TYPE_COLORS: Record<string, string> = {
  cat5e: "#6fa8f0", cat6: "#2f7be0", cat6a: "#3f5fd6", // theme-ok
  om3: "#3fd6dc", om4: "#1fb4c6", os2: "#f0e442", // theme-ok
  dac: "#9aa0a8", power: "#2a2c30", console: "#a8d8f8", other: "#b48ad8", // theme-ok
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
const under = (c: string) => (lum(c) < 0.2 ? v("cable-under-light") : v("cable-shadow"));

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
const HEAD = v("plug-head"), EDGE = v("plug-edge");
function Plug({ kind, x, y, dir, color, outlet }: { kind: Kind; x: number; y: number; dir: number; color: string; outlet: boolean }) {
  const sw = { stroke: EDGE, strokeWidth: 0.6, vectorEffect: "non-scaling-stroke" as const };
  let g: React.ReactNode;
  if (kind === "fiber") {
    g = <>
      {[-1.7, 1.7].map((o) => <g key={o}>
        <rect x={o - 1.2} y={0} width={2.4} height={2.6} fill={v("plug-tip")} {...sw} />
        <rect x={o - 1.4} y={2.6} width={2.8} height={6.6} rx={1} fill={color} {...sw} />
      </g>)}
      <rect x={-3.2} y={3.6} width={6.4} height={1.6} rx={0.6} fill={v("plug-latch")} {...sw} />
    </>;
  } else if (kind === "dac") {
    g = <>
      <rect x={-3} y={0} width={6} height={6} rx={0.8} fill={v("plug-metal")} {...sw} />
      <line x1={-1.6} y1={1.2} x2={-1.6} y2={4.8} stroke={v("plug-pin")} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <line x1={1.6} y1={1.2} x2={1.6} y2={4.8} stroke={v("plug-pin")} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <rect x={-1.6} y={6} width={3.2} height={4} rx={1} fill={color} {...sw} />
    </>;
  } else if (kind === "power") {
    const c13 = outlet; // outlet end carries the C13 plug, the inlet end a C14 style plug
    const edge = c13 ? v("plug-c13-edge") : v("plug-c14-edge");
    g = <>
      <path d="M-3.6 0H3.6V3.6L2.2 5.6H-2.2L-3.6 3.6Z" fill={c13 ? v("plug-c13-body") : v("plug-c14-body")} stroke={edge} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      {!c13 && <><rect x={-1.6} y={0.9} width={1} height={2} fill={v("plug-metal")} /><rect x={0.6} y={0.9} width={1} height={2} fill={v("plug-metal")} /></>}
      <rect x={-2} y={5.6} width={4} height={4.4} rx={1.2} fill={v("plug-boot")} stroke={edge} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </>;
  } else if (kind === "console") {
    g = <>
      <rect x={-2.8} y={0} width={5.6} height={4.6} rx={0.8} fill={HEAD} {...sw} />
      <rect x={-2.4} y={4.6} width={4.8} height={5.2} rx={1.2} fill={color} {...sw} />
      <line x1={-2.8} y1={2.2} x2={2.8} y2={2.2} stroke={v("plug-console")} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
    </>;
  } else { // RJ45
    g = <>
      <rect x={-3} y={0} width={6} height={4.8} rx={0.6} fill={HEAD} {...sw} />
      <rect x={-1.5} y={-0.7} width={3} height={1.4} rx={0.5} fill={v("plug-white")} {...sw} />
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
  onPick: (id: number) => void; onOpen?: (id: number) => void; onEnter: (id: number, e: React.MouseEvent) => void; onMove: (e: React.MouseEvent) => void; onLeave: () => void;
}
const CableShape = memo(function CableShape(p: ShapeProps) {
  const { state, color } = p;
  return (
    <g opacity={state === "dim" ? 0.18 : 1} style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); p.onPick(p.id); }} onDoubleClick={(e) => { e.stopPropagation(); p.onOpen?.(p.id); }}
      onMouseEnter={(e) => p.onEnter(p.id, e)} onMouseMove={p.onMove} onMouseLeave={p.onLeave}>
      {state === "sel" && <path d={p.d} fill="none" stroke={v("select")} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />}
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
            <rect {...rect} rx={rx} fill={v("duct-fill")} fillOpacity={0.09} stroke={v("duct-fill")} strokeOpacity={0.2} strokeWidth={0.8} />
            {ties.map((t, k) => b.axis === "v"
              ? <rect key={k} x={f0 - 1} y={t - 1.2} width={th + 2} height={2.4} rx={1.2} fill={v("duct-tick")} fillOpacity={0.75} />
              : <rect key={k} x={t - 1.2} y={f0 - 1} width={2.4} height={th + 2} rx={1.2} fill={v("duct-tick")} fillOpacity={0.75} />)}
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

// ---- a stub: short line out of the faceplate, label at its end
const StubShape = memo(function StubShape({ s, color, state, zoom, onPick, onOpen, onEnter, onMove, onLeave }: {
  s: Stub; color: string; state: CState; zoom: number; onPick: (id: number) => void; onOpen?: (id: number) => void;
  onEnter: (id: number, e: React.MouseEvent) => void; onMove: (e: React.MouseEvent) => void; onLeave: () => void;
}) {
  const show = (s.labelOn || state === "sel" || state === "rel") && zoom >= 0.5;
  const down = s.dir > 0;
  return (
    <g opacity={state === "dim" ? 0.25 : 1} style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); onPick(s.cable); }} onDoubleClick={(e) => { e.stopPropagation(); onOpen?.(s.cable); }}
      onMouseEnter={(e) => onEnter(s.cable, e)} onMouseMove={onMove} onMouseLeave={onLeave}>
      <title>{s.full}</title>
      {state === "sel" && <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={v("select")} strokeWidth={5} strokeLinecap="round" opacity={0.9} />}
      <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={v("cable-shadow")} strokeOpacity={0.4} strokeWidth={3.4} strokeLinecap="round" />
      <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={s.x2} cy={s.y2} r={2.4} fill={color} stroke={v("cable-shadow")} strokeOpacity={0.5} strokeWidth={0.6} />
      <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={8} />
      {show && (
        <text transform={`translate(${s.x + 3} ${s.y2 + (down ? 5 : -5)}) rotate(${down ? 90 : -90})`} textAnchor={down ? "start" : "end"}
          fontSize={8} fill={v("cable-label")} stroke={v("cable-label-halo")} strokeWidth={2.2} paintOrder="stroke" style={{ pointerEvents: "none" }}>{s.short}</text>
      )}
    </g>
  );
});

export default function Cables({ doc, routes, selected, hoverDev, onSelect, onOpen, colorMode, zoom, opts = DEFAULT_OPTS }: {
  doc: Doc; routes: Route[]; selected: Focus; hoverDev: number | null; onSelect: (s: Focus) => void; onOpen?: (s: Focus) => void; colorMode: CableColorMode; zoom: number; opts?: CableOpts;
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
      color: colorMode === "type" ? typeColor(c?.type) : c?.color || "#999", // theme-ok
      a: r.pts[0], b: r.pts[n - 1], da: r.dir_a, db: r.dir_b,
      oa: !!pinfo.get(c?.a ?? -1)?.outlet, ob: !!pinfo.get(c?.b ?? -1)?.outlet,
      ends: c ? [pinfo.get(c.a)?.dev.id, pinfo.get(c.b)?.dev.id] : [],
    };
  }), [routes, cmap, colorMode, pinfo]);

  const vis = useMemo(() => visibleCables(doc, opts, selected, hoverDev), [doc, opts, selected, hoverDev]);
  const dots = useMemo(() => dotCables(doc, opts), [doc, opts]);
  const shown = useMemo(() => shapes.filter((s) => vis.has(s.id)), [shapes, vis]);
  const shownRoutes = useMemo(() => routes.filter((r) => vis.has(r.cable)), [routes, vis]);
  const stubs = useMemo(() => {
    if (opts.style !== "stubs") return [];
    const ends: StubEnd[] = [];
    for (const s of shown) {
      const c = cmap.get(s.id); if (!c) continue;
      const ia = pinfo.get(c.a), ib = pinfo.get(c.b);
      if (!ia || !ib) continue;
      ends.push({ cable: s.id, dev: ia.dev.id, pt: s.a, dir: s.da, far: { dev: ib.dev.name, port: ib.name } });
      ends.push({ cable: s.id, dev: ib.dev.id, pt: s.b, dir: s.db, far: { dev: ia.dev.name, port: ia.name } });
    }
    return layoutStubs(ends);
  }, [opts.style, shown, cmap, pinfo]);
  const shapeById = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);

  const focus: Focus = hovC ? { kind: "cable", id: hovC.id } : hoverDev != null ? { kind: "dev", id: hoverDev } : selected;
  const active = !!focus && (focus.kind === "cable" || focus.kind === "dev");
  const stateOf = (s: (typeof shapes)[number]): CState => {
    if (selected?.kind === "cable" && selected.id === s.id) return "sel";
    if (!active || !focus) return "normal";
    if (focus.kind === "cable") return s.id === focus.id ? "rel" : "dim";
    return s.ends[0] === focus.id || s.ends[1] === focus.id ? "rel" : "dim";
  };

  const onPick = useMemo(() => (id: number) => onSelect({ kind: "cable", id }), [onSelect]);
  const onOpenC = useMemo(() => (id: number) => onOpen?.({ kind: "cable", id }), [onOpen]);
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
      {opts.style === "routed" && <Harness routes={shownRoutes} faded={active} />}
      {opts.style === "routed" && shown.map((s) => <CableShape key={s.id} {...s} state={stateOf(s)} onPick={onPick} onOpen={onOpenC} onEnter={onEnter} onMove={onMove} onLeave={onLeave} />)}
      {opts.style === "stubs" && stubs.map((s, i) => {
        const sh = shapeById.get(s.cable);
        return <StubShape key={`${s.cable}:${i}`} s={s} color={sh?.color || "#999"} state={sh ? stateOf(sh) : "normal"} zoom={zoom} onPick={onPick} onOpen={onOpenC} onEnter={onEnter} onMove={onMove} onLeave={onLeave} />; // theme-ok
      })}
      {dots.size > 0 && shapes.filter((s) => dots.has(s.id)).map((s) => (
        <g key={"dot" + s.id} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick(s.id); }} onDoubleClick={(e) => { e.stopPropagation(); onOpenC(s.id); }}>
          {[s.a, s.b].map((p, k) => <circle key={k} cx={p[0]} cy={p[1]} r={3.4} fill={s.color} stroke={v("tip-bg")} strokeWidth={1} />)}
        </g>
      ))}
      {hovC && tip && (
        <g transform={`translate(${hovC.x + 10 / zoom} ${hovC.y + 12 / zoom}) scale(${1 / zoom})`} style={{ pointerEvents: "none" }}>
          <rect width={Math.max(...tip.map((t) => t.length)) * 5.6 + 12} height={tip.length * 14 + 8} rx={4} fill={v("tip-bg")} fillOpacity={0.94} stroke={v("border")} />
          {tip.map((t, i) => <text key={i} x={6} y={15 + i * 14} fontSize={10.5} fill={i === 0 ? v("text") : v("tip-text-dim")} fontWeight={i === 0 ? 600 : 400}>{t}</text>)}
        </g>
      )}
    </g>
  );
}

// ---- HTML overlay for the canvas corner: colour mode switch and the by-type legend
export function CableOverlay({ cables, mode, onMode, opts = DEFAULT_OPTS, onOpts }: { cables: Cable[]; mode: CableColorMode; onMode: (m: CableColorMode) => void; opts?: CableOpts; onOpts?: (o: CableOpts) => void }) {
  const rows = useMemo(() => {
    const m = new Map<string, { label: string; color: string; n: number }>();
    for (const c of cables) {
      const label = typeLabel(c.type), k = label.toLowerCase();
      const r = m.get(k); if (r) r.n++; else m.set(k, { label, color: typeColor(c.type), n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [cables]);
  const selSt: React.CSSProperties = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 3, fontSize: 11.5 };
  const box: React.CSSProperties = { background: v("float-bg"), border: `1px solid ${v("border")}`, borderRadius: 5, fontSize: 11.5, color: v("float-text") };
  return (
    <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", pointerEvents: "none" }}>
      {mode === "type" && rows.length > 0 && (
        <div style={{ ...box, padding: "5px 9px", pointerEvents: "auto", minWidth: 110 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 7, lineHeight: "17px" }}>
              <span style={{ width: 18, height: 3, borderRadius: 2, background: r.color, boxShadow: lum(r.color) < 0.2 ? `0 0 0 1px ${v("cable-under-light")}` : undefined }} />
              <span style={{ flex: 1 }}>{r.label}</span><span style={{ opacity: 0.6 }}>{r.n}</span>
            </div>
          ))}
        </div>
      )}
      <label style={{ ...box, padding: "3px 8px", pointerEvents: "auto" }}>Cable color{" "}
        <select value={mode} onChange={(e) => onMode(e.target.value as CableColorMode)} style={{ background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 3, fontSize: 11.5 }}>
          <option value="own">own</option><option value="type">by type</option>
        </select>
      </label>
      {onOpts && (
        <div style={{ ...box, padding: "3px 8px", pointerEvents: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label>Show{" "}
            <select value={opts.show} onChange={(e) => onOpts({ ...opts, show: e.target.value as CableOpts["show"] })} style={selSt}>
              <option value="all">all</option><option value="selected">selected</option><option value="none">none</option>
            </select>
          </label>
          <label>Style{" "}
            <select value={opts.style} onChange={(e) => onOpts({ ...opts, style: e.target.value as CableOpts["style"] })} style={selSt}>
              <option value="routed">routed</option><option value="stubs">stubs</option>
            </select>
          </label>
          <label title="Hide cables to Endpoints, Virtual machines and off-rack devices">
            <input type="checkbox" checked={opts.hideEndpoints} onChange={(e) => onOpts({ ...opts, hideEndpoints: e.target.checked })} /> Hide endpoint cables
          </label>
        </div>
      )}
    </div>
  );
}
