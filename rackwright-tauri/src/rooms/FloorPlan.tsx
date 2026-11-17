import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc } from "../types";
import type { Units } from "../settings/types";
import { v } from "../theme";
import { footprint, OBJ_TYPES, spotId, tileFree } from "./model";
import { floorLinks } from "./floorLinks";
import type { RackSpot, Room, RoomObject, Rot } from "./types";

export type FloorSel = { kind: "rack" | "obj"; id: string | number } | null;
const TILE = 44;

interface Drag { kind: "rack" | "obj" | "resize"; id: string | number; ox: number; oy: number; x: number; y: number; rot: Rot; w: number; h: number; moved: boolean }
interface Box { kind: "rack" | "obj"; id: string | number; x: number; y: number; w: number; h: number }

export interface FloorPlanProps {
  room: Room;
  docs: Record<string, Doc | string>;
  units: Units;
  onChange: (room: Room) => void;
  onOpenRack: (key: string, rackId: number) => void;
  onSelect: (sel: FloorSel) => void;
  selected: FloorSel;
}

function rackInfo(docs: Record<string, Doc | string>, s: RackSpot) {
  const d = docs[s.key];
  if (!d || typeof d === "string") return { name: "Rack", used: 0, total: 0 };
  const r = d.racks.find((x) => x.id === s.rack);
  const used = d.devices.filter((x) => x.rack === s.rack).reduce((n, x) => n + (x.u_size || 0), 0);
  return { name: r?.name || "Rack", used, total: r?.u ?? 0 };
}

export function FloorPlan({ room, docs, units, onChange, onOpenRack, onSelect, selected }: FloorPlanProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [cables, setCables] = useState(true);
  dragRef.current = drag;
  const W = room.w * TILE, H = room.d * TILE;

  const boxes: Box[] = useMemo(() => [
    ...room.objects.map((o) => ({ kind: "obj" as const, id: o.id, x: o.x, y: o.y, w: o.w, h: o.h })),
    ...room.racks.map((s) => { const f = footprint(s.rot); return { kind: "rack" as const, id: spotId(s), x: s.x, y: s.y, w: f.w, h: f.h }; }),
  ], [room]);
  const links = useMemo(() => (cables ? floorLinks(room, docs) : []), [cables, room, docs]);

  // R while dragging a rack rotates it a quarter turn
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = dragRef.current;
      if (d && d.kind === "rack" && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        setDrag({ ...d, rot: ((d.rot + 90) % 360) as Rot });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tileAt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * room.w, y: ((e.clientY - r.top) / r.height) * room.d };
  };

  const start = (e: React.PointerEvent, kind: "rack" | "obj" | "resize", id: string | number, b: Box, rot: Rot = 0) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = tileAt(e);
    if (kind !== "resize") onSelect({ kind, id });
    setDrag({ kind, id, ox: p.x - b.x, oy: p.y - b.y, x: b.x, y: b.y, rot, w: b.w, h: b.h, moved: false });
  };

  const move = (e: React.PointerEvent) => {
    const d = drag; if (!d) return;
    const p = tileAt(e);
    if (d.kind === "resize") {
      setDrag({ ...d, w: Math.max(1, Math.min(room.w - d.x, Math.round(p.x - d.x))), h: Math.max(1, Math.min(room.d - d.y, Math.round(p.y - d.y))), moved: true });
    } else {
      const f = d.kind === "rack" ? footprint(d.rot) : { w: d.w, h: d.h };
      const x = Math.max(0, Math.min(room.w - f.w, Math.round(p.x - d.ox))), y = Math.max(0, Math.min(room.d - f.h, Math.round(p.y - d.oy)));
      setDrag({ ...d, x, y, moved: true });
    }
  };

  const end = () => {
    const d = drag; setDrag(null);
    if (!d || !d.moved) return;
    if (d.kind === "resize") {
      const o = room.objects.find((q) => q.id === d.id); if (!o) return;
      if (!tileFree(room, o.x, o.y, d.w, d.h, { kind: "obj", id: o.id })) return;
      if (d.w === o.w && d.h === o.h) return;
      onChange({ ...room, objects: room.objects.map((q) => (q.id === o.id ? { ...q, w: d.w, h: d.h } : q)) });
    } else if (d.kind === "rack") {
      const s = room.racks.find((q) => spotId(q) === d.id); if (!s) return;
      const f = footprint(d.rot);
      if (!tileFree(room, d.x, d.y, f.w, f.h, { kind: "rack", id: d.id })) return; // snap back
      if (d.x === s.x && d.y === s.y && d.rot === s.rot) return;
      onChange({ ...room, racks: room.racks.map((q) => (spotId(q) === d.id ? { ...q, x: d.x, y: d.y, rot: d.rot } : q)) });
    } else {
      const o = room.objects.find((q) => q.id === d.id); if (!o) return;
      if (!tileFree(room, d.x, d.y, o.w, o.h, { kind: "obj", id: o.id })) return;
      if (d.x === o.x && d.y === o.y) return;
      onChange({ ...room, objects: room.objects.map((q) => (q.id === o.id ? { ...q, x: d.x, y: d.y } : q)) });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selected?.kind === "obj") {
      e.preventDefault();
      onChange({ ...room, objects: room.objects.filter((o) => o.id !== selected.id) });
      onSelect(null);
    }
  };

  // identical boxes (overlap allowed) draw as side-by-side slices
  const slice = (b: Box, x: number, y: number, w: number, h: number) => {
    const same = boxes.filter((o) => o.x === b.x && o.y === b.y && o.w === b.w && o.h === b.h);
    const n = same.length, i = same.findIndex((o) => o.kind === b.kind && o.id === b.id);
    let L = x * TILE, T = y * TILE, Wd = w * TILE, Ht = h * TILE;
    if (n > 1 && !drag) { if (Wd > Ht) { Ht /= n; T += i * Ht; } else { Wd /= n; L += i * Wd; } }
    return { L, T, Wd, Ht, n, i };
  };

  const center = (id: string) => {
    const s = room.racks.find((q) => spotId(q) === id)!, f = footprint(s.rot);
    return { x: (s.x + f.w / 2) * TILE, y: (s.y + f.h / 2) * TILE };
  };
  const unitNote = units === "in" ? "1 tile = 2 ft" : "1 tile = 600 mm";
  const isSel = (k: string, id: string | number) => selected?.kind === k && selected.id === id;

  const renderObj = (o: RoomObject) => {
    const d = drag && drag.id === o.id && drag.kind !== "rack" ? drag : null;
    const x = d && d.kind === "obj" ? d.x : o.x, y = d && d.kind === "obj" ? d.y : o.y;
    const w = d && d.kind === "resize" ? d.w : o.w, h = d && d.kind === "resize" ? d.h : o.h;
    const b: Box = { kind: "obj", id: o.id, x: o.x, y: o.y, w: o.w, h: o.h };
    const s = slice(b, x, y, w, h);
    const sel = isSel("obj", o.id);
    return (
      <g key={"o" + o.id} onPointerDown={(e) => start(e, "obj", o.id, b)} style={{ cursor: "move" }}>
        <rect x={s.L} y={s.T} width={s.Wd} height={s.Ht} rx={3} fill={o.type === "door" ? "url(#fp-hatch)" : v("panel-2")} fillOpacity={o.type === "door" ? 1 : 0.6}
          stroke={sel ? v("select") : v("text-muted")} strokeWidth={sel ? 2 : 1.2} strokeDasharray="5 3" />
        <text x={s.L + s.Wd / 2} y={s.T + s.Ht / 2} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill={v("text")} pointerEvents="none">{o.label || OBJ_TYPES[o.type]}</text>
        {s.n > 1 && <text x={s.L + 3} y={s.T + 11} fontSize={9} fill={v("text-muted")} pointerEvents="none">{s.i + 1}/{s.n}</text>}
        {sel && (
          <rect x={s.L + s.Wd - 6} y={s.T + s.Ht - 6} width={12} height={12} fill={v("select")} stroke={v("bg")} style={{ cursor: "nwse-resize" }}
            onPointerDown={(e) => start(e, "resize", o.id, b)} />
        )}
      </g>
    );
  };

  const renderRack = (sp: RackSpot) => {
    const id = spotId(sp);
    const d = drag && drag.kind === "rack" && drag.id === id ? drag : null;
    const rot = d ? d.rot : sp.rot, x = d ? d.x : sp.x, y = d ? d.y : sp.y;
    const f = footprint(rot);
    const b: Box = { kind: "rack", id, x: sp.x, y: sp.y, w: footprint(sp.rot).w, h: footprint(sp.rot).h };
    const s = slice(b, x, y, f.w, f.h);
    const ins = 2, L = s.L + ins, T = s.T + ins, Wd = s.Wd - ins * 2, Ht = s.Ht - ins * 2;
    const sel = isSel("rack", id), info = rackInfo(docs, sp);
    const bad = d && !tileFree(room, d.x, d.y, f.w, f.h, { kind: "rack", id });
    // front edge: rot 0 = bottom, 90 = left, 180 = top, 270 = right
    const edge = rot === 0 ? [L, T + Ht, L + Wd, T + Ht] : rot === 180 ? [L, T, L + Wd, T] : rot === 90 ? [L, T, L, T + Ht] : [L + Wd, T, L + Wd, T + Ht];
    const name = info.name.length > 9 && Wd < TILE * 1.5 ? info.name.slice(0, 8) + "..." : info.name;
    return (
      <g key={"r" + id} onPointerDown={(e) => start(e, "rack", id, b, sp.rot)} onDoubleClick={() => onOpenRack(sp.key, sp.rack)} style={{ cursor: "move" }} opacity={d ? 0.85 : 1}>
        <rect x={L} y={T} width={Wd} height={Ht} rx={3} fill={v("panel")} stroke={bad ? v("danger") : sel ? v("select") : v("border")} strokeWidth={sel || bad ? 2 : 1.2} />
        <line x1={edge[0]} y1={edge[1]} x2={edge[2]} y2={edge[3]} stroke={v("accent")} strokeWidth={4} strokeLinecap="round" />
        <text x={L + Wd / 2} y={T + Ht / 2 - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={v("text")} pointerEvents="none">{name}</text>
        <text x={L + Wd / 2} y={T + Ht / 2 + 8} textAnchor="middle" fontSize={10} fill={v("text-muted")} pointerEvents="none">{info.used}/{info.total}U</text>
        {s.n > 1 && <text x={L + 3} y={T + 11} fontSize={9} fill={v("text-muted")} pointerEvents="none">{s.i + 1}/{s.n}</text>}
        <title>{info.name} - double-click to open</title>
      </g>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} onKeyDown={onKeyDown} tabIndex={0}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: v("text-muted") }}>
        <span>{unitNote}</span>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={cables} onChange={(e) => setCables(e.target.checked)} /> Show cabling between racks
        </label>
        <span>Drag to move. Press R while dragging to rotate. Double-click a rack to open it.</span>
      </div>
      <div style={{ overflow: "auto" }}>
        <svg ref={svgRef} data-floorplan="" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H}
          style={{ background: v("bg"), border: `2px solid ${v("border")}`, touchAction: "none", userSelect: "none", display: "block" }}
          onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)} onPointerDown={() => onSelect(null)}>
          <defs>
            <pattern id="fp-grid" width={TILE} height={TILE} patternUnits="userSpaceOnUse">
              <path d={`M${TILE} 0 H0 V${TILE}`} fill="none" stroke={v("border-subtle")} strokeWidth={1} />
            </pattern>
            <pattern id="fp-hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={8} height={8} fill={v("panel-2")} />
              <line x1={0} y1={0} x2={0} y2={8} stroke={v("text-muted")} strokeWidth={2} />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#fp-grid)" />
          {room.objects.map(renderObj)}
          {room.racks.map(renderRack)}
          {links.map((l) => {
            const A = center(l.a), B = center(l.b);
            const mx = (A.x + B.x) / 2, span = Math.hypot(B.x - A.x, B.y - A.y);
            const arc = (off: number) => {
              const my = (A.y + B.y) / 2 - TILE * 0.4 - span * 0.15 + off;
              return { d: `M${A.x},${A.y} Q${mx},${my} ${B.x},${B.y}`, lx: 0.25 * A.x + 0.5 * mx + 0.25 * B.x, ly: 0.25 * A.y + 0.5 * my + 0.25 * B.y };
            };
            const out = [];
            if (l.data) {
              const a = arc(0);
              out.push(<g key={l.a + l.b + "d"} pointerEvents="none"><path d={a.d} fill="none" stroke={v("link")} strokeWidth={Math.min(6, 1.2 + Math.log2(l.data + 1))} opacity={0.85} />
                <rect x={a.lx - 10} y={a.ly - 8} width={20} height={16} rx={8} fill={v("link")} /><text x={a.lx} y={a.ly} textAnchor="middle" dominantBaseline="central" fontSize={10} fill={v("on-accent")}>{l.data}</text></g>);
            }
            if (l.power) {
              const a = arc(l.data ? 16 : 0);
              out.push(<g key={l.a + l.b + "p"} pointerEvents="none"><path d={a.d} fill="none" stroke={v("warn")} strokeWidth={Math.min(6, 1.2 + Math.log2(l.power + 1))} strokeDasharray="5 4" opacity={0.85} />
                <rect x={a.lx - 10} y={a.ly - 8} width={20} height={16} rx={8} fill={v("warn")} /><text x={a.lx} y={a.ly} textAnchor="middle" dominantBaseline="central" fontSize={10} fill={v("on-accent")}>{l.power}</text></g>);
            }
            return out;
          })}
        </svg>
      </div>
    </div>
  );
}
