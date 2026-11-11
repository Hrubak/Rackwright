import { useMemo, useRef, useState } from "react";
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

export default function RackView({ doc, face, routes, ports, selected, onSelect }: {
  doc: Doc; face: "front" | "rear"; routes: RouteResult; ports: PortPos[];
  selected: number | null; onSelect: (cableId: number | null) => void;
}) {
  const [view, setView] = useState({ x: 120, y: 360, z: 1 });
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const pp = useMemo(() => new Map(ports.map((p) => [p[0], p])), [ports]);
  const vis = (d: Device) => d.rack == null || d.face === face || d.face === "both";
  const cab = (id: number) => doc.cables.find((c) => c.id === id);

  return (
    <svg style={{ width: "100%", height: "100%", background: "#14161a" }}
      onWheel={(e) => {
        const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        setView((v) => ({ z: v.z * f, x: e.clientX - (e.clientX - v.x) * f, y: e.clientY - 40 - (e.clientY - 40 - v.y) * f }));
      }}
      onMouseDown={(e) => { drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; }}
      onMouseMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy })); }}
      onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}
      onClick={(e) => { if ((e.target as Element).tagName === "svg") onSelect(null); }}>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
        {doc.racks.map((r) => (
          <g key={r.id}>
            <rect x={r.x} y={r.y} width={RW + 2 * RAIL} height={HDR + r.u * UH + PADB} rx={4} fill="#1d2025" stroke="#3a3d42" />
            <text x={r.x + (RW + 2 * RAIL) / 2} y={r.y + 28} textAnchor="middle" fill="#e6e8eb" fontSize={16} fontWeight={600}>{r.name}</text>
            {Array.from({ length: r.u }, (_, i) => (
              <text key={i} x={r.x + 12} y={r.y + HDR + (r.u - i - 0.5) * UH + 4} textAnchor="middle" fill="#6b717a" fontSize={10}>{i + 1}</text>
            ))}
          </g>
        ))}
        {doc.devices.filter(vis).map((d) => {
          const q = devRect(doc, d);
          return (
            <g key={d.id}>
              <rect x={q.l + 1} y={q.t + 1} width={q.w - 2} height={q.h - 2} rx={2} fill={d.color || "#3b6ea8"} stroke="#00000066" />
              <text x={q.l + 8} y={q.t + q.h / 2 + 4} fill="#f2f4f7" fontSize={11}>{d.name}</text>
              {d.ports.map((p) => {
                const g = pp.get(p.id); if (!g) return null;
                const s = g[3];
                return (
                  <rect key={p.id} x={g[1] - s / 2} y={g[2] - s / 2} width={s} height={s} rx={1.5}
                    fill={PORT_COLORS[p.type] ?? "#888"} stroke="#0008"><title>{d.name} {p.name}</title></rect>
                );
              })}
            </g>
          );
        })}
        {routes.routes.map((r) => {
          const c = cab(r.cable), sel = selected === r.cable, color = c?.color || "#999";
          const d = r.pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
          const dash = c?.style === "dashed" ? "6 4" : undefined;
          const plug = (p: [number, number], dir: number) => (
            <rect x={p[0] - 3} y={dir > 0 ? p[1] : p[1] - 8} width={6} height={8} fill={color} stroke={sel ? "#ffd33d" : "#000a"} />
          );
          return (
            <g key={r.cable} onClick={(e) => { e.stopPropagation(); onSelect(r.cable); }} style={{ cursor: "pointer" }}>
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
