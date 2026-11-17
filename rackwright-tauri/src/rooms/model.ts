// Pure room model: no backend or Tauri imports (tests load this under Node).
import type { RackSource, RackSpot, Room, RoomObject } from "./types";

export const OBJ_TYPES: Record<RoomObject["type"], string> = {
  door: "Door", ac: "Cooling / CRAC", panel: "Power panel", desk: "Desk / bench", label: "Label / zone",
};

export const spotId = (s: { key: string; rack: number }) => `${s.key}#${s.rack}`;
export const footprint = (rot: number): { w: number; h: number } => (rot % 180 === 0 ? { w: 1, h: 2 } : { w: 2, h: 1 });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

type Except = { kind: "rack" | "obj"; id: string | number };
interface Box { kind: "rack" | "obj"; id: string | number; x: number; y: number; w: number; h: number }

function items(room: Room): Box[] {
  return [
    ...room.racks.map((s) => { const f = footprint(s.rot); return { kind: "rack" as const, id: spotId(s), x: s.x, y: s.y, w: f.w, h: f.h }; }),
    ...room.objects.map((o) => ({ kind: "obj" as const, id: o.id, x: o.x, y: o.y, w: o.w, h: o.h })),
  ];
}
const overlap = (a: Box, b: { x: number; y: number; w: number; h: number }) =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

export function occupied(room: Room, except?: Except): Set<string> {
  const s = new Set<string>();
  for (const it of items(room)) {
    if (except && it.kind === except.kind && it.id === except.id) continue;
    for (let i = it.x; i < it.x + it.w; i++) for (let j = it.y; j < it.y + it.h; j++) s.add(`${i},${j}`);
  }
  return s;
}

export function tileFree(room: Room, x: number, y: number, w: number, h: number, except?: Except): boolean {
  if (x < 0 || y < 0 || x + w > room.w || y + h > room.d) return false;
  if (room.allow_overlap) return true;
  return !items(room).some((it) => !(except && it.kind === except.kind && it.id === except.id) && overlap(it, { x, y, w, h }));
}

export function findFreeTile(room: Room, w: number, h: number): { x: number; y: number } | null {
  for (let y = 0; y < room.d; y++) for (let x = 0; x < room.w; x++) if (tileFree(room, x, y, w, h)) return { x, y };
  return null;
}

export function nextId(room: Room): number {
  return room.objects.reduce((m, o) => Math.max(m, o.id), 0) + 1;
}

// Drop spots whose document or rack no longer exists. Returns new rooms.
export function cleanRooms(rooms: Room[], racks: RackSource[]): Room[] {
  const ok = new Set(racks.flatMap((r) => r.rackIds.map((id) => `${r.key}#${id}`)));
  return rooms.map((rm) => ({ ...clone(rm), racks: clone(rm.racks.filter((s) => ok.has(spotId(s)))) }));
}

export function ensureRooms(rooms: Room[] | undefined, racks: RackSource[]): { rooms: Room[]; changed: boolean } {
  let changed = false;
  let out: Room[] = clone(rooms ?? []);
  if (!out.length) { out = [{ id: 1, name: "Main room", w: 14, d: 9, objects: [], racks: [] }]; changed = true; }
  const cleaned = cleanRooms(out, racks);
  if (cleaned.some((rm, i) => rm.racks.length !== out[i].racks.length)) changed = true;
  out = cleaned;
  const placed = new Set(out.flatMap((rm) => rm.racks.map(spotId)));
  for (const src of racks) for (const id of src.rackIds) {
    if (placed.has(`${src.key}#${id}`)) continue;
    const rm = out[0], f = footprint(0);
    // no free tile: stack at the top-left rather than lose the rack
    const p = findFreeTile(rm, f.w, f.h) ?? { x: 0, y: 0 };
    rm.racks.push({ key: src.key, rack: id, x: p.x, y: p.y, rot: 0 });
    changed = true;
  }
  return { rooms: out, changed };
}

// Port of RackMap resizeRoom: walls stay walls, rack rows stay together, nearest free spot.
export function resizeRoom(input: Room, w: number, d: number, scale: boolean): { room: Room; failed: number } {
  const room = clone(input);
  const ow = room.w, od = room.d, sx = scale ? w / ow : 1, sy = scale ? d / od : 1;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const place = (x: number, y: number, bw: number, bh: number) => {
    let nx = Math.round((x + bw / 2) * sx - bw / 2), ny = Math.round((y + bh / 2) * sy - bh / 2);
    if (x === 0) nx = 0; else if (x + bw === ow) nx = w - bw;
    if (y === 0) ny = 0; else if (y + bh === od) ny = d - bh;
    return { x: clamp(nx, 0, Math.max(0, w - bw)), y: clamp(ny, 0, Math.max(0, d - bh)) };
  };
  const occ = new Set<string>();
  const free = (x: number, y: number, bw: number, bh: number) => {
    if (x < 0 || y < 0 || x + bw > w || y + bh > d) return false;
    for (let i = x; i < x + bw; i++) for (let j = y; j < y + bh; j++) if (occ.has(`${i},${j}`)) return false;
    return true;
  };
  const mark = (x: number, y: number, bw: number, bh: number) => { for (let i = x; i < x + bw; i++) for (let j = y; j < y + bh; j++) occ.add(`${i},${j}`); };
  const nearest = (x: number, y: number, bw: number, bh: number) => {
    if (free(x, y, bw, bh)) return { x, y };
    for (let r = 1; r < Math.max(w, d) * 2; r++)
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (free(x + dx, y + dy, bw, bh)) return { x: x + dx, y: y + dy };
      }
    return null;
  };
  let failed = 0;
  const put = (x: number, y: number, bw: number, bh: number, apply: (x: number, y: number) => void) => {
    const q = nearest(x, y, bw, bh);
    if (q) { apply(q.x, q.y); mark(q.x, q.y, bw, bh); return; }
    apply(x, y); failed++;
  };
  // rack rows stay together
  const racks = [...room.racks].sort((a, b) => a.y - b.y || a.x - b.x);
  const used = new Set<RackSpot>(), groups: RackSpot[][] = [];
  for (const r of racks) {
    if (used.has(r)) continue;
    const g = [r]; used.add(r);
    const horiz = r.rot % 180 === 0;
    for (;;) {
      const last = g[g.length - 1], f = footprint(last.rot);
      const nx = horiz ? last.x + f.w : last.x, ny = horiz ? last.y : last.y + f.h;
      const nb = racks.find((o) => !used.has(o) && o.x === nx && o.y === ny && o.rot % 180 === r.rot % 180);
      if (!nb) break;
      g.push(nb); used.add(nb);
    }
    groups.push(g);
  }
  for (const o of room.objects) { o.w = Math.min(o.w, w); o.h = Math.min(o.h, d); }
  const onWall = (o: RoomObject) => o.x === 0 || o.y === 0 || o.x + o.w === ow || o.y + o.h === od;
  const placeObj = (o: RoomObject) => { const p = place(o.x, o.y, o.w, o.h); put(p.x, p.y, o.w, o.h, (x, y) => { o.x = x; o.y = y; }); };
  const placeRack = (r: RackSpot) => { const f = footprint(r.rot); const p = place(r.x, r.y, f.w, f.h); put(p.x, p.y, f.w, f.h, (x, y) => { r.x = x; r.y = y; }); };
  // doors and panels on walls first, then racks, then the rest
  room.objects.filter(onWall).forEach(placeObj);
  for (const g of groups) {
    if (g.length === 1) { placeRack(g[0]); continue; }
    const horiz = g[0].rot % 180 === 0, f = footprint(g[0].rot);
    const bw = horiz ? g.reduce((s, r) => s + footprint(r.rot).w, 0) : f.w;
    const bh = horiz ? f.h : g.reduce((s, r) => s + footprint(r.rot).h, 0);
    if (bw > w || bh > d) { g.forEach(placeRack); continue; }
    const p = place(g[0].x, g[0].y, bw, bh), q = nearest(p.x, p.y, bw, bh);
    if (!q) { g.forEach(placeRack); continue; }
    let cx = q.x, cy = q.y;
    for (const r of g) { const rf = footprint(r.rot); r.x = cx; r.y = cy; if (horiz) cx += rf.w; else cy += rf.h; }
    mark(q.x, q.y, bw, bh);
  }
  room.objects.filter((o) => !onWall(o)).sort((a, b) => b.w * b.h - a.w * a.h).forEach(placeObj);
  room.w = w; room.d = d;
  return { room, failed };
}
