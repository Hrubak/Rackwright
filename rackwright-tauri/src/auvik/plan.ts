// Auvik devices -> an import plan: classify, match catalog templates, split stacks, group endpoints, map ports. Pure.
import { CATALOG, Tpl, catalogMatch, clone } from "../edit";
import type { Device } from "../types";
import { AuvikDevice, ParsedAuvik, normMac } from "./parse";

export type Kind = "firewall" | "router" | "switch" | "server" | "storage" | "ups" | "pdu" | "ap" | "ipmi" | "controller" | "vm" | "endpoint";
export type Mode = "rack" | "off" | "endpoint" | "skip";

export interface PlanItem {
  key: string;            // auvik_id: serial || mac || name
  dev: AuvikDevice;
  kind: Kind;
  mode: Mode;             // editable in the review step
  defaultMode: Mode;
  virtual: boolean;       // infra-looking VM / controller with no physical connection: listed, not drawn
  tplName: string;        // matched template, for the review table
  generic: boolean;       // no specific catalog match
  units: number[];        // stack unit numbers (more than one = stack)
  connectedTo: string;    // readable list of neighbours
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const auvikKey = (d: AuvikDevice) => d.serial || d.macs[0] || d.name;

// ---------------------------------------------------------------- classification
export function classify(d: Pick<AuvikDevice, "type" | "name" | "model">): Kind {
  const t = d.type.toLowerCase();
  if (/firewall/.test(t)) return "firewall";
  if (/router/.test(t)) return "router";
  if (/\bswitch\b|\bstack\b/.test(t)) return "switch";
  if (/ipmi|platform management|idrac|\bilo\b/.test(t)) return "ipmi";
  if (/server|hypervisor/.test(t)) return "server";
  if (/\bups\b|uninterruptible/.test(t)) return "ups";
  if (/\bpdu\b|power distribution/.test(t)) return "pdu";
  if (/storage|\bnas\b/.test(t)) return "storage";
  if (/access point/.test(t)) return "ap";
  if (/controller/.test(t)) return "controller";
  if (/virtual machine/.test(t)) return "vm";
  return "endpoint";
}
const INFRA_VM = /smartzone|\bvsz\b|vcenter|vcsa|controller|\bwlc\b|unifi\s*(network|controller)|sophos|firewall/i;

const RACK_KINDS: Kind[] = ["firewall", "router", "switch", "server", "storage", "ups", "pdu"];
function defaultMode(kind: Kind, linked: boolean, d: AuvikDevice): { mode: Mode; virtual: boolean } {
  if (RACK_KINDS.includes(kind)) return { mode: "rack", virtual: false };
  if (kind === "ap" || kind === "ipmi") return { mode: "off", virtual: false };
  if (kind === "controller") return linked ? { mode: "rack", virtual: false } : { mode: "skip", virtual: true };
  if (kind === "vm" && !linked && INFRA_VM.test(`${d.name} ${d.model}`)) return { mode: "skip", virtual: true };
  return { mode: "endpoint", virtual: false };
}

/** Plural noun used in the endpoint group summary. */
export function endpointWord(type: string): string {
  const t = type.toLowerCase();
  if (/phone|telecom/.test(t)) return "phone";
  if (/workstation|laptop|desktop|\bpc\b/.test(t)) return "PC";
  if (/camera/.test(t)) return "camera";
  if (/printer/.test(t)) return "printer";
  if (/virtual/.test(t)) return "VM";
  return "other";
}
export function summarize(types: string[]): string {
  const n = types.length;
  const c = new Map<string, number>();
  for (const t of types) { const w = endpointWord(t); c.set(w, (c.get(w) || 0) + 1); }
  const parts = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([w, k]) => (w === "other" ? `${k} other` : `${k} ${w}${k === 1 ? "" : "s"}`));
  return `${n} device${n === 1 ? "" : "s"}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

// ---------------------------------------------------------------- ports
export interface PPort { raw: string; unit: number | null; slot: number | null; num: number; x: boolean; speed: number }
/** Understand an interface name: Brocade/Cisco unit/slot/port, SonicWall X0, plain numbers, A1. null when it is junk. */
export function parsePort(s: string): PPort | null {
  const raw = (s || "").trim();
  if (!raw) return null;
  const base = raw.replace(/\s*\(.*\)\s*$/, "").replace(/:.*$/, "").trim();
  let speed = 1;
  const sp = /^(\d+(?:\.\d+)?)\s*g/i.exec(base);
  if (sp) speed = parseFloat(sp[1]);
  else if (/^(te|ten|tengig)/i.test(base)) speed = 10;
  let m = /(\d+)\/(\d+)\/(\d+)$/.exec(base);
  if (m) return { raw, unit: +m[1], slot: +m[2], num: +m[3], x: false, speed };
  m = /(\d+)\/(\d+)$/.exec(base);
  if (m) return { raw, unit: null, slot: +m[1], num: +m[2], x: false, speed };
  m = /^x(\d+)$/i.exec(base);
  if (m) return { raw, unit: null, slot: null, num: +m[1], x: true, speed };
  m = /^(\d+)$/.exec(base) || /^[A-Za-z]{1,3}[- ]?(\d+)$/.exec(base);
  if (m) return { raw, unit: null, slot: null, num: +m[1], x: false, speed };
  return null;
}
/** Only trust an interface name on a non-switch when it looks like a real port (X0, 1/1/5). */
export function meaningful(kind: Kind, iface: string): boolean {
  const p = parsePort(iface);
  if (!p) return false;
  if (kind === "switch") return true;
  return p.x || p.slot != null;
}
/** Same port written two ways ("GigabitEthernet1/1/5", "Gi1/1/5") gets one canonical key. */
const portKey = (iface: string) => { const p = parsePort(iface); return p ? `${p.unit ?? ""}/${p.slot ?? ""}/${p.num}${p.x ? "x" : ""}` : iface.toLowerCase(); };

// ---------------------------------------------------------------- templates
const tok = (s: string) => ` ${s.toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2").replace(/[^a-z0-9+]+/g, " ").trim()} `;
const KIND_TYPES: Record<string, string[]> = {
  firewall: ["Firewall", "Router"], router: ["Router", "Firewall"], switch: ["Switch"], server: ["Server"], storage: ["Storage"],
  ups: ["UPS"], pdu: ["PDU"], ap: ["Wireless"], controller: ["Wireless", "Router"], ipmi: [], vm: [], endpoint: [],
};
const byShort = (s: string) => CATALOG.find((t) => t.short === s);
const byName = (s: string) => CATALOG.find((t) => t.name === s)!;
const mkPorts = (names: string[], type: string) => names.map((name) => ({ name, type, label: "" }));

function apTemplate(): Tpl {
  const t = clone(byShort("U6-Lite")!);
  Object.assign(t, { name: "Access point", model: "", short: undefined, group: undefined });
  return t;
}
function ipmiTemplate(): Tpl {
  return { name: "Management controller (iDRAC / iLO)", type: "Management", u_size: 1, half: true, color: "#5b4b7a", rows: 1, model: "", ports: mkPorts(["Mgmt"], "Mgmt") };
}
export function groupTemplate(n: number): Tpl {
  const rows = Math.max(2, Math.min(12, Math.ceil(n / 12)));
  return { name: "Endpoints", type: "Endpoints", u_size: Math.max(1, Math.ceil((12 * rows + 4) / 26)), half: false, color: "#44566a", rows, model: "", ports: [] };
}

/** Pick the catalog template for an Auvik device. `maxPort` = highest numbered front port in use (sizes generic switches and ICX units). */
export function matchTemplate(d: Pick<AuvikDevice, "model" | "name" | "type">, kind: Kind, maxPort = 0): { tpl: Tpl; generic: boolean } {
  const text = d.model.trim();
  const full = `${d.model} ${d.name}`;
  const ret = (t: Tpl | null | undefined, generic = false) => t ? { tpl: clone(t), generic } : null;
  const orig = (t: Tpl | null) => (t ? CATALOG.find((c) => c.name === t.name) ?? t : null);

  if (kind === "ipmi") return { tpl: ipmiTemplate(), generic: true };
  if (kind === "ap") {
    const hit = poolMatch(text || d.name, ["Wireless"]) ?? poolMatch(full, ["Wireless"]);
    return ret(hit) ?? { tpl: apTemplate(), generic: true };
  }
  // Brocade / Ruckus ICX
  let m = /\bicx\s*-?\s*(7\d{3})(?:\s*-?\s*(24|48))?(?:[-\s]*(hpoe|poe|p)\b)?/i.exec(text);
  if (m) {
    const fam = m[1], ports = m[2] || (maxPort > 24 ? "48" : "24"), poe = !!m[3];
    for (const s of poe ? [`ICX${fam}-${ports}P`, `ICX${fam}-${ports}`] : [`ICX${fam}-${ports}`, `ICX${fam}-${ports}P`]) { const t = ret(byShort(s)); if (t) return t; }
    const any = CATALOG.find((c) => c.short?.startsWith(`ICX${fam}-${ports}`));
    if (any) return { tpl: clone(any), generic: false };
  }
  // HP / Aruba
  m = /\b2930f?\s*-?\s*(24|48)/i.exec(text);
  if (m) { const t = ret(byShort(`AR-2930F-${m[1]}`)); if (t) return t; }
  m = /\bcx\s*(6100|6300m?)\D{0,6}(24|48)/i.exec(text);
  if (m) { const t = ret(byShort(`AR-CX${m[1].toUpperCase()}-${m[2]}`)); if (t) return t; }
  if (kind === "ups") {
    const u = upsMatch(text);
    if (u) return { tpl: clone(u), generic: false };
  }
  if ((kind === "server" || kind === "storage") && /\br\d{3,4}(xd|xs)?\b|\b(ds|rs)\d{3,4}/i.test(text)) {
    const hit = orig(catalogMatch(text, 1));
    if (hit && hit.type === (kind === "server" ? "Server" : "Storage")) return { tpl: clone(hit), generic: false };
  }
  const hit = poolMatch(text, KIND_TYPES[kind] || []);
  if (hit) return { tpl: clone(hit), generic: false };

  // Generic fallbacks
  switch (kind) {
    case "switch": {
      const n = Math.max(maxPort, 0);
      if (n <= 24) return { tpl: clone(byName("Switch 24-port 1U")), generic: true };
      const t = clone(byName("Switch 48-port 1U"));
      if (n > 48) { // more front ports than a 48: add RJ45 ports so every cable can land
        const at = t.ports.findIndex((p) => p.type !== "RJ45");
        const extra = mkPorts(Array.from({ length: n - 48 }, (_, i) => String(49 + i)), "RJ45");
        t.ports.splice(at < 0 ? t.ports.length : at, 0, ...extra);
      }
      return { tpl: t, generic: true };
    }
    case "firewall": return { tpl: clone(byName("Firewall 1U")), generic: true };
    case "router": return { tpl: clone(byName("Router 1U")), generic: true };
    case "server": return { tpl: clone(byName(/hypervisor/i.test(d.type) ? "Server 2U" : "Server 1U")), generic: true };
    case "storage": return { tpl: clone(byName("NAS 2U")), generic: true };
    case "ups": return { tpl: clone(byName("UPS 2U")), generic: true };
    case "pdu": return { tpl: clone(byName("PDU 1U")), generic: true };
    case "controller": return { tpl: clone(byName("Wireless controller 1U")), generic: true };
    default: return { tpl: clone(byName("Server 1U")), generic: true };
  }
}

/** Longest catalog short name found as whole tokens in the text. */
function poolMatch(text: string, types: string[]): Tpl | null {
  const hay = tok(text);
  let best: Tpl | null = null, bl = 0;
  for (const t of CATALOG) {
    if (!t.short || !t.plate || !types.includes(t.type) || t.plate.style === "bp") continue;
    const k = tok(t.short);
    if (k.trim().length >= 5 && hay.includes(k) && k.length > bl) { best = t; bl = k.length; }
  }
  return best;
}

/** APC Smart-UPS 3000 -> SMT3000RM2U (rack-mount), else the closest rack-mount Smart-UPS by VA. */
function upsMatch(text: string): Tpl | null {
  const exact = poolMatch(text, ["UPS"]);
  if (exact) return exact;
  if (!/apc|smart-?ups|smt|srt/i.test(text)) return null;
  const m = /(?:smt|srt|smart-?ups\s*(?:x|c|rt)?)\s*-?\s*(\d{3,5})/i.exec(text) || /\b(\d{3,5})\s*va\b/i.exec(text);
  if (!m) return null;
  const want = parseInt(m[1]);
  const cands = CATALOG.filter((c) => c.type === "UPS" && c.plate?.style === "ups" && /APC/i.test(c.name));
  const va = (c: Tpl) => { const n = /(?:SMT|SMC|SMX|SRT)(\d+)(K?)/i.exec(c.short || ""); return n ? parseInt(n[1]) * (n[2] ? 1000 : 1) : 0; };
  const pre = /srt/i.test(text) ? "SRT" : "SMT";
  const pool = cands.filter((c) => (c.short || "").startsWith(pre));
  const use = pool.length ? pool : cands;
  return use.slice().sort((a, b) => Math.abs(va(a) - want) - Math.abs(va(b) - want))[0] ?? null;
}

// ---------------------------------------------------------------- links
export interface Link { a: string; b: string; ifA: string; ifB: string }
const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** One link per device pair. "A lists B through X" means X is B's interface. */
export function buildLinks(p: ParsedAuvik, keyOf: Map<AuvikDevice, string>): { links: Link[]; unresolved: number } {
  const byName = new Map<string, AuvikDevice>();
  for (const d of p.devices) if (!byName.has(d.rawName.toLowerCase())) byName.set(d.rawName.toLowerCase(), d);
  const map = new Map<string, Link>();
  let unresolved = 0;
  for (const a of p.devices) for (const n of a.neighbors) {
    const b = byName.get(n.name.toLowerCase());
    if (!b) { unresolved++; continue; }
    if (b === a) continue;
    const ka = keyOf.get(a)!, kb = keyOf.get(b)!;
    const k = linkKey(ka, kb);
    let l = map.get(k);
    if (!l) { l = ka < kb ? { a: ka, b: kb, ifA: "", ifB: "" } : { a: kb, b: ka, ifA: "", ifB: "" }; map.set(k, l); }
    // the interface belongs to b
    if (l.b === kb) { if (!l.ifB && n.iface) l.ifB = n.iface; } else if (!l.ifA && n.iface) l.ifA = n.iface;
  }
  return { links: [...map.values()], unresolved };
}

// ---------------------------------------------------------------- plan
export interface PlanUnit {
  key: string; itemKey: string; name: string; unit?: number; item: PlanItem; tpl: Tpl; generic: boolean;
  mode: "rack" | "off"; maxPort: number; mainSlot: number; slotOffsets: Record<number, number>; isGroup?: false;
}
export interface Member { name: string; type: string; model: string; ip: string; mac: string; port: string; status: string; key: string }
export interface PlanGroup { key: string; name: string; unit: PlanUnit; members: Member[]; summary: string; isGroup: true; tpl: Tpl }
export interface PortRef { target: PlanUnit | PlanGroup; iface: string; fast: boolean; member?: number }
export interface PlanCable { a: PortRef; b: PortRef; label: string; key: string }
export interface Unplaced { name: string; type: string; model: string; ip: string; mac: string; status: string; reason: string }
export interface ImportPlan {
  site: string; units: PlanUnit[]; groups: PlanGroup[]; cables: PlanCable[]; unplaced: Unplaced[]; virtual: string[]; warnings: string[];
}

interface Analysis { items: PlanItem[]; byKey: Map<string, PlanItem>; links: Link[]; warnings: string[] }

function ifaceOf(l: Link, key: string) { return l.a === key ? l.ifA : l.ifB; }
function otherOf(l: Link, key: string) { return l.a === key ? l.b : l.a; }

/** Stack units, highest front-port number, main slot and uplink slot offsets for one switch, from the interfaces seen on it. */
function portLayout(ifaces: string[]) {
  const ps = ifaces.map(parsePort).filter((x): x is PPort => !!x);
  const unitNums = [...new Set(ps.filter((p) => p.unit != null).map((p) => p.unit as number))].sort((a, b) => a - b);
  const slotsOf = (u: number | null) => ps.filter((p) => p.slot != null && (u == null || p.unit === u || p.unit == null));
  const layout = (u: number | null) => {
    const sl = slotsOf(u);
    const slots = [...new Set(sl.map((p) => p.slot as number))].sort((a, b) => a - b);
    const mainSlot = slots.length ? slots[0] : 1;
    const maxOn = (s: number) => Math.max(0, ...sl.filter((p) => p.slot === s).map((p) => p.num));
    const slotOffsets: Record<number, number> = {};
    let off = 0;
    for (const s of slots.filter((x) => x !== mainSlot)) { slotOffsets[s] = off; off += maxOn(s); }
    const plain = ps.filter((p) => p.slot == null && !p.x && (u == null));
    const maxPort = Math.max(maxOn(mainSlot), ...plain.map((p) => p.num), 0);
    return { mainSlot, slotOffsets, maxPort };
  };
  return { unitNums, layout };
}

function analyze(p: ParsedAuvik): Analysis {
  const warnings = [...p.warnings];
  const keyOf = new Map<AuvikDevice, string>();
  const seen = new Set<string>();
  for (const d of p.devices) {
    let k = auvikKey(d);
    if (seen.has(k)) k = `${k}#${d.name}`;
    seen.add(k);
    keyOf.set(d, k);
  }
  const { links, unresolved } = buildLinks(p, keyOf);
  if (unresolved) warnings.push(`${unresolved} "Connected To" entr${unresolved === 1 ? "y points" : "ies point"} at devices that are not in the export.`);
  const items: PlanItem[] = [];
  const byKey = new Map<string, PlanItem>();
  for (const d of p.devices) {
    const key = keyOf.get(d)!;
    const kind = classify(d);
    const mine = links.filter((l) => l.a === key || l.b === key);
    const { mode, virtual } = defaultMode(kind, mine.length > 0, d);
    const ifs = mine.map((l) => ifaceOf(l, key)).filter(Boolean);
    const { unitNums, layout } = portLayout(kind === "switch" ? ifs : []);
    const units = unitNums.length > 1 ? unitNums : [];
    const lay = layout(units.length ? units[0] : null);
    const { tpl, generic } = matchTemplate(d, kind, lay.maxPort);
    const names = new Map(p.devices.map((x) => [keyOf.get(x)!, x.name]));
    const item: PlanItem = {
      key, dev: d, kind, mode, defaultMode: mode, virtual, tplName: (generic ? "generic: " : "") + tpl.name, generic, units,
      connectedTo: mine.map((l) => names.get(otherOf(l, key)) || "").filter(Boolean).join(", "),
    };
    items.push(item); byKey.set(key, item);
  }
  return { items, byKey, links, warnings };
}

export function buildItems(p: ParsedAuvik): PlanItem[] { return analyze(p).items; }

const PRIORITY: Record<Kind, number> = { firewall: 0, router: 1, switch: 2, controller: 3, server: 4, pdu: 5, ups: 6, storage: 7, ap: 8, ipmi: 9, vm: 10, endpoint: 11 };

/** Turn the (possibly edited) review rows into concrete devices, endpoint groups and cables. */
export function resolvePlan(p: ParsedAuvik, items: PlanItem[]): ImportPlan {
  const an = analyze(p);
  const warnings = [...an.warnings];
  const mode = new Map(items.map((i) => [i.key, i.mode]));
  const item = (k: string) => an.byKey.get(k)!;
  const isActive = (k: string) => { const m = mode.get(k); return m === "rack" || m === "off"; };

  // 1. one unit per placed device, several per stack
  const units: PlanUnit[] = [];
  const unitsOf = new Map<string, PlanUnit[]>();
  for (const it of items) {
    if (!isActive(it.key)) continue;
    const ifs = an.links.filter((l) => l.a === it.key || l.b === it.key).map((l) => ifaceOf(l, it.key)).filter(Boolean);
    const { unitNums, layout } = portLayout(it.kind === "switch" ? ifs : []);
    const list: PlanUnit[] = [];
    const stack = unitNums.length > 1;
    for (const u of stack ? unitNums : [null]) {
      const lay = layout(u);
      const { tpl, generic } = matchTemplate(it.dev, it.kind, lay.maxPort);
      
      list.push({
        key: stack ? `${it.key}#${u}` : it.key, itemKey: it.key, name: stack ? `${it.dev.name} unit ${u}` : it.dev.name, unit: stack ? (u as number) : undefined,
        item: it, tpl, generic, mode: it.mode as "rack" | "off", maxPort: lay.maxPort, mainSlot: lay.mainSlot, slotOffsets: lay.slotOffsets,
      });
    }
    unitsOf.set(it.key, list);
    units.push(...list);
  }
  units.sort((x, y) => PRIORITY[x.item.kind] - PRIORITY[y.item.kind] || (x.unit ?? 0) - (y.unit ?? 0));

  const unitFor = (itemKey: string, iface: string): PlanUnit => {
    const list = unitsOf.get(itemKey)!;
    if (list.length === 1) return list[0];
    const pp = parsePort(iface);
    return list.find((u) => u.unit === pp?.unit) ?? list[0];
  };

  // 2. cables between placed devices; one per device pair, one per switch port
  const cables: PlanCable[] = [];
  const claimed = new Map<string, string>();
  const claim = (u: PlanUnit | PlanGroup, iface: string, who: string): boolean => {
    if (!iface) return true;
    const k = `${u.key}|${portKey(iface)}`;
    if (claimed.has(k)) { warnings.push(`${u.isGroup ? u.name : (u as PlanUnit).name} ${iface} is claimed by ${claimed.get(k)} and ${who}; the second one has no cable.`); return false; }
    claimed.set(k, who);
    return true;
  };
  for (const l of an.links) {
    if (!isActive(l.a) || !isActive(l.b)) continue;
    const A = item(l.a), B = item(l.b);
    const ia = meaningful(A.kind, l.ifA) ? l.ifA : "", ib = meaningful(B.kind, l.ifB) ? l.ifB : "";
    const ua = unitFor(l.a, ia), ub = unitFor(l.b, ib);
    const fast = Math.max(parsePort(ia)?.speed ?? 1, parsePort(ib)?.speed ?? 1) >= 2.5;
    const swSide = ib && (B.kind === "switch" || !ia) ? { u: ub, i: ib } : ia ? { u: ua, i: ia } : null;
    const label = swSide ? `${swSide.u.name} ${swSide.i}` : `${ua.name} - ${ub.name}`;
    const okA = claim(ua, ia, ub.name), okB = claim(ub, ib, ua.name);
    if (!okA || !okB) continue;
    cables.push({ a: { target: ua, iface: ia, fast }, b: { target: ub, iface: ib, fast }, label, key: l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}` });
  }

  // 3. endpoints: group per switch unit, one port per endpoint
  const unplaced: Unplaced[] = [];
  const groups = new Map<string, PlanGroup>();
  const virtual: string[] = [];
  for (const it of items) {
    if (it.mode === "skip") { if (it.virtual) virtual.push(it.dev.name); continue; }
    if (it.mode !== "endpoint") continue;
    const d = it.dev;
    const row = (reason: string): Unplaced => ({ name: d.name, type: d.type, model: d.model, ip: d.ips[0] || "", mac: d.macs[0] || "", status: d.status, reason });
    const mine = an.links.filter((l) => l.a === it.key || l.b === it.key);
    if (!mine.length) { unplaced.push(row("not connected to anything in the export")); continue; }
    type Cand = { l: Link; other: PlanItem; iface: string; score: number };
    const cands: Cand[] = [];
    for (const l of mine) {
      const o = item(otherOf(l, it.key));
      if (!isActive(o.key)) continue;
      const iface = meaningful(o.kind, ifaceOf(l, o.key)) ? ifaceOf(l, o.key) : "";
      cands.push({ l, other: o, iface, score: (o.kind === "switch" ? 2 : 0) + (iface ? 1 : 0) });
    }
    cands.sort((x, y) => y.score - x.score);
    const best = cands[0];
    if (!best || best.other.kind !== "switch") {
      const via = best ? best.other.dev.name : item(otherOf(mine[0], it.key)).dev.name;
      unplaced.push(row(best ? `connected to ${via}, which is not a switch` : `connected to ${via}, which is not placed`));
      continue;
    }
    const u = unitFor(best.other.key, best.iface);
    let g = groups.get(u.key);
    if (!g) { g = { key: `g:${u.key}`, name: `Endpoints on ${u.name}`, unit: u, members: [], summary: "", isGroup: true, tpl: groupTemplate(0) }; groups.set(u.key, g); }
    g.members.push({ name: d.name, type: d.type, model: d.model, ip: d.ips[0] || "", mac: d.macs[0] || "", port: best.iface, status: d.status, key: it.key });
  }
  const groupList = [...groups.values()];
  for (const g of groupList) {
    g.members.sort((x, y) => (parsePort(x.port)?.num ?? 9999) - (parsePort(y.port)?.num ?? 9999) || x.name.localeCompare(y.name));
    g.summary = summarize(g.members.map((m) => m.type));
    g.tpl = groupTemplate(g.members.length);
    g.members.forEach((m, i) => {
      if (!m.port) return; // connected, but Auvik did not say which port
      if (!claim(g.unit, m.port, m.name)) return;
      cables.push({ a: { target: g, iface: "", fast: false, member: i }, b: { target: g.unit, iface: m.port, fast: false }, label: `${g.unit.name} ${m.port}`, key: `${g.key}|${m.key}` });
    });
  }
  return { site: p.site, units, groups: groupList, cables, unplaced, virtual, warnings };
}

// ---------------------------------------------------------------- locating ports on a device (also used on devices already in the document)
export interface PortHit { port?: Device["ports"][number]; create?: { name: string; type: string } }
const SFP_TYPES = ["SFP", "SFP+", "QSFP", "Fiber LC"];

/** Which port of `dev` does the switch-side interface name mean? Existing port, or the port to create. null = not understood. */
export function locatePort(dev: Pick<Device, "ports">, iface: string, u?: Pick<PlanUnit, "mainSlot" | "slotOffsets"> | null): PortHit | null {
  const exact = dev.ports.find((p) => p.name.toLowerCase() === iface.trim().toLowerCase());
  if (exact) return { port: exact };
  const pp = parsePort(iface);
  if (!pp) return null;
  const named = (n: string) => dev.ports.find((p) => p.name === n);
  const front = dev.ports.filter((p) => p.type === "RJ45");
  const sfps = dev.ports.filter((p) => SFP_TYPES.includes(p.type));
  if (pp.x) {
    if (pp.num < front.length) return { port: front[pp.num] };
    const s = sfps[pp.num - front.length];
    return s ? { port: s } : { create: { name: `X${pp.num}`, type: "RJ45" } };
  }
  if (pp.slot != null) {
    const main = u?.mainSlot ?? 1;
    if (pp.slot === main) { const h = named(String(pp.num)); return h ? { port: h } : { create: { name: String(pp.num), type: "RJ45" } }; }
    const idx = (u?.slotOffsets[pp.slot] ?? 0) + pp.num - 1;
    return sfps[idx] ? { port: sfps[idx] } : { create: { name: `SFP+${idx + 1}`, type: "SFP+" } };
  }
  const h = named(String(pp.num));
  return h ? { port: h } : { create: { name: /^\d+$/.test(pp.raw) ? String(pp.num) : pp.raw, type: "RJ45" } };
}

// ---------------------------------------------------------------- matching against devices already in the document
export interface Ident { key: string; serial: string; macs: string[]; name: string }
export const identOf = (d: AuvikDevice, key = auvikKey(d)): Ident => ({ key, serial: d.serial, macs: d.macs.map(normMac), name: d.name });

/** Existing device -> same device in a new export: serial, then MAC, then name. */
export function matchesDevice(d: Device & { auvik_id?: string; auvik_name?: string; auvik_macs?: string[] }, id: Ident): boolean {
  if (!d.auvik_id) return false;
  if (id.serial && (d.serial === id.serial || d.auvik_id.split("#")[0] === id.serial)) return true;
  if (id.macs.length && (d.auvik_macs || []).some((m) => id.macs.includes(normMac(m)))) return true;
  return (d.auvik_name || "").toLowerCase() === id.name.toLowerCase() && !!id.name;
}
