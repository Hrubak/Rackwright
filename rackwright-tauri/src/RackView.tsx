import React, { useEffect, useMemo, useRef, useState } from "react";
import RackFrame from "./RackFrame";
import { kindLabel } from "./racks";
import { Target, devDims, rackUsage, resolveTarget, shapeOf } from "./edit";
import { drawPlate, drawPort, fgFor, shade } from "./Plate";
import Cables, { CableColorMode } from "./Cables";
import type { CableOpts } from "./cableView";
import VmLinks from "./VmLinks";
import { Doc, Device, PortPos, RouteResult, UH, RW, RAIL, HDR, PADB, PORT_COLORS } from "./types";

function devRect(doc: Doc, d: Device) {
  const { w, h } = devDims(d);
  const r = d.rack != null ? doc.racks.find((x) => x.id === d.rack) : undefined;
  if (r) {
    const t = r.y + HDR + (r.u - (d.u + d.u_size - 1)) * UH;
    const l = r.x + RAIL + (d.half && d.side === 1 ? RW / 2 : 0);
    return { l, t, w, h };
  }
  return { l: d.fx, t: d.fy, w, h };
}

function drawBlob(d: Device, l: number, t: number, rear: boolean, sel: boolean) {
  const p = d.plate || {}, cx = l + 32, cy = t + 32, sq = shapeOf(d) === "squircle";
  const body = rear ? "#c3c8ce" : p.body || "#f2f4f6", ring = p.k === "uap" ? "#2a6fdb" : p.bc || "#2a6fdb";
  const out = sel ? "#ffd33d" : "#8b9097";
  const shape = (inset: number, fill: string, stroke: string, sw: number) => sq
    ? <rect x={cx - 29 + inset} y={cy - 29 + inset} width={58 - 2 * inset} height={58 - 2 * inset} rx={16 - inset} fill={fill} stroke={stroke} strokeWidth={sw} />
    : <circle cx={cx} cy={cy} r={29 - inset} fill={fill} stroke={stroke} strokeWidth={sw} />;
  return <>
    {shape(0, body, out, sel ? 2.5 : 1.2)}
    {shape(5, "none", rear ? "#8b9097" : "#ffffff", 3)}
    {rear ? [-12, 12].map((x) => <circle key={x} cx={cx + x} cy={cy - 4} r={2.2} fill="#6b717a" />)
      : <>{shape(9, "none", ring, 2)}<circle cx={cx} cy={cy - 7} r={2.2} fill={ring} /></>}
  </>;
}

const clip = (s: string, w: number, cw: number) => { const n = Math.max(3, Math.floor(w / cw)); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function drawManager(d: Device, l: number, t: number, r: number, b: number) {
  const nm = d.name.toLowerCase(), out: React.ReactNode[] = [];
  if (nm.includes("brush")) {
    out.push(<rect key="b" x={l + 30} y={t + 4} width={r - l - 60} height={b - t - 8} fill="#0c0d0f" stroke="#2c2f34" />);
    for (let x = l + 34; x < r - 34; x += 3) out.push(<line key={"v" + x} x1={x} y1={t + 6} x2={x} y2={b - 6} stroke="#444851" />);
  } else if (nm.includes("ring")) {
    for (let x = l + 40; x < r - 40; x += 70) out.push(<ellipse key={x} cx={x} cy={(t + b) / 2} rx={7} ry={(b - t) / 2 - 4} fill="none" stroke="#9aa0a6" strokeWidth={2} />);
  } else {
    for (let x = l + 26; x < r - 26; x += 22) out.push(<rect key={x} x={x} y={t + 3} width={9} height={b - t - 6} fill="#2f333a" stroke="#454a52" />);
  }
  for (const ex of [l + 6, r - 6]) out.push(<circle key={"e" + ex} cx={ex} cy={(t + b) / 2} r={3} fill="#0c0d0f" stroke="#9aa0a6" />);
  out.push(<text key="n" x={(l + r) / 2} y={(t + b) / 2} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="#c9ced4" style={{ pointerEvents: "none" }}>{d.name}</text>);
  return out;
}

export type Sel = { kind: "cable" | "dev" | "rack"; id: number } | null;

export type Resolver = (dev: Device, clientX: number, clientY: number) => Target;

export default function RackView({ doc: committed, liveDoc, onDragTarget, onDragEnd, face, routes, ports, selected, onSelect, pendingPort, onPort, onMoveDevice, onReject, drag, resolveRef, fitTick, cableColor = "own", cableOpts }: {
  doc: Doc; face: "front" | "rear"; routes: RouteResult;
  /** Provisional document while an existing device is dragged (device drawn at its target; routes/ports props then belong to it). */
  liveDoc?: Doc | null; onDragTarget?: (id: number, t: Target) => void; onDragEnd?: (committed: boolean) => void; ports: PortPos[];
  selected: Sel; onSelect: (s: Sel) => void; pendingPort: number | null; onPort: (pid: number) => void;
  onMoveDevice: (id: number, rack: number | null, u: number, side: number, fx: number, fy: number) => void;
  onReject: (why: string) => void;
  drag: { dev: Device; x: number; y: number } | null; resolveRef: React.MutableRefObject<Resolver>; fitTick: number; cableColor?: CableColorMode; cableOpts?: CableOpts;
}) {
  const doc = liveDoc ?? committed; // what is drawn; hit-testing and edits use `committed`
  const [hovDev, setHovDev] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mv = useRef<{ id: number; ox: number; oy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const [mvGhost, setMvGhost] = useState<{ dev: Device; t: Target } | null>(null);
  const [view, setView] = useState({ x: 120, y: 60, z: 1 });
  const panning = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const world = (e: { clientX: number; clientY: number }) => {
    const b = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - b.left - view.x) / view.z, y: (e.clientY - b.top - view.y) / view.z };
  };
  resolveRef.current = (dev, cx, cy) => {
    const el = svgRef.current; if (!el) return { kind: "none" };
    const b = el.getBoundingClientRect();
    if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return { kind: "none" };
    const w = world({ clientX: cx, clientY: cy });
    return resolveTarget(committed, dev, w.x, w.y);
  };
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const bb = el.getBoundingClientRect();
    const boxes = [
      ...doc.racks.map((r) => ({ l: r.x, t: r.y, r: r.x + RW + 2 * RAIL, b: r.y + HDR + r.u * UH + PADB })),
      ...doc.devices.filter((d) => d.rack == null).map((d) => { const q = devRect(doc, d); return { l: q.l, t: q.t, r: q.l + q.w, b: q.t + q.h + 24 }; }),
    ];
    if (!boxes.length) { setView({ x: 120, y: 60, z: 1 }); return; }
    const l = Math.min(...boxes.map((x) => x.l)), t = Math.min(...boxes.map((x) => x.t));
    const r = Math.max(...boxes.map((x) => x.r)), bt = Math.max(...boxes.map((x) => x.b));
    const z = Math.max(0.2, Math.min(1.2, (bb.width - 60) / (r - l), (bb.height - 60) / (bt - t)));
    setView({ z, x: (bb.width - (r - l) * z) / 2 - l * z, y: 30 - t * z });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);
  // Escape while moving a device puts it back and shows the saved cables again.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !mv.current?.moved) return;
      e.stopPropagation(); mv.current = null; setMvGhost(null); onDragEnd?.(false);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  });
  const dragT = drag ? resolveRef.current(drag.dev, drag.x, drag.y) : null;
  const gh = mvGhost ?? (drag && dragT && dragT.kind !== "none" ? { dev: drag.dev, t: dragT } : null);
  const pp = useMemo(() => new Map(ports.map((p) => [p[0], p])), [ports]);
  const vis = (d: Device) => d.rack == null || d.face === face || d.face === "both";

  return (
    <svg ref={svgRef} style={{ width: "100%", height: "100%", background: "#14161a", cursor: drag ? "copy" : undefined }}
      onWheel={(e) => {
        const f = e.deltaY < 0 ? 1.1 : 1 / 1.1, bb = svgRef.current!.getBoundingClientRect();
        const mx = e.clientX - bb.left, my = e.clientY - bb.top;
        setView((v) => { const z = Math.min(4, Math.max(0.1, v.z * f)), g = z / v.z; return { z, x: mx - (mx - v.x) * g, y: my - (my - v.y) * g }; });
      }}
      onMouseDown={(e) => { if (e.target !== e.currentTarget) return; panning.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; }}
      onMouseMove={(e) => {
        const m = mv.current;
        if (m) {
          if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 4) return;
          m.moved = true;
          const dev = committed.devices.find((x) => x.id === m.id)!;
          const w = world(e);
          const t = resolveTarget(committed, dev, w.x, w.y, { ox: m.ox, oy: m.oy });
          setMvGhost({ dev, t });
          onDragTarget?.(dev.id, t);
          return;
        }
        const d = panning.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy })); }}
      onMouseUp={(e) => {
        panning.current = null;
        const m = mv.current; mv.current = null;
        if (!m) return;
        setMvGhost(null);
        if (!m.moved) return;
        const dev = committed.devices.find((x) => x.id === m.id)!;
        const w = world(e);
        const t = resolveTarget(committed, dev, w.x, w.y, { ox: m.ox, oy: m.oy });
        let ok = false;
        if (t.kind === "rack") { if (t.p.ok) { onMoveDevice(dev.id, t.r.id, t.u, t.side, 0, 0); ok = true; } else onReject(t.p.why || "Can't place it there"); }
        else if (t.kind === "float") { onMoveDevice(dev.id, null, 1, 0, t.fx, t.fy); ok = true; }
        onDragEnd?.(ok);
      }} onMouseLeave={() => { panning.current = null; if (mv.current?.moved) onDragEnd?.(false); mv.current = null; setMvGhost(null); }}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
        {doc.racks.map((r) => (
          <g key={r.id} onClick={(e) => { e.stopPropagation(); onSelect({ kind: "rack", id: r.id }); }}>
            <rect stroke={selected?.kind === "rack" && selected.id === r.id ? "#ffd33d" : "#3a3d42"} x={r.x} y={r.y} width={RW + 2 * RAIL} height={HDR + r.u * UH + PADB} rx={4} fill="#1d2025" />
            {r.kind && <RackFrame kind={r.kind} x={r.x} y={r.y} w={RW + 2 * RAIL} h={HDR + r.u * UH + PADB} />}
            <text x={r.x + (RW + 2 * RAIL) / 2} y={r.y + 20} textAnchor="middle" fill="#e6e8eb" fontSize={16} fontWeight={600}>{r.name}</text>
            <text x={r.x + (RW + 2 * RAIL) / 2} y={r.y + 36} textAnchor="middle" fill="#7d838c" fontSize={10.5}>{r.kind ? `${r.model_name || kindLabel(r.kind)} · ${r.u}U · ${rackUsage(doc, r).used}U used, ${rackUsage(doc, r).free}U free` : `${rackUsage(doc, r).used}/${r.u}U used, ${rackUsage(doc, r).free}U free`}</text>
            <rect x={r.x + RAIL - 3} y={r.y + HDR - 3} width={RW + 6} height={r.u * UH + 6} fill="#0b0c0e" stroke="#2c2f35" />
            {Array.from({ length: r.u }, (_, i) => {
              const y = r.y + HDR + (r.u - i - 1) * UH;
              return (
                <g key={i}>
                  {i % 2 === 0 && <rect x={r.x + RAIL} y={y} width={RW} height={UH} fill="#111317" />}
                  <rect x={r.x + 3} y={y + UH / 2 - 2} width={4} height={4} rx={1} fill="#2a2d33" />
                  <rect x={r.x + RW + 2 * RAIL - 7} y={y + UH / 2 - 2} width={4} height={4} rx={1} fill="#2a2d33" />
                  <text x={r.x + 17} y={y + UH / 2 + 0.5} textAnchor="middle" dominantBaseline="central" fill="#6b717a" fontSize={9}>{i + 1}</text>
                </g>
              );
            })}
          </g>
        ))}
        {doc.devices.filter(vis).map((d) => {
          const q = devRect(doc, d);
          const l = q.l, t = q.t, r = q.l + q.w, b = q.t + q.h;
          const isSel = selected?.kind === "dev" && selected.id === d.id;
          const col = d.color || "#3b6ea8";
          const pg = d.ports.map((p) => pp.get(p.id)).filter((g): g is PortPos => !!g).map((g) => [g[1], g[2], g[3]] as [number, number, number]);
          const blob = shapeOf(d) !== "rect";
          const plate = d.plate && !blob ? drawPlate(d, l, t, r, b, pg, face === "rear", view.z) : null;
          const mgr = !plate && d.type === "Cable manager";
          const fg = plate ? plate.fg : fgFor(col);
          const lx = plate ? plate.lx : l + 7, labw = plate ? plate.labw : Math.min(150, q.w * 0.3);
          const two = q.h >= 22;
          const sub = d.ip || d.model || d.type;
          const cableOn = (pid: number) => { const c = doc.cables.find((x) => x.a === pid || x.b === pid); return c ? (c.color || "#1f6feb") : null; };
          return (
            <g key={d.id} onMouseEnter={() => setHovDev(d.id)} onMouseLeave={() => setHovDev(null)} onMouseDown={(e) => {
                e.stopPropagation(); onSelect({ kind: "dev", id: d.id });
                const w = world(e); mv.current = { id: d.id, ox: w.x - q.l, oy: w.y - q.t, sx: e.clientX, sy: e.clientY, moved: false };
              }}>
              {blob ? drawBlob(d, l, t, face === "rear", isSel)
                : <rect stroke={isSel ? "#ffd33d" : shade(col, -70)} strokeWidth={isSel ? 2.5 : 1} x={l + 1} y={t + 1} width={q.w - 2} height={q.h - 2} rx={d.type === "Endpoints" ? 8 : 2} fill={mgr ? "#1d2024" : col} />}
              {plate ? plate.nodes : null}
              {blob ? (
                <>
                  <text x={l + 32} y={b + 11} textAnchor="middle" fill="#e6e8eb" fontSize={11} fontWeight={600} style={{ pointerEvents: "none" }}>{clip(d.name, 130, 6.2)}</text>
                  {d.ip && <text x={l + 32} y={b + 23} textAnchor="middle" fill="#8b9097" fontSize={9.5} style={{ pointerEvents: "none" }}>{d.ip}</text>}
                </>
              ) : mgr ? drawManager(d, l, t, r, b) : (
                <>
                  <text x={lx} y={t + (two ? 9 : q.h / 2)} fill={fg} fontSize={13} fontWeight={700} dominantBaseline="central" style={{ pointerEvents: "none" }}>{clip(d.name, labw - 8, 7.4)}</text>
                  {two && <text x={lx} y={t + 21} fill={fg} fontSize={10.5} opacity={0.85} dominantBaseline="central" style={{ pointerEvents: "none" }}>{clip(sub, labw - 8, 5.8)}</text>}
                </>
              )}
              {d.type === "Endpoints" && d.endpoints && (
                <g style={{ pointerEvents: "none" }}><circle cx={l + 14} cy={b - 13} r={9} fill="#e6e8eb" /><text x={l + 14} y={b - 13} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="#1b1d21">{d.endpoints.length}</text></g>
              )}
              {d.ports.map((p) => {
                const g = pp.get(p.id); if (!g) return null;
                const c = cableOn(p.id);
                const node = drawPort(p.id, p, g[1], g[2], g[3], c, !!plate || blob, pendingPort === p.id, view.z, PORT_COLORS[p.type] ?? "#888", (e) => { e.stopPropagation(); onPort(p.id); });
                const lab = g[3] * view.z >= 15 && p.name ? (
                  <text key={"l" + p.id} x={g[1]} y={g[2]} textAnchor="middle" dominantBaseline="central" fontSize={8.5} fill={fgFor(c || (plate ? "#101113" : PORT_COLORS[p.type] ?? "#cccccc"))} style={{ pointerEvents: "none" }}>{p.name.slice(-3)}</text>
                ) : null;
                return <g key={p.id}>{node}{lab}</g>;
              })}
              <title>{d.name}</title>
            </g>
          );
        })}
        {gh && (() => {
          const { dev, t } = gh;
          let x = 0, y = 0, ok = true, why = "", warn = false, dm = devDims({ ...dev, rack: null });
          if (t.kind === "rack") {
            dm = devDims({ ...dev, rack: t.r.id });
            const q = devRect(doc, { ...dev, rack: t.r.id, u: t.u, side: t.side }); x = q.l; y = q.t; ok = t.p.ok; why = t.p.why || t.p.warn || ""; warn = !!t.p.warn;
          } else if (t.kind === "float") { x = t.fx; y = t.fy; why = "Off-rack"; warn = true; }
          else return null;
          const col = !ok ? "#f85149" : warn ? "#d29922" : "#2ea043";
          const round = shapeOf({ ...dev, rack: null });
          return <g style={{ pointerEvents: "none" }}>
            {round === "disc" ? <circle cx={x + 32} cy={y + 32} r={29} fill={col + "55"} stroke={col} strokeWidth={2} />
              : <rect x={x + 1} y={y + 1} width={dm.w - 2} height={dm.h - 2} rx={round === "squircle" ? 16 : 2} fill={col + "55"} stroke={col} strokeWidth={2} />}
            {why && <g><rect x={x} y={y - 18} width={Math.max(60, why.length * 6.2 + 12)} height={16} rx={3} fill="#000d" stroke={col} />
              <text x={x + 6} y={y - 10} fill="#fff" fontSize={10.5} dominantBaseline="central">{why}</text></g>}
          </g>;
        })()}
        <VmLinks doc={doc} rectOf={(d) => devRect(doc, d)} visible={vis} />
        <Cables doc={doc} routes={routes.routes} selected={selected} hoverDev={hovDev} onSelect={onSelect} colorMode={cableColor} zoom={view.z} opts={cableOpts} />
      </g>
    </svg>
  );
}
