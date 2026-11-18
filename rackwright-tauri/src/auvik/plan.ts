// Auvik devices -> an import plan: classify, match catalog templates, split stacks, group endpoints, map ports. Pure.
import { CATALOG, Tpl, catalogMatch, clone } from "../edit";
import type { Device } from "../types";
import { AuvikDevice, ParsedAuvik, normMac } from "./parse";

export type Kind = "firewall" | "router" | "switch" | "server" | "storage" | "ups" | "pdu" | "ap" | "ipmi" | "controller" | "vm" | "endpoint";
export type Mode = "rack" | "off" | "endpoint" | "phone" | "iot" | "vm" | "skip";
export type EpKind = "pc" | "phone" | "iot" | "printer" | "vm" | "other";
export type Mount = "kit" | "shelf";

export interface PlanItem {
  key: string;            // auvik_id: serial || mac || name
  dev: AuvikDevice;
  type: string;           // Auvik type; editable in the review step (changing it re-classifies the row)
  kind: Kind;
  mode: Mode;             // editable in the review step
  defaultMode: Mode;
  virtual: boolean;       // infra-looking VM / controller with no physical connection: listed, not drawn
  tplName: string;        // matched template, for the review table
  generic: boolean;       // no specific catalog match
  units: number[];        // stack unit numbers (more than one = stack)
  connectedTo: string;    // readable list of neighbours
  host: string | null;    // VM rows: key of the device the VM runs on, "" = no host, null = not guessed yet
  desktop: boolean;       // desktop-size firewall (does not fit a 19" rack by itself)
  mount: Mount;           // desktop firewalls: "kit" = 1U rack-mount kit with front ports, "shelf" = on a shelf
  kitName: string;        // template used for the mount kit
  hostGuessed?: boolean;  // VM rows from the API import: host came from guessHost (names), so the preview asks to check it
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const auvikKey = (d: AuvikDevice) => (d.apiId ? "api:" + d.apiId : d.serial || d.macs[0] || d.name);

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
const PHONE_RE = /grandstream|mitel|yealink|polycom|\bpoly\b|fanvil|snom|avaya|cisco ip phone|aastra/i;
const IOT_RE = /dahua|raspberry|espressif|esphome|logitech|tripp|camera|hikvision|\bring\b|\bnest\b|sonos|shelly|tasmota/i;

/** What kind of endpoint is this? Used for "Endpoint" mode; Phone / IoT / Virtual machine modes set it directly. */
export function inferKind(type: string, model = "", name = ""): EpKind {
  const t = type.toLowerCase();
  if (/phone|telecom/.test(t)) return "phone";
  if (/workstation|laptop|desktop|\bpc\b/.test(t)) return "pc";
  if (/printer/.test(t)) return "printer";
  if (/virtual/.test(t)) return "vm";
  if (PHONE_RE.test(`${model} ${name}`)) return "phone";
  if (IOT_RE.test(`${model} ${name}`) || /camera|\biot\b/.test(t)) return "iot";
  return "other";
}
/** The endpoint kind a row gets from its Include-as choice. */
export const epKindOf = (it: Pick<PlanItem, "mode" | "type" | "dev">): EpKind =>
  it.mode === "phone" ? "phone" : it.mode === "iot" ? "iot" : it.mode === "vm" ? "vm" : inferKind(it.type, it.dev.model, it.dev.name);
export const isEndpointMode = (m: Mode) => m === "endpoint" || m === "phone" || m === "iot";

function defaultMode(kind: Kind, linked: boolean, d: AuvikDevice, type: string): { mode: Mode; virtual: boolean } {
  if (RACK_KINDS.includes(kind)) return { mode: "rack", virtual: false };
  if (kind === "ap" || kind === "ipmi") return { mode: "off", virtual: false };
  if (kind === "controller") return linked ? { mode: "rack", virtual: false } : { mode: "skip", virtual: true };
  if (kind === "vm") return !linked && INFRA_VM.test(`${d.name} ${d.model}`) ? { mode: "skip", virtual: true } : { mode: "vm", virtual: false };
  const k = inferKind(type, d.model, d.name);
  return { mode: k === "phone" ? "phone" : k === "iot" ? "iot" : "endpoint", virtual: false };
}

const KIND_WORD: Record<EpKind, [string, string]> = { pc: ["PC", "PCs"], phone: ["phone", "phones"], iot: ["IoT device", "IoT devices"], printer: ["printer", "printers"], vm: ["VM", "VMs"], other: ["other", "other"] };
/** "30 devices (23 phones, 3 PCs, 4 other)". */
export function summarize(kinds: EpKind[]): string {
  const n = kinds.length;
  const c = new Map<EpKind, number>();
  for (const k of kinds) c.set(k, (c.get(k) || 0) + 1);
  const parts = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (k === "other" ? `${v} other` : `${v} ${KIND_WORD[k][v === 1 ? 0 : 1]}`));
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
  return { name: "Management controller (iDRAC / iLO)", type: "Management", u_size: 1, half: true, color: "#5b4b7a", rows: 1, model: "", ports: mkPorts(["Mgmt"], "Mgmt") }; // theme-ok
}
export function groupTemplate(n: number): Tpl {
  const rows = Math.max(2, Math.min(12, Math.ceil(n / 12)));
  return { name: "Endpoints", type: "Endpoints", u_size: Math.max(1, Math.ceil((12 * rows + 4) / 26)), half: false, color: "#44566a", rows, model: "", ports: [] }; // theme-ok
}

export function vmTemplate(): Tpl {
  return { name: "Virtual machines", type: "Virtual machines", u_size: 1, half: false, color: "#4b3f72", rows: 1, model: "", ports: [] }; // theme-ok
}

/** Desktop-size gear: a desktop faceplate, or half a rack wide. */
export const isDesktopTpl = (t: Tpl) => !!(t.plate?.off || t.plate?.desk || t.half);
/** 1U rack-mount kit that brings a desktop firewall's ports to the front. Port names follow the firewall (X0..X9 on SonicWall TZ), so Auvik names like X1 still land. */
export function mountKit(t: Tpl): Tpl {
  const base = t.group === "SonicWall" || /sonicwall/i.test(t.name) ? CATALOG.find((c) => c.name === "SonicWall TZ rack mount kit (front ports)") : null;
  if (base) { const k = clone(base); k.model = t.model || k.model; return k; }
  const k = clone(byName("Firewall 1U mount kit, front ports"));
  const own = t.ports.filter((p) => p.type !== "Power");
  if (own.length) k.ports = clone(own);
  k.model = t.model || "";
  if (t.plate?.brand) { k.plate.brand = t.plate.brand; k.plate.bc = t.plate.bc || k.plate.bc; }
  k.name = t.name.replace(/\s*\(desktop\)\s*$/i, "") + " mount kit (front ports)";
  return k;
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
  // Scale Computing edge nodes only when the text names the SNUC hardware; Pegatron-built Scale rack nodes stay generic.
  if (kind === "server" && /\bhe[-\s]?(150|250)\b|nuc13ox|nuc24oxg|\bonyx\b/i.test(full)) {
    const hc = ret(byShort(/\bhe[-\s]?150\b|nuc13ox/i.test(full) ? "HE150" : "HE250"));
    if (hc) return hc;
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
export interface Link { a: string; b: string; ifA: string; ifB: string; n?: number }
const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** One link per cable. "A lists B through X" means X is B's interface. Both sides usually list the same cable, so the
 *  interfaces seen on each side are paired in order; two cables between the same pair stay two links. */
export function buildLinks(p: ParsedAuvik, keyOf: Map<AuvikDevice, string>): { links: Link[]; unresolved: number } {
  const byName = new Map<string, AuvikDevice>();
  for (const d of p.devices) if (!byName.has(d.rawName.toLowerCase())) byName.set(d.rawName.toLowerCase(), d);
  const map = new Map<string, { a: string; b: string; ifA: string[]; ifB: string[] }>();
  let unresolved = 0;
  const add = (list: string[], iface: string) => { if (!iface || !list.includes(iface)) list.push(iface); };
  for (const a of p.devices) for (const n of a.neighbors) {
    const b = byName.get(n.name.toLowerCase());
    if (!b) { unresolved++; continue; }
    if (b === a) continue;
    const ka = keyOf.get(a)!, kb = keyOf.get(b)!;
    const k = linkKey(ka, kb);
    let l = map.get(k);
    if (!l) { l = ka < kb ? { a: ka, b: kb, ifA: [], ifB: [] } : { a: kb, b: ka, ifA: [], ifB: [] }; map.set(k, l); }
    add(l.b === kb ? l.ifB : l.ifA, n.iface); // the interface belongs to b
  }
  const links: Link[] = [];
  for (const l of map.values()) {
    const named = (x: string[]) => x.filter(Boolean), blanks = (x: string[]) => x.length - named(x).length;
    const n = Math.max(1, named(l.ifA).length, named(l.ifB).length, blanks(l.ifA), blanks(l.ifB));
    const fa = [...named(l.ifA)], fb = [...named(l.ifB)];
    for (let i = 0; i < n; i++) links.push({ a: l.a, b: l.b, ifA: fa[i] || "", ifB: fb[i] || "", n: i });
  }
  return { links, unresolved };
}

// ---------------------------------------------------------------- plan
export interface PlanUnit {
  key: string; itemKey: string; name: string; unit?: number; item: PlanItem; tpl: Tpl; generic: boolean;
  mode: "rack" | "off"; maxPort: number; mainSlot: number; slotOffsets: Record<number, number>; isGroup?: false;
  existingId?: number;    // stands for a server already in the document (an OOBM host chosen in the review); never created
  placeholder?: boolean;  // "New server" made for an OOBM controller
}
export interface Member { name: string; type: string; model: string; ip: string; mac: string; port: string; status: string; key: string; kind: EpKind }
export interface PlanGroup { key: string; name: string; unit: PlanUnit; members: Member[]; summary: string; isGroup: true; tpl: Tpl }
/** VMs on one host (or the "no host" box). Drawn as an off-rack "Virtual machines" device with no ports. */
export interface PlanVmBox { key: string; name: string; hostKey: string | null; hostUnit: PlanUnit | null; members: Member[]; summary: string; tpl: Tpl }
export interface PortRef { target: PlanUnit | PlanGroup; iface: string; fast: boolean; member?: number; oobm?: string /* key of the OOBM controller: the end is the host's OOBM port */ }
export interface PlanCable { a: PortRef; b: PortRef; label: string; key: string }
export interface Unplaced { name: string; type: string; model: string; ip: string; mac: string; status: string; reason: string }
/** An iDRAC / iLO / BMC drawn as a port on the back of its host server. */
export interface PlanOobm { key: string; item: PlanItem; name: string; ip: string; mac: string; serial: string; port: string; unit: PlanUnit; newServer: boolean }
export interface ImportPlan {
  site: string; units: PlanUnit[]; groups: PlanGroup[]; vmBoxes: PlanVmBox[]; cables: PlanCable[]; unplaced: Unplaced[]; virtual: string[]; warnings: string[]; oobms: PlanOobm[];
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

function analyze(p: ParsedAuvik, prev: PlanItem[] = []): Analysis {
  const typeOver = new Map(prev.map((i) => [i.key, i.type]));
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
    const type = typeOver.get(key) ?? d.type;
    const kind = classify({ type, name: d.name, model: d.model });
    const mine = links.filter((l) => l.a === key || l.b === key);
    const { mode, virtual } = defaultMode(kind, mine.length > 0, d, type);
    const ifs = mine.map((l) => ifaceOf(l, key)).filter(Boolean);
    const { unitNums, layout } = portLayout(kind === "switch" ? ifs : []);
    const units = unitNums.length > 1 ? unitNums : [];
    const lay = layout(units.length ? units[0] : null);
    const { tpl, generic } = matchTemplate({ ...d, type }, kind, lay.maxPort);
    const names = new Map(p.devices.map((x) => [keyOf.get(x)!, x.name]));
    const desktop = kind === "firewall" && isDesktopTpl(tpl);
    const item: PlanItem = {
      key, dev: d, type, kind, mode, defaultMode: mode, virtual, host: null, desktop, mount: "kit", kitName: desktop ? mountKit(tpl).name : "", tplName: (generic ? "generic: " : "") + tpl.name, generic, units,
      connectedTo: mine.map((l) => names.get(otherOf(l, key)) || "").filter(Boolean).join(", "),
    };
    items.push(item); byKey.set(key, item);
  }
  return { items, byKey, links, warnings };
}

export function buildItems(p: ParsedAuvik, ctx?: HostCtx): PlanItem[] { return fillHosts(analyze(p).items, ctx); }

// ---------------------------------------------------------------- VM hosts
const HOST_RULES: [RegExp, RegExp][] = [
  [/scale/i, /pegatron|scale|\.sc\d{2}/i],
  [/hyper-?v|microsoft/i, /hyper-?v|microsoft/i],
  [/vmware/i, /esxi|vmware/i],
];
/** Guess which host a VM runs on from vendor words. Hosts are the placed servers / hypervisors; the first match wins. "" = no guess. */
export function guessHost(vm: Pick<PlanItem, "dev">, hosts: PlanItem[]): string {
  const vtext = `${vm.dev.model} ${vm.dev.description}`;
  for (const [vr, hr] of HOST_RULES) {
    if (!vr.test(vtext)) continue;
    const h = hosts.find((x) => hr.test(`${x.dev.model} ${x.dev.name} ${x.dev.description}`));
    return h ? h.key : "";
  }
  return "";
}
export const hostsOf = (items: PlanItem[]) => items.filter((i) => i.kind === "server" && (i.mode === "rack" || i.mode === "off"));

// ---------------------------------------------------------------- OOBM hosts (iDRAC / iLO / BMC)
/** Servers already in the document, offered as OOBM hosts. */
export interface HostCtx { servers: { id: number; name: string; serial: string; oobmKey?: string; auvikKey?: string }[] }
export const hostCtxOf = (doc: { devices: Device[] }): HostCtx => ({
  servers: doc.devices.filter((d) => (d.type === "Server" || d.type === "Storage") && !d.auvik_id?.startsWith("g:") && !d.auvik_id?.startsWith("vm:"))
    .map((d) => ({ id: d.id, name: d.name, serial: d.serial || "", oobmKey: d.oobm?.key, auvikKey: d.auvik_id?.split("#")[0] })),
});
export const oobmHostsOf = (items: PlanItem[]) => items.filter((i) => (i.kind === "server" || i.kind === "storage") && (i.mode === "rack" || i.mode === "off"));
/** The server name an iDRAC belongs to: "Host1-iDrac" -> "Host1", "idrac-esxi9" -> "esxi9". */
export function stripOobm(name: string): string {
  const s = name.trim().split(".")[0].replace(/^(idrac|ilo|bmc|ipmi)[-_ ]+/i, "").replace(/[-_ ]*(idrac\d*|ilo\d*|bmc|ipmi|imm\d*|oobm)$/i, "").trim();
  return s || name.trim();
}
/** "iDRAC", "iLO", "BMC" or "OOBM" from the vendor / model text. */
export function oobmPortName(d: Pick<AuvikDevice, "name" | "model" | "description">): string {
  const t = `${d.model} ${d.name} ${d.description}`;
  if (/idrac|dell/i.test(t)) return "iDRAC";
  if (/\bilo\b|ilo\d|hpe|hewlett|\bhp\b/i.test(t)) return "iLO";
  if (/bmc|supermicro|ipmi/i.test(t)) return "BMC";
  return "OOBM";
}
/** Which host does this controller belong to? Plan key, "doc:<id>", or "new". Matches the host's saved OOBM key first, then name, then serial. */
export function guessOobmHost(it: Pick<PlanItem, "key" | "dev">, hosts: PlanItem[], ctx?: HostCtx): string {
  const mine = ctx?.servers.find((s) => s.oobmKey === it.key);
  if (mine) return mine.auvikKey && hosts.some((h) => h.key === mine.auvikKey) ? mine.auvikKey : `doc:${mine.id}`;
  const want = stripOobm(it.dev.name).toLowerCase();
  const same = (n: string) => !!n && n.toLowerCase().split(".")[0] === want;
  const bySerial = it.dev.serial;
  const h = hosts.find((x) => same(x.dev.name)) ?? (bySerial ? hosts.find((x) => x.dev.serial === bySerial) : undefined);
  if (h) return h.key;
  const s = ctx?.servers.find((x) => !x.oobmKey && same(x.name)) ?? (bySerial ? ctx?.servers.find((x) => x.serial === bySerial && !x.oobmKey) : undefined);
  return s ? `doc:${s.id}` : "new";
}
const isOobmRow = (i: PlanItem) => i.kind === "ipmi" && (i.mode === "rack" || i.mode === "off");
/** Give every VM row and every OOBM row that has no host choice yet (or whose host is gone) a guessed one. */
export function fillHosts(items: PlanItem[], ctx?: HostCtx): PlanItem[] {
  const hosts = hostsOf(items), oh = oobmHostsOf(items);
  return items.map((i) => {
    if (i.mode === "vm" && (i.host === null || (i.host && !hosts.some((h) => h.key === i.host)))) return { ...i, host: guessHost(i, hosts) };
    if (isOobmRow(i)) {
      const h = i.host;
      const ok = h !== null && (h === "new" || h === "off" || (h.startsWith("doc:") ? !!ctx?.servers.some((s) => `doc:${s.id}` === h) : oh.some((x) => x.key === h)));
      if (!ok) return { ...i, host: guessOobmHost(i, oh, ctx) };
    }
    return i;
  });
}
/** The user changed "Include as" on one row. */
export function setMode(items: PlanItem[], key: string, mode: Mode, ctx?: HostCtx): PlanItem[] {
  return fillHosts(items.map((i) => (i.key === key ? { ...i, mode, host: mode === "vm" || (i.kind === "ipmi" && (mode === "rack" || mode === "off")) ? i.host : null } : i)), ctx);
}
/** The user changed the Type of one row: classify it again (kind, default Include as, template). Other rows keep their edits. */
export function retype(p: ParsedAuvik, items: PlanItem[], key: string, type: string, ctx?: HostCtx): PlanItem[] {
  const next = items.map((i) => (i.key === key ? { ...i, type } : i));
  const fresh = analyze(p, next).items.find((i) => i.key === key);
  if (!fresh) return items;
  return fillHosts(next.map((i) => (i.key === key ? { ...fresh, mount: i.mount } : i)), ctx);
}

const PRIORITY: Record<Kind, number> = { firewall: 0, router: 1, switch: 2, controller: 3, server: 4, pdu: 5, ups: 6, storage: 7, ap: 8, ipmi: 9, vm: 10, endpoint: 11 };

/** Turn the (possibly edited) review rows into concrete devices, endpoint groups and cables. */
export function resolvePlan(p: ParsedAuvik, items: PlanItem[]): ImportPlan {
  const an = analyze(p, items);
  const warnings = [...an.warnings];
  const mode = new Map(items.map((i) => [i.key, i.mode]));
  const item = (k: string) => an.byKey.get(k)!;
  const isActive = (k: string) => { const m = mode.get(k); return m === "rack" || m === "off"; };

  // 1. one unit per placed device, several per stack
  const units: PlanUnit[] = [];
  const unitsOf = new Map<string, PlanUnit[]>();
  // OOBM controllers with a host become a port on the host (a placed server, a server already in the document, or a new placeholder)
  const oobmHostable = new Set(oobmHostsOf(items).map((h) => h.key));
  const isOobm = (it: PlanItem) => it.kind === "ipmi" && isActive(it.key) && !!it.host && it.host !== "off" &&
    (it.host === "new" || it.host.startsWith("doc:") || oobmHostable.has(it.host));
  for (const it of items) {
    if (!isActive(it.key) || isOobm(it)) continue;
    const ifs = an.links.filter((l) => l.a === it.key || l.b === it.key).map((l) => ifaceOf(l, it.key)).filter(Boolean);
    const { unitNums, layout } = portLayout(it.kind === "switch" ? ifs : []);
    const list: PlanUnit[] = [];
    const stack = unitNums.length > 1;
    for (const u of stack ? unitNums : [null]) {
      const lay = layout(u);
      let { tpl, generic } = matchTemplate({ ...it.dev, type: it.type }, it.kind, lay.maxPort);
      if (it.kind === "firewall" && it.mount === "kit" && isDesktopTpl(tpl)) { tpl = mountKit(tpl); generic = false; }
      
      list.push({
        key: stack ? `${it.key}#${u}` : it.key, itemKey: it.key, name: stack ? `${it.dev.name} unit ${u}` : it.dev.name, unit: stack ? (u as number) : undefined,
        item: it, tpl, generic, mode: it.mode as "rack" | "off", maxPort: lay.maxPort, mainSlot: lay.mainSlot, slotOffsets: lay.slotOffsets,
      });
    }
    unitsOf.set(it.key, list);
    units.push(...list);
  }
  const oobms: PlanOobm[] = [];
  const oobmOf = new Map<string, PlanOobm>();
  for (const it of items) {
    if (!isOobm(it)) continue;
    const d = it.dev, h = it.host as string;
    let unit: PlanUnit | undefined, newServer = false;
    if (h === "new") {
      const name = stripOobm(d.name);
      const tpl = clone(CATALOG.find((c) => c.name === "Server 2U")!);
      unit = { key: `oobm:${it.key}`, itemKey: `oobm:${it.key}`, name, item: it, tpl, generic: true, mode: "rack", maxPort: 0, mainSlot: 1, slotOffsets: {}, placeholder: true };
      units.push(unit); newServer = true;
    } else if (h.startsWith("doc:")) {
      const id = parseInt(h.slice(4));
      unit = { key: h, itemKey: h, name: "", item: it, tpl: clone(CATALOG.find((c) => c.name === "Server 2U")!), generic: true, mode: "off", maxPort: 0, mainSlot: 1, slotOffsets: {}, existingId: id };
    } else unit = unitsOf.get(h)![0];
    const o: PlanOobm = { key: it.key, item: it, name: d.name, ip: d.ips[0] || "", mac: d.macs[0] || "", serial: d.serial, port: oobmPortName(d), unit, newServer };
    oobms.push(o); oobmOf.set(it.key, o);
  }
  const prio = (u: PlanUnit) => (u.placeholder ? PRIORITY.server : PRIORITY[u.item.kind]);
  units.sort((x, y) => prio(x) - prio(y) || (x.unit ?? 0) - (y.unit ?? 0));

  const unitFor = (itemKey: string, iface: string): PlanUnit => {
    const o = oobmOf.get(itemKey);
    if (o) return o.unit;
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
    const ra: PortRef = { target: ua, iface: ia, fast }, rb: PortRef = { target: ub, iface: ib, fast };
    if (oobmOf.has(l.a)) { ra.oobm = l.a; ra.iface = ""; }
    if (oobmOf.has(l.b)) { rb.oobm = l.b; rb.iface = ""; }
    cables.push({ a: ra, b: rb, label, key: (l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`) + (l.n ? `#${l.n}` : "") });
  }

  // 3. endpoints: group per switch unit, one port per endpoint
  const unplaced: Unplaced[] = [];
  const groups = new Map<string, PlanGroup>();
  const virtual: string[] = [];
  for (const it of items) {
    if (it.mode === "skip") { if (it.virtual) virtual.push(it.dev.name); continue; }
    if (!isEndpointMode(it.mode)) continue;
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
    g.members.push({ name: d.name, type: d.type, model: d.model, ip: d.ips[0] || "", mac: d.macs[0] || "", port: best.iface, status: d.status, key: it.key, kind: epKindOf(it) });
  }
  const groupList = [...groups.values()];
  for (const g of groupList) {
    g.members.sort((x, y) => (parsePort(x.port)?.num ?? 9999) - (parsePort(y.port)?.num ?? 9999) || x.name.localeCompare(y.name));
    g.summary = summarize(g.members.map((m) => m.kind));
    g.tpl = groupTemplate(g.members.length);
    g.members.forEach((m, i) => {
      if (!m.port) return; // connected, but Auvik did not say which port
      if (!claim(g.unit, m.port, m.name)) return;
      cables.push({ a: { target: g, iface: "", fast: false, member: i }, b: { target: g.unit, iface: m.port, fast: false }, label: `${g.unit.name} ${m.port}`, key: `${g.key}|${m.key}` });
    });
  }

  // 4. virtual machines: one box per host (or one without a host), no ports
  const vmBoxes = new Map<string, PlanVmBox>();
  const hostItems = hostsOf(items);
  for (const it of items) {
    if (it.mode !== "vm") continue;
    const d = it.dev;
    const hk = it.host === null ? guessHost(it, hostItems) : it.host;
    const hostUnit = hk && hostItems.some((h) => h.key === hk) ? unitsOf.get(hk)?.[0] ?? null : null;
    const bk = hostUnit ? `vm:${hk}` : "vm:none";
    let b = vmBoxes.get(bk);
    if (!b) { b = { key: bk, name: hostUnit ? `VMs on ${hostUnit.name}` : "VMs (no host)", hostKey: hostUnit ? hk : null, hostUnit, members: [], summary: "", tpl: vmTemplate() }; vmBoxes.set(bk, b); }
    b.members.push({ name: d.name, type: it.type, model: d.model, ip: d.ips[0] || "", mac: d.macs[0] || "", port: "", status: d.status, key: it.key, kind: "vm" });
  }
  const vmList = [...vmBoxes.values()].sort((x, y) => (x.hostKey ? 0 : 1) - (y.hostKey ? 0 : 1) || x.name.localeCompare(y.name));
  for (const b of vmList) { b.members.sort((x, y) => x.name.localeCompare(y.name)); b.summary = summarize(b.members.map((m) => m.kind)); }
  return { site: p.site, units, groups: groupList, vmBoxes: vmList, cables, unplaced, virtual, warnings, oobms };
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
export interface Ident { key: string; serial: string; macs: string[]; name: string; apiKey: string | null; ips: string[]; host: string }
export const identOf = (d: AuvikDevice, key = auvikKey(d)): Ident => ({
  key, serial: d.serial, macs: d.macs.map(normMac), name: d.name,
  apiKey: d.apiId ? "api:" + d.apiId : null, ips: d.ips.filter(Boolean), host: (d.hostname || d.name || "").toLowerCase(),
});

/** Existing device -> same device in a new import: Auvik id, serial, MAC, IP + host name, then (Auvik-added devices only) Auvik name. */
export function matchesDevice(d: Device & { auvik_id?: string; auvik_name?: string; auvik_macs?: string[] }, id: Ident): boolean {
  if (id.apiKey && d.auvik_id === id.apiKey) return true;
  if (id.apiKey && d.auvik_id?.startsWith("api:")) return false;   // carries a different Auvik id: never the same device
  if (id.serial && (d.serial === id.serial || (!!d.auvik_id && d.auvik_id.split("#")[0] === id.serial))) return true;
  if (id.macs.length) {
    const mine = [...(d.auvik_macs || []), d.mac || ""].filter(Boolean).map(normMac);
    if (mine.some((m) => id.macs.includes(m))) return true;
  }
  const dh = (d.hostname || d.name || "").toLowerCase();
  if (d.ip && id.ips.includes(d.ip) && dh && dh === id.host) return true;
  if (!d.auvik_id) return false;
  return (d.auvik_name || "").toLowerCase() === id.name.toLowerCase() && !!id.name;
}
