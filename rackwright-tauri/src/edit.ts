import { Doc, Device, Rack, Cable, RW, RAIL, UH } from "./types";
import catalog from "./catalog.json";

export interface Tpl {
  name: string; type: string; u_size: number; color: string; half?: boolean; rows?: number;
  model?: string; ip?: string; short?: string; group?: string; plate?: any;
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
  if (t.plate) { d.plate = clone(t.plate); d.face = "both"; }
  for (const p of t.ports) d.ports.push({ id: nid(doc), name: p.name, type: p.type, label: p.label || "" });
  return d;
}

export function fits(doc: Doc, r: Rack, d: Device, ignore?: Set<number>): boolean {
  const lo = d.u, hi = d.u + d.u_size - 1;
  if (lo < 1 || hi > r.u) return false;
  for (const o of doc.devices) {
    if (o.rack !== r.id || o.id === d.id || ignore?.has(o.id)) continue;
    const fa = o.face || "front", fb = d.face || "front";
    if (!(fa === fb || fa === "both" || fb === "both")) continue;
    if (o.u <= hi && o.u + o.u_size - 1 >= lo) {
      if (!(o.half && d.half) || o.side === d.side) return false;
    }
  }
  return true;
}

export function findFree(doc: Doc, r: Rack, d: Device): [number, number] | null {
  for (const side of d.half ? [0, 1] : [0])
    for (let u = 1; u <= r.u - d.u_size + 1; u++)
      if (fits(doc, r, { ...d, rack: r.id, u, side })) return [u, side];
  return null;
}

export function addRack(doc: Doc, name?: string, u = 42): Rack {
  const x = doc.racks.reduce((m, r) => Math.max(m, r.x + RW + 2 * RAIL + 90), 0);
  const r: any = { id: nid(doc), name: name || `Rack ${doc.racks.length + 1}`, u, x, y: 0, numbering: "up", color: "#3a3d42", notes: "" };
  doc.racks.push(r);
  return r;
}

/** Put a new device in the first free slot of `rackId` (or any rack), else off-rack. */
export function placeNew(doc: Doc, d: Device, face: string, rackId?: number | null): string {
  if (!doc.racks.length) addRack(doc);
  d.face = d.plate ? "both" : face;
  const off = d.plate?.off;
  const order = [...doc.racks].sort((a, b) => (a.id === rackId ? -1 : b.id === rackId ? 1 : 0));
  if (!off) for (const r of order) {
    const s = findFree(doc, r, d);
    if (s) { d.rack = r.id; d.u = s[0]; d.side = s[1]; doc.devices.push(d); return ""; }
  }
  const offs = doc.devices.filter((x) => x.rack == null);
  d.rack = null;
  d.fx = Math.min(...doc.racks.map((x) => x.x)) - RW - 160;
  d.fy = offs.reduce((s, x) => s + x.u_size * UH + 20, 0);
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
  const c: any = { id: 0, a, b, color: "#1f6feb", style: "solid", type: "Cat6", length: 3, unit: "ft", label: "", logical: "", notes: "" };
  if (pa.type === "Power" && pb.type === "Power") {
    if (isOutlet(pa) === isOutlet(pb)) return "Power cords run from an outlet (Out) to an inlet";
    Object.assign(c, { color: "#2b2b2b", type: "Power", length: 2 });
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
function catalogMatch(name: string, u: number): Tpl | null {
  const n = name.toLowerCase();
  const pool = CATALOG.filter((t) => t.plate);
  const sized = (t: Tpl | undefined | null): Tpl | null => {
    if (!t) return null;
    const c = clone(t);
    if (!c.half && !["ups", "bp"].includes(c.plate?.style)) c.u_size = u;
    return c;
  };
  const byShort = (sh: string) => pool.find((t) => t.short === sh);
  let m: RegExpExecArray | null;
  if (/poweredge|dell|r\d{3,4}(xd|xs)?/.test(n) && !/dell\s+(switch|pdu)/.test(n)) {
    m = /r(\d{3,4})(xd|xs)?/.exec(n);
    const cands = pool.filter((t) => t.plate.k === "dell");
    let pick: Tpl | undefined;
    if (m) {
      const key = "r" + m[1] + (m[2] || "");
      pick = cands.filter((t) => (t.short || "").toLowerCase() === "pe-" + key).sort((x, y) => x.plate.bays - y.plate.bays)[0];
    }
    return sized(pick || byShort(u === 1 ? "PE-R650" : "PE-R750"));
  }
  if (/dream\s*router|udr7?/.test(n)) return sized(byShort(n.includes("7") ? "UDR7" : "UDR"));
  if (/unifi|usw|ubiquiti/.test(n)) {
    const cands = pool.filter((t) => t.plate.k === "unifi");
    return sized(cands.find((t) => t.model === (n.includes("48") ? "UniFi Switch Pro 48" : "UniFi Switch Pro 24")) || cands[0]);
  }
  if (/synology|ds\d{3}|rs\d{3,4}/.test(n)) {
    const rack = /rs\d{3,4}/.test(n);
    const cands = pool.filter((t) => t.plate.k === (rack ? "syn_rack" : "syn_desk"));
    m = /(ds|rs)(\d{3,4})(rp)?(\+)?/.exec(n);
    const pick = m ? byShort("NAS-" + (m[1] + m[2] + (m[3] || "") + (m[4] || "")).toUpperCase()) : undefined;
    return sized(pick || cands.find((t) => t.u_size === u) || cands[0]);
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
  if (/cable\s*(mgmt|manage|mgr)|wire\s*manage|cbl/.test(n)) return mk("Cable manager", "#222428", []);
  if (/blank|filler/.test(n)) return mk("Blank", "#33363b", []);
  if (n.includes("fiber")) return mk("Patch panel", "#a8925a", mkPorts("{n}", 12 * u, "Fiber LC"));
  if (/panel|\bpp\b|^pp-/.test(n)) return mk("Patch panel", "#9aa3ad", mkPorts("{n}", 24 * u, "RJ45"));
  if (/apc|ups|battery/.test(n)) return mk("UPS", "#222428", [...mkPorts("Out{n}", 6, "Power"), ...mkPorts("Input", 1, "Power", 0)]);
  if (n.includes("pdu") || n.includes("power strip")) return mk("PDU", "#222428", [...mkPorts("Out{n}", 8, "Power"), ...mkPorts("Input", 1, "Power", 0)]);
  if (/firewall|\bfw\b|fortigate|palo|sonicwall/.test(n)) return mk("Firewall", "#b24040", [...mkPorts("{n}", 8, "RJ45"), ...mkPorts("SFP+{n}", 2, "SFP+"), ...pwr()]);
  if (/router|\brtr\b/.test(n)) return mk("Router", "#2f8f8f", [...mkPorts("Gi0/{n}", 4, "RJ45", 0), ...pwr()]);
  if (/\bnas\b|storage|\bsan\b/.test(n)) return mk("Storage", "#7456a8", [...mkPorts("LAN{n}", 2, "RJ45"), ...mkPorts("PSU{n}", 2, "Power")]);
  if (/server|\bsrv\b|\bhv\b|esx|host/.test(n)) return mk("Server", "#4b5563", [...mkPorts("NIC{n}", 4, "RJ45"), ...mkPorts("PSU{n}", 2, "Power")]);
  if (/stk|stack|switch|\bsw\d*\b|\bidf\b|\bmdf\b/.test(n)) return mk("Switch", "#3b6ea8", [...mkPorts("{n}", u >= 2 ? 48 : 24, "RJ45"), ...mkPorts("SFP{n}", 4, "SFP+"), ...pwr()]);
  if (n.includes("shelf")) return mk("Shelf", "#4b5563", []);
  return mk("Other", "#4b5563", []);
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
