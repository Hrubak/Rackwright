import { Doc, Device, Rack, Cable, RW, RAIL, UH, HDR } from "./types";
import catalog from "./catalog.json";
import type { RackSpec } from "./racks";

export interface Tpl {
  name: string; type: string; u_size: number; color: string; half?: boolean; cols?: number; rows?: number;
  model?: string; ip?: string; short?: string; group?: string; plate?: any; power_w?: number; rated_w?: number;
  ports: { name: string; type: string; label?: string }[];
}
export const CATALOG = catalog as Tpl[];

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function nid(doc: Doc): number { return doc.nid++; }

export function fromTpl(doc: Doc, t: Tpl): Device {
  const d: any = {
    id: nid(doc), name: t.short || t.name, model: t.model || "", type: t.type, u_size: t.u_size, rack: null, u: 1,
    side: 0, half: !!t.half, color: t.color, ip: t.ip || "", serial: "", notes: "", rows: t.rows || 0,
    ports: [], fx: 0, fy: 0, face: "front",
  };
  if (t.half && t.cols && t.cols > 2) d.cols = t.cols;
  if (t.plate) { d.plate = clone(t.plate); d.face = "both"; }
  for (const p of t.ports) d.ports.push({ id: nid(doc), name: p.name, type: p.type, label: p.label || "" });
  return d;
}

type Width = { half?: boolean; cols?: number };
/** Columns a row is split into for this device: 1 = full width, 2 = half width, 3 = a third (HE150 on a shelf). */
export const colsOf = (d: Width) => (d.half ? Math.max(2, Math.round(d.cols || 2)) : 1);
/** The columns (`side` values) this device can stand in. */
export const sidesOf = (d: Width) => Array.from({ length: colsOf(d) }, (_, i) => i);
/** Left edge offset inside the rack, in px. */
export const xOffset = (d: Width & { side: number }) => { const n = colsOf(d); return n > 1 ? (RW / n) * Math.min(Math.max(0, d.side), n - 1) : 0; };
/** Do two devices in the same U share any width? */
function overlapX(a: Width, sa: number, b: Width, sb: number): boolean {
  const na = colsOf(a), nb = colsOf(b);
  const a0 = Math.min(Math.max(0, na > 1 ? sa : 0), na - 1) / na, b0 = Math.min(Math.max(0, nb > 1 ? sb : 0), nb - 1) / nb;
  return a0 < b0 + 1 / nb - 1e-9 && b0 < a0 + 1 / na - 1e-9;
}
/** "half", "1/3" or "" for the device lists. */
export const widthLabel = (d: Width) => (colsOf(d) === 2 ? " half" : colsOf(d) > 2 ? ` 1/${colsOf(d)}` : "");
/** Side for a column chosen with the arrow keys. */
export const stepSide = (d: Width & { side: number }, dir: -1 | 1) => Math.min(colsOf(d) - 1, Math.max(0, d.side + dir));

/**
 * How a device is mounted. "Front" and "rear" are the rails the device hangs on (its ports face that way);
 * full depth fills the U at both faces, short leaves the other face free for something else.
 */
export type Mount = "front" | "front-short" | "rear" | "rear-short";
export const MOUNTS: { v: Mount; label: string }[] = [
  { v: "front", label: "Front, full depth" },
  { v: "front-short", label: "Front only (short)" },
  { v: "rear", label: "Rear, full depth (ports face the rear)" },
  { v: "rear-short", label: "Rear only (short)" },
];
export function mountOf(d: Pick<Device, "face"> & { rev?: boolean }): Mount {
  const f = d.face || "front";
  if (f === "both") return d.rev ? "rear" : "front";
  return f === "rear" ? "rear-short" : "front-short";
}
/** Set face / rev for a mount choice. */
export function setMount(d: Device, m: Mount) {
  d.face = m === "front" || m === "rear" ? "both" : m === "front-short" ? "front" : "rear";
  if (m.startsWith("rear")) d.rev = true; else delete d.rev;
}
/** Bring older documents up to date when they are opened. HE150 nodes stand three to a shelf since 2.9.0. */
export function upgradeDoc(doc: Doc): Doc {
  for (const d of doc.devices) {
    if (d.plate?.nuc === "he150" && d.half && !d.cols) { d.cols = 3; if (d.side === 1) d.side = 2; }
  }
  return doc;
}
/** Which panel of the device faces the viewer on this face of the rack. */
export const showsRear = (d: { rev?: boolean }, face: "front" | "rear") => (face === "rear") !== !!d.rev;

export function fits(doc: Doc, r: Rack, d: Device, ignore?: Set<number>): boolean {
  const lo = d.u, hi = d.u + d.u_size - 1;
  if (lo < 1 || hi > r.u) return false;
  for (const o of doc.devices) {
    if (o.rack !== r.id || o.id === d.id || ignore?.has(o.id)) continue;
    const fa = o.face || "front", fb = d.face || "front";
    if (!(fa === fb || fa === "both" || fb === "both")) continue;
    if (o.u <= hi && o.u + o.u_size - 1 >= lo) {
      if (overlapX(o, o.side, d, d.side)) return false;
    }
  }
  return true;
}

/** Heavy gear belongs low in the rack; everything else is filled from the top down. */
export const isHeavy = (d: { type: string; plate?: any }) => d.type === "UPS" || d.type === "Storage" || d.plate?.style === "bp";

export function findFree(doc: Doc, r: Rack, d: Device): [number, number] | null {
  const maxU = r.u - d.u_size + 1, fromTop = !isHeavy(d);
  for (let i = 0; i < maxU; i++) {
    const u = fromTop ? maxU - i : i + 1;
    for (const side of sidesOf(d))
      if (checkPlace(doc, d, r, u, side).ok) return [u, side];
  }
  return null;
}

export type Shape = "disc" | "squircle" | "rect";
export const BLOB = 64; // diameter of a free-standing AP (mirrors AP_D in geom.rs)

/** Free-standing (off-rack) access points are drawn as discs/squircles, everything else as a rectangle. */
export function shapeOf(d: Pick<Device, "type" | "rack" | "plate" | "model" | "name">): Shape {
  if (d.rack != null || d.type !== "Wireless" || !d.plate) return "rect";
  const isAp = d.plate.k === "uap" || d.plate.style === "ap";
  if (!isAp) return "rect";
  return /nanohd|mr4|mr5|ruckus|r[3-7]\d0|9120|ap-5/i.test(`${d.model} ${d.name}`) ? "squircle" : "disc";
}
export function devDims(d: Pick<Device, "type" | "rack" | "plate" | "model" | "name" | "half" | "u_size"> & { cols?: number }) {
  if (shapeOf(d) !== "rect") return { w: BLOB, h: BLOB };
  return { w: RW / colsOf(d), h: Math.max(1, d.u_size) * UH };
}

export interface Placement { ok: boolean; why?: string; warn?: string }
const no = (why: string): Placement => ({ ok: false, why });

/** Full sanity check for putting `d` at (`u`, `side`) in rack `r`. `d` itself is ignored when it is already in the rack. */
export function checkPlace(doc: Doc, d: Device, r: Rack, u: number, side: number): Placement {
  const off = !!d.plate?.off;
  if (off && d.type === "Wireless") return no("Access points are wall/ceiling mounted, not rack mounted");
  if (d.u_size > r.u) return no(`${d.name} is ${d.u_size}U but ${r.name} is only ${r.u}U`);
  const lo = u, hi = u + d.u_size - 1;
  if (lo < 1) return no("Doesn't fit: runs below the bottom of the rack");
  if (hi > r.u) return no("Doesn't fit: runs past the top of the rack");
  let shelf = false;
  for (const o of doc.devices) {
    if (o.rack !== r.id || o.id === d.id) continue;
    const fa = o.face || "front", fb = d.face || "front";
    if (!(fa === fb || fa === "both" || fb === "both")) continue;
    if (o.u > hi || o.u + o.u_size - 1 < lo) continue;
    // A desktop unit stands on a shelf with its bottom U; a taller unit (2U) rises above the shelf into free U.
    if (off && o.type === "Shelf" && o.u <= lo && o.u + o.u_size - 1 >= lo) { shelf = true; continue; }
    if (!overlapX(o, o.side, d, side)) continue;
    return no(`U${Math.max(lo, o.u)} is taken by ${o.name}`);
  }
  if (off && !shelf) return no(`${d.name} is a desktop unit: put it on a Shelf or leave it off-rack`);
  let warn: string | undefined;
  if (isHeavy(d) && lo > r.u / 2) warn = `${d.name} is heavy: normally mounted in the lower half`;
  return { ok: true, warn };
}

/**
 * Put desktop gear `d` (plate.off) on a shelf in rack `r`. Tries a shelf that already has room, else adds a 1U Shelf.
 * The unit stands on the shelf with its bottom U and may rise above it (2U units). Sets d.rack/u/side and
 * returns true; d is NOT added to doc.devices (the caller does that, unless it is in there already).
 * `near` = U to stay close to (a unit being swapped); without it the search runs from the top of the rack.
 * Detach `d` from the rack first when it is already in the document, so its old slot counts as free.
 */
export function placeOnShelf(doc: Doc, d: Device, r: Rack, near?: number): boolean {
  const tplShelf = CATALOG.find((c) => c.type === "Shelf");
  if (!tplShelf) return false;
  const shelves = doc.devices.filter((x) => x.rack === r.id && x.type === "Shelf");
  const sides = sidesOf(d);
  const maxU = Math.max(0, r.u - d.u_size + 1);
  const us = Array.from({ length: maxU }, (_, i) => maxU - i); // top down
  if (near != null) us.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || b - a);
  const useExisting = () => {
    const list = near == null ? shelves : shelves.slice().sort((a, b) => Math.abs(a.u - near) - Math.abs(b.u - near));
    for (const sh of list) for (const side of sides)
      if (checkPlace(doc, { ...d, rack: r.id, u: sh.u }, r, sh.u, side).ok) { d.rack = r.id; d.u = sh.u; d.side = side; return true; }
    return false;
  };
  const addShelf = (u: number) => {
    const shelf = fromTpl(doc, tplShelf); shelf.face = "front"; shelf.name = "Shelf";
    if (!checkPlace(doc, shelf, r, u, 0).ok) return false;
    shelf.rack = r.id; shelf.u = u; shelf.side = 0; doc.devices.push(shelf);
    for (const side of sides) if (checkPlace(doc, d, r, u, side).ok) { d.rack = r.id; d.u = u; d.side = side; return true; }
    doc.devices.pop();
    return false;
  };
  if (near != null && near >= 1 && near <= maxU && addShelf(near)) return true; // a shelf right under it
  
  if (useExisting()) return true;
  for (const u of us) if (addShelf(u)) return true;
  return false;
}

export type Target =
  | { kind: "rack"; r: Rack; u: number; side: number; p: Placement }
  | { kind: "float"; fx: number; fy: number }
  | { kind: "none" };

/**
 * Where would `d` land if dropped with the cursor at world (wx, wy)? In a rack the U under the cursor
 * is the TOP row of the device (clamped to the rack), otherwise it floats free.
 * `grab` = cursor offset inside the device when moving an existing one.
 */
export function resolveTarget(doc: Doc, d: Device, wx: number, wy: number, grab?: { ox: number; oy: number }): Target {
  const { w, h } = devDims({ ...d, rack: null });
  const cx = grab ? wx - grab.ox + w / 2 : wx;
  const rowY = grab ? wy - grab.oy + UH / 2 : wy;
  for (const r of doc.racks) {
    const l = r.x + RAIL;
    if (cx < l - 40 || cx > l + RW + 40 || rowY < r.y + HDR - 20 || rowY > r.y + HDR + r.u * UH + 20) continue;
    const row = Math.floor((r.y + HDR + r.u * UH - rowY) / UH); // 0 = bottom U
    const u = Math.min(Math.max(1, row + 1 - (d.u_size - 1)), Math.max(1, r.u - d.u_size + 1));
    const n = colsOf(d), side = n > 1 ? Math.min(n - 1, Math.max(0, Math.floor(((cx - l) / RW) * n))) : 0;
    return { kind: "rack", r, u, side, p: checkPlace(doc, d, r, u, side) };
  }
  return grab ? { kind: "float", fx: wx - grab.ox, fy: wy - grab.oy } : { kind: "float", fx: wx - w / 2, fy: wy - h / 2 };
}

/** Light stand-in for a catalog item (used for the drag ghost and palette filtering). */
export function protoOf(t: Tpl): Device {
  return fromTpl({ v: 1, nid: 1_000_000_000, racks: [], devices: [], cables: [] }, t);
}
export function tplRackStatus(doc: Doc, rack: Rack | undefined, t: Tpl): "ok" | "off" | "full" | "none" {
  if (!rack) return t.plate?.off ? "off" : "none";
  const d = { ...protoOf(t), face: t.plate ? "both" : "front" } as Device;
  // Desktop gear fits when a shelf has room for it; otherwise it goes off-rack (or onto a new shelf).
  if (t.plate?.off) return findFree(doc, rack, d) ? "ok" : "off";
  return findFree(doc, rack, d) ? "ok" : "full";
}

export function rackUsage(doc: Doc, r: Rack) {
  const used = new Set<number>();
  for (const d of doc.devices) if (d.rack === r.id) for (let i = 0; i < d.u_size; i++) used.add(d.u + i);
  return { used: used.size, free: r.u - used.size };
}

export function duplicateDevice(doc: Doc, id: number): Device | null {
  const src = doc.devices.find((x) => x.id === id); if (!src) return null;
  const d = clone(src);
  d.id = nid(doc); d.name = src.name + " copy";
  for (const p of d.ports) p.id = nid(doc);
  const r = doc.racks.find((x) => x.id === src.rack);
  if (r) {
    const s = findFree(doc, r, d);
    if (s) { d.u = s[0]; d.side = s[1]; } else { d.rack = null; d.fx = (src.fx || 0) + 40; d.fy = (src.fy || 0) + 40; }
  } else { d.fx = src.fx + 30; d.fy = src.fy + 30; }
  doc.devices.push(d);
  return d;
}

export function addRack(doc: Doc, name?: string, u = 42, spec?: RackSpec): Rack {
  const x = doc.racks.reduce((m, r) => Math.max(m, r.x + RW + 2 * RAIL + 90), 0);
  const r: any = { id: nid(doc), name: name || `Rack ${doc.racks.length + 1}`, u, x, y: 0, numbering: "up", color: "#3a3d42", notes: "" }; // theme-ok
  if (spec) applySpec(r, spec);
  doc.racks.push(r);
  return r;
}

/** Set the model fields on a rack (missing dimensions are removed). */
export function applySpec(r: any, spec: RackSpec) {
  r.kind = spec.kind; r.model = spec.model; r.model_name = spec.model_name;
  if (spec.width_mm) r.width_mm = spec.width_mm; else delete r.width_mm;
  if (spec.depth_mm) r.depth_mm = spec.depth_mm; else delete r.depth_mm;
}

/** Change a rack's height. Returns a plain message when devices would end up outside it, else "". */
export function resizeRack(doc: Doc, r: Rack, u: number): string {
  const probe = { ...r, u };
  for (const d of doc.devices) {
    if (d.rack !== r.id) continue;
    if (d.u + d.u_size - 1 > u) return `Can't make ${r.name} ${u}U: ${d.name} reaches U${d.u + d.u_size - 1}. Move or remove it first.`;
    const p = checkPlace(doc, d, probe, d.u, d.side);
    if (!p.ok) return `Can't make ${r.name} ${u}U: ${p.why || d.name + " would not fit"}`;
  }
  r.u = u;
  return "";
}

/** Take a device out of its rack and stand it below the other off-rack devices (does not add it to the doc). */
export function setOffRack(doc: Doc, d: Device) {
  const offs = doc.devices.filter((x) => x.rack == null && x.id !== d.id);
  d.rack = null;
  d.fx = Math.min(...doc.racks.map((x) => x.x)) - RW - 160;
  d.fy = offs.reduce((s, x) => s + devDims({ ...x, rack: null }).h + 20, 0);
}

/** Put a new device in the first free slot of `rackId` (or any rack), else off-rack. */
export function placeNew(doc: Doc, d: Device, face: string, rackId?: number | null): string {
  if (!doc.racks.length) addRack(doc);
  d.face = d.plate ? "both" : face;
  const off = !!d.plate?.off && !doc.devices.some((x) => x.type === "Shelf");
  const order = [...doc.racks].sort((a, b) => (a.id === rackId ? -1 : b.id === rackId ? 1 : 0));
  if (!off) for (const r of order) {
    const s = findFree(doc, r, d);
    if (s) { d.rack = r.id; d.u = s[0]; d.side = s[1]; doc.devices.push(d); return ""; }
  }
  setOffRack(doc, d);
  doc.devices.push(d);
  return off ? "Placed off-rack" : "No free slot - placed off-rack";
}

export function deleteDevice(doc: Doc, id: number) {
  const d = doc.devices.find((x) => x.id === id); if (!d) return;
  const pids = new Set(d.ports.map((p) => p.id));
  doc.cables = doc.cables.filter((c) => !pids.has(c.a) && !pids.has(c.b));
  doc.devices = doc.devices.filter((x) => x.id !== id);
}

export function deleteRack(doc: Doc, id: number) {
  for (const d of doc.devices.filter((x) => x.rack === id)) deleteDevice(doc, d.id);
  doc.racks = doc.racks.filter((r) => r.id !== id);
}

export function portOf(doc: Doc, pid: number) {
  for (const d of doc.devices) { const p = d.ports.find((x) => x.id === pid); if (p) return { d, p }; }
  return null;
}
export const isOutlet = (p: { type: string; name: string }) => p.type === "Power" && p.name.toLowerCase().startsWith("out");

export function newCable(doc: Doc, a: number, b: number): Cable | string {
  if (a === b) return "Pick two different ports";
  if (doc.cables.some((c) => c.a === a || c.b === a || c.a === b || c.b === b)) return "A port already has a cable";
  const pa = portOf(doc, a)!.p, pb = portOf(doc, b)!.p;
  const c: any = { id: 0, a, b, color: "#1f6feb", style: "solid", type: "Cat6", length: 3, unit: "ft", label: "", logical: "", notes: "" }; // theme-ok
  if (pa.type === "Power" && pb.type === "Power") {
    if (isOutlet(pa) === isOutlet(pb)) return "Power cords run from an outlet (Out) to an inlet";
    Object.assign(c, { color: "#2b2b2b", type: "Power", length: 2 }); // theme-ok
  }
  c.id = nid(doc);
  doc.cables.push(c);
  return c;
}

// ---- import rack list
const ITEM = /^\s*(?:[-*•–]+\s*)?(.+?)\s*[-–—:]*\s*\(\s*(\d+)\s*U\s*\)\s*(.*)$/i;
const EMPTY = /^(open|empty|free|spare|vacant|available)\b/i;

export function parseRackText(text: string) {
  const racks: { name: string; items: [string, number, string][] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = ITEM.exec(line);
    if (m) {
      if (!racks.length) racks.push({ name: "Rack 1", items: [] });
      const name = m[1].trim().replace(/^[-–— ]+|[-–— ]+$/g, "");
      const tail = (m[3] + " " + name).toLowerCase();
      const face = /\b(rear|back)\b/.test(tail) ? "rear" : tail.includes("full depth") ? "both" : "front";
      racks[racks.length - 1].items.push([name, parseInt(m[2]), face]);
    } else racks.push({ name: line.trim().replace(/^[-:* ]+|[-:* ]+$/g, ""), items: [] });
  }
  return racks.filter((r) => r.items.length);
}

const mkPorts = (prefix: string, n: number, type: string, start = 1) =>
  Array.from({ length: n }, (_, i) => ({
    name: prefix.includes("{n}") ? prefix.replace("{n}", String(start + i)) : n === 1 ? prefix : prefix + (start + i),
    type, label: "",
  }));
const pwr = () => mkPorts("Power", 1, "Power", 0);

/** Catalog lookup (ported from the Python app): Dell/UniFi/Synology rules, then vendor model names. */
export function catalogMatch(name: string, u: number): Tpl | null { return catalogLookup(name, u); }
/** Same lookup as catalogMatch, but the template keeps its own u_size. */
export function catalogFind(name: string): Tpl | null { return catalogLookup(name, null); }
function catalogLookup(name: string, u: number | null): Tpl | null {
  const n = name.toLowerCase();
  const pool = CATALOG.filter((t) => t.plate);
  const sized = (t: Tpl | undefined | null): Tpl | null => {
    if (!t) return null;
    const c = clone(t);
    if (u != null && !c.half && !["ups", "bp"].includes(c.plate?.style)) c.u_size = u;
    return c;
  };
  const byShort = (sh: string) => pool.find((t) => t.short === sh);
  let m: RegExpExecArray | null;
  if (/poweredge|dell|\br\d{3,4}(xd|xs)?\b/.test(n) && !/\bdell\s+(switch|pdu)/.test(n)) {
    m = /\br(\d{3,4})(xd|xs)?\b/.exec(n);
    const cands = pool.filter((t) => t.plate.k === "dell");
    let pick: Tpl | undefined;
    if (m) {
      const key = "r" + m[1] + (m[2] || "");
      pick = cands.filter((t) => (t.short || "").toLowerCase() === "pe-" + key).sort((x, y) => x.plate.bays - y.plate.bays)[0];
    }
    return sized(pick || (u == null ? undefined : byShort(u === 1 ? "PE-R650" : "PE-R750")));
  }
  if (/dream\s*router|\budr7?\b/.test(n)) return sized(byShort(n.includes("7") ? "UDR7" : "UDR"));
  if (/unifi|usw|ubiquiti/.test(n)) {
    const cands = pool.filter((t) => t.plate.k === "unifi");
    if (u == null && !/\b(24|48)\b/.test(n)) return null;
    return sized(cands.find((t) => t.model === (n.includes("48") ? "UniFi Switch Pro 48" : "UniFi Switch Pro 24")) || (u == null ? undefined : cands[0]));
  }
  if (/synology|\bds\d{3}|\brs\d{3,4}/.test(n)) {
    const rack = /\brs\d{3,4}/.test(n);
    const cands = pool.filter((t) => t.plate.k === (rack ? "syn_rack" : "syn_desk"));
    m = /\b(ds|rs)(\d{3,4})(rp)?(\+)?/.exec(n);
    const pick = m ? byShort("NAS-" + (m[1] + m[2] + (m[3] || "") + (m[4] || "")).toUpperCase()) : undefined;
    return sized(pick || (u == null ? undefined : cands.find((t) => t.u_size === u) || cands[0]));
  }
  // Other vendors (Cisco, Meraki, Fortinet, SonicWall, APC...): longest short/model name found in the text
  const key = n.replace(/[^a-z0-9+]/g, "");
  let best: Tpl | null = null, bl = 0;
  for (const t of pool) {
    if (["uap", "ap"].includes(t.plate.style)) continue;
    const k = (t.short || "").toLowerCase().replace(/[^a-z0-9+]/g, "");
    if (k.length >= 5 && key.includes(k) && k.length > bl) { best = t; bl = k.length; }
  }
  return sized(best);
}

export function smartTemplate(name: string, u: number): Tpl {
  const n = name.toLowerCase();
  const mk = (type: string, color: string, ports: Tpl["ports"]): Tpl => ({ name, type, u_size: u, color, ports, half: false, rows: 0 });
  const hit = catalogMatch(name, u);
  if (hit) return hit;
  if (/cable\s*(mgmt|manage|mgr)|wire\s*manage|cbl/.test(n)) return mk("Cable manager", "#222428", []); // theme-ok
  if (/blank|filler/.test(n)) return mk("Blank", "#33363b", []); // theme-ok
  if (n.includes("fiber")) return mk("Patch panel", "#a8925a", mkPorts("{n}", 12 * u, "Fiber LC")); // theme-ok
  if (/panel|\bpp\b|^pp-/.test(n)) return mk("Patch panel", "#9aa3ad", mkPorts("{n}", 24 * u, "RJ45")); // theme-ok
  if (/apc|ups|battery/.test(n)) return mk("UPS", "#222428", [...mkPorts("Out{n}", 6, "Power"), ...mkPorts("Input", 1, "Power", 0)]); // theme-ok
  if (n.includes("pdu") || n.includes("power strip")) return mk("PDU", "#222428", [...mkPorts("Out{n}", 8, "Power"), ...mkPorts("Input", 1, "Power", 0)]); // theme-ok
  if (/firewall|\bfw\b|fortigate|palo|sonicwall/.test(n)) return mk("Firewall", "#b24040", [...mkPorts("{n}", 8, "RJ45"), ...mkPorts("SFP+{n}", 2, "SFP+"), ...pwr()]); // theme-ok
  if (/router|\brtr\b/.test(n)) return mk("Router", "#2f8f8f", [...mkPorts("Gi0/{n}", 4, "RJ45", 0), ...pwr()]); // theme-ok
  if (/\bnas\b|storage|\bsan\b/.test(n)) return mk("Storage", "#7456a8", [...mkPorts("LAN{n}", 2, "RJ45"), ...mkPorts("PSU{n}", 2, "Power")]); // theme-ok
  if (/server|\bsrv\b|\bhv\b|esx|host/.test(n)) return mk("Server", "#4b5563", [...mkPorts("NIC{n}", 4, "RJ45"), ...mkPorts("PSU{n}", 2, "Power")]); // theme-ok
  if (/stk|stack|switch|\bsw\d*\b|\bidf\b|\bmdf\b/.test(n)) return mk("Switch", "#3b6ea8", [...mkPorts("{n}", u >= 2 ? 48 : 24, "RJ45"), ...mkPorts("SFP{n}", 4, "SFP+"), ...pwr()]); // theme-ok
  if (n.includes("shelf")) return mk("Shelf", "#4b5563", []); // theme-ok
  return mk("Other", "#4b5563", []); // theme-ok
}

export function buildFromText(doc: Doc, text: string, height = 0): number {
  const parsed = parseRackText(text);
  for (const pr of parsed) {
    const total = pr.items.reduce((s, i) => s + i[1], 0);
    const r = addRack(doc, pr.name, Math.max(total, height));
    let top = r.u;
    for (const [name, u, face] of pr.items) {
      if (EMPTY.test(name.trim())) { top -= u; continue; }
      const d = fromTpl(doc, smartTemplate(name, u));
      d.rack = r.id; d.u = top - u + 1; d.name = name;
      d.face = d.plate && face === "front" ? "both" : face;
      doc.devices.push(d);
      top -= u;
    }
  }
  return parsed.length;
}
