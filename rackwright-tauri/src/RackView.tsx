import { useMemo, useRef, useState } from "react";
import { fits } from "./edit";
import { Doc, Device, PortPos, RouteResult, UH, RW, RAIL, HDR, PADB, PORT_COLORS } from "./types";

const LANE_W = 2.2;

function devRect(doc: Doc, d: Device) {
  const w = d.half ? RW / 2 : RW, h = Math.max(1, d.u_size) * UH;
  const r = d.rack != null ? doc.racks.find((x) => x.id === d.rack) : undefined;
  if (r) {
    const t = r.y + HDR + (r.u - (d.u + d.u_size - 1)) * UH;
    const l = r.x + RAIL + (d.half && d.side === 1 ? RW / 2 : 0);
    return { l, t, w, h };
  }
  return { l: d.fx, t: d.fy, w, h };
}

export type Sel = { kind: "cable" | "dev" | "rack"; id: number } | null;

export default function RackView({ doc, face, routes, ports, selected, onSelect, pendingPort, onPort, onMoveDevice }: {
  doc: Doc; face: "front" | "rear"; routes: RouteResult; ports: PortPos[];
  selected: Sel; onSelect: (s: Sel) => void; pendingPort: number | null; onPort: (pid: number) => void;
  onMoveDevice: (id: number, rack: number | null, u: number, side: number, fx: number, fy: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mv = useRef<{ id: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number; ok: boolean } | null>(null);
  const world = (e: { clientX: number; clientY: number }, v: { x: number; y: number; z: number }) => {
    const b = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - b.left - v.x) / v.z, y: (e.clientY - b.top - v.y) / v.z };
  };
  const slotAt = (d: Device, wx: number, wy: number) => {
    const w = d.half ? RW / 2 : RW;
    for (const r of doc.racks) {
      const l = r.x + RAIL;
      if (wx < l - 40 || wx > l + RW + 40 || wy < r.y + HDR - 20 || wy > r.y + HDR + r.u * UH + 20) continue;
      const topU = Math.round((r.y + HDR + r.u * UH - wy) / UH - 0.5);
      const u = Math.min(Math.max(1, topU + 1 - (d.u_size - 1)), Math.max(1, r.u - d.u_size + 1));
      const side = d.half && wx > l + RW / 2 ? 1 : 0;
      return { r, u, side, w };
    }
    return null;
  };
  const [view, setView] = useState({ x: 120, y: 360, z: 1 });
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const pp = useMemo(() => new Map(ports.map((p) => [p[0], p])), [ports]);
  const vis = (d: Device) => d.rack == null || d.face === face || d.face === "both";
  const cab = (id: number) => doc.cables.find((c) => c.id === id);

  return (
    <svg ref={svgRef} style={{ width: "100%", height: "100%", background: "#14161a" }}
      onWheel={(e) => {
        const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        setView((v) => ({ z: v.z * f, x: e.clientX - (e.clientX - v.x) * f, y: e.clientY - 40 - (e.clientY - 40 - v.y) * f }));
      }}
      onMouseDown={(e) => { if (e.target !== e.currentTarget) return; drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; }}
      onMouseMove={(e) => {
        const m = mv.current;
        if (m) {
          const dev = doc.devices.find((x) => x.id === m.id)!;
          const w = world(e, view); m.moved = true;
          const s = slotAt(dev, w.x - m.ox + 0, w.y - m.oy + UH / 2);
          if (s) {
            const t = { ...dev, rack: s.r.id, u: s.u, side: s.side };
            const q = devRect(doc, t);
            setGhost({ x: q.l, y: q.t, w: q.w, h: q.h, ok: fits(doc, s.r, t) });
          } else setGhost(null);
          return;
        }
        const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy })); }}
      onMouseUp={(e) => {
        drag.current = null;
        const m = mv.current; mv.current = null;
        if (!m) return;
        setGhost(null);
        if (!m.moved) return;
        const dev = doc.devices.find((x) => x.id === m.id)!;
        const w = world(e, view);
        const s = slotAt(dev, w.x - m.ox, w.y - m.oy + UH / 2);
        if (s && fits(doc, s.r, { ...dev, rack: s.r.id, u: s.u, side: s.side })) onMoveDevice(dev.id, s.r.id, s.u, s.side, 0, 0);
        else if (!s) onMoveDevice(dev.id, null, 1, 0, w.x - m.ox - 40, w.y - m.oy - UH / 2);
      }} onMouseLeave={() => { drag.current = null; mv.current = null; setGhost(null); }}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
        {doc.racks.map((r) => (
          <g key={r.id} onClick={(e) => { e.stopPropagation(); onSelect({ kind: "rack", id: r.id }); }}>
            <rect stroke={selected?.kind === "rack" && selected.id === r.id ? "#ffd33d" : "#3a3d42"} x={r.x} y={r.y} width={RW + 2 * RAIL} height={HDR + r.u * UH + PADB} rx={4} fill="#1d2025" />
            <text x={r.x + (RW + 2 * RAIL) / 2} y={r.y + 28} textAnchor="middle" fill="#e6e8eb" fontSize={16} fontWeight={600}>{r.name}</text>
            {Array.from({ length: r.u }, (_, i) => (
              <text key={i} x={r.x + 12} y={r.y + HDR + (r.u - i - 0.5) * UH + 4} textAnchor="middle" fill="#6b717a" fontSize={10}>{i + 1}</text>
            ))}
          </g>
        ))}
        {doc.devices.filter(vis).map((d) => {
          const q = devRect(doc, d);
          return (
            <g key={d.id} onMouseDown={(e) => {
                e.stopPropagation(); onSelect({ kind: "dev", id: d.id });
                const w = world(e, view); mv.current = { id: d.id, ox: w.x - q.l, oy: w.y - q.t, moved: false };
              }}>
              <rect stroke={selected?.kind === "dev" && selected.id === d.id ? "#ffd33d" : "#00000066"} strokeWidth={selected?.kind === "dev" && selected.id === d.id ? 2 : 1} x={q.l + 1} y={q.t + 1} width={q.w - 2} height={q.h - 2} rx={2} fill={d.color || "#3b6ea8"} />
              <text x={q.l + 8} y={q.t + q.h / 2 + 4} fill="#f2f4f7" fontSize={11}>{d.name}</text>
              {d.ports.map((p) => {
                const g = pp.get(p.id); if (!g) return null;
                const s = g[3];
                return (
                  <rect key={p.id} x={g[1] - s / 2} y={g[2] - s / 2} width={s} height={s} rx={1.5}
                    fill={PORT_COLORS[p.type] ?? "#888"} stroke={pendingPort === p.id ? "#ffd33d" : "#0008"} strokeWidth={pendingPort === p.id ? 2 : 1}
                    style={{ cursor: "crosshair" }} onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onPort(p.id); }}><title>{d.name} {p.name}</title></rect>
                );
              })}
            </g>
          );
        })}
        {ghost && <rect x={ghost.x} y={ghost.y} width={ghost.w} height={ghost.h} fill={ghost.ok ? "#2ea04355" : "#f8514955"} stroke={ghost.ok ? "#2ea043" : "#f85149"} />}
        {routes.routes.map((r) => {
          const c = cab(r.cable), sel = selected?.kind === "cable" && selected.id === r.cable, color = c?.color || "#999";
          const d = r.pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
          const dash = c?.style === "dashed" ? "6 4" : undefined;
          const plug = (p: [number, number], dir: number) => (
            <rect x={p[0] - 3} y={dir > 0 ? p[1] : p[1] - 8} width={6} height={8} fill={color} stroke={sel ? "#ffd33d" : "#000a"} />
          );
          return (
            <g key={r.cable} onClick={(e) => { e.stopPropagation(); onSelect({ kind: "cable", id: r.cable }); }} style={{ cursor: "pointer" }}>
              <path d={d} fill="none" stroke={sel ? "#ffd33d" : "#000c"} strokeWidth={LANE_W + 1.6} strokeLinejoin="miter" strokeLinecap="butt" />
              <path d={d} fill="none" stroke={color} strokeWidth={LANE_W} strokeDasharray={dash} strokeLinejoin="miter" strokeLinecap="butt" />
              {plug(r.pts[0], r.dir_a)}
              {plug(r.pts[r.pts.length - 1], r.dir_b)}
              <title>{c?.label || `cable ${r.cable}`}</title>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
