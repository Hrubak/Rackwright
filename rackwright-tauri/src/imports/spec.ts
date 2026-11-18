// Shared shape of everything the text and CSV importers read. Ported from RackMap's devSpecFrom.
export type ImpFace = "front" | "rear" | "both";
export type ImportFieldKey = "model" | "ip" | "serial" | "mac" | "hostname" | "manufacturer" | "asset_tag" | "os" | "role" | "owner" | "status" | "warranty_exp" | "purchase_date" | "last_verified" | "notes";
export interface ImportDevice {
  line: number; // 1-based source line (CSV: file line, header is line 1)
  name: string;
  type: string | null; // Rackwright type ("Server", "Switch", "Patch panel", ...); null = not known
  rack: string | null | undefined; // rack name; null = off-rack; undefined = the dialog's target rack
  u: number | null; // lowest U, null = unknown
  height: number | null;
  heightGuessed?: boolean;
  cols?: number;
  side?: number;
  face?: ImpFace;
  group?: string;
  fields: Partial<Record<ImportFieldKey, string>> & { power_w?: number };
  ports: number | null;
  specs: Record<string, string>;
  services: { name: string; port: string; proto: string; status: string; notes: string }[];
}
export interface ImportRack { name: string; u: number | null; circuit?: string; notes?: string }
export interface ImportLink { a: string; ap: string; b: string; bp: string; type?: string; label?: string; length?: string; color?: string }
export type ImportKind = "layout" | "rackmap" | "inventory" | "cabling";
export interface ImportSpec { kind: ImportKind; racks: ImportRack[]; devices: ImportDevice[]; links: ImportLink[]; notes: string[]; warnings: string[] }

export const TYPE_MAP: Record<string, string> = {
  server: "Server", switch: "Switch", firewall: "Firewall", router: "Router", patchpanel: "Patch panel", ups: "UPS", pdu: "PDU",
  storage: "Storage", kvm: "KVM", shelf: "Shelf", cablemgmt: "Cable manager", blank: "Blank", other: "Other",
};

export const nk = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const TYPE_WORDS: Record<string, string> = {
  server: "server", srv: "server", host: "server", hypervisor: "server", switch: "switch", sw: "switch", firewall: "firewall", fw: "firewall",
  router: "router", rtr: "router", gateway: "router", patchpanel: "patchpanel", patch: "patchpanel", pp: "patchpanel", ups: "ups", battery: "ups",
  pdu: "pdu", powerstrip: "pdu", storage: "storage", nas: "storage", san: "storage", storagenas: "storage", kvm: "kvm", kvmconsole: "kvm",
  console: "kvm", consoleserver: "kvm", shelf: "shelf", tray: "shelf", cablemgmt: "cablemgmt", cablemanager: "cablemgmt", cablemanagement: "cablemgmt",
  cm: "cablemgmt", blank: "blank", blankpanel: "blank", filler: "blank", other: "other", modem: "other", ont: "other", ap: "other",
};
const TYPE_GUESS: [RegExp, string][] = [
  [/blank|filler/i, "blank"], [/cable ?(manager|mgmt|management|organi[sz]er)|brush ?panel/i, "cablemgmt"], [/shelf|tray/i, "shelf"],
  [/patch|keystone/i, "patchpanel"], [/\bups\b|battery backup|uninterrupt|smart-?ups|eaton 5p|cyberpower/i, "ups"],
  [/\bpdu\b|power strip|power distribution/i, "pdu"], [/\bkvm\b|console server|raritan|avocent|opengear/i, "kvm"],
  [/firewall|fortigate|sonicwall|palo ?alto|\bpa-\d|\basa\b|meraki mx|pfsense|opnsense|watchguard|sophos xg|\bfw\b/i, "firewall"],
  [/router|\bisr\b|mikrotik|\brtr\b|edgerouter/i, "router"], [/switch|catalyst|nexus|\bsw\b|procurve|usw|\bex\d{4}|icx/i, "switch"],
  [/\bnas\b|storage|\bsan\b|synology|qnap|netapp|truenas|powervault|\bmsa\d/i, "storage"],
  [/server|poweredge|proliant|\besxi?\b|hyper-?v|\bdc\b|domain controller|\bsrv\b|thinksystem|supermicro|\bhost\b/i, "server"],
];

/** RackMap type word (or a Rackwright type name) -> Rackwright type, or null. */
export function typeWord(w: string): string | null {
  const k = nk(w);
  if (TYPE_MAP[k]) return TYPE_MAP[k];
  if (TYPE_WORDS[k]) return TYPE_MAP[TYPE_WORDS[k]];
  return null;
}
/** First explicit type word, else a keyword guess over the text; null when nothing fits. */
export function guessType(...strs: (string | null | undefined)[]): string | null {
  for (const s of strs) { const w = s ? typeWord(s) : null; if (w) return w; }
  const s = strs.filter(Boolean).join(" ");
  for (const [re, t] of TYPE_GUESS) if (re.test(s)) return TYPE_MAP[t];
  return null;
}

export function parseUSpan(s: string): { u: number; height: number } | null {
  const m = String(s || "").trim().match(/^u?\s*(\d{1,2})\s*(?:(?:-|–|to|\/)\s*u?\s*(\d{1,2}))?\s*$/i);
  if (!m) return null;
  const a = +m[1], b = m[2] ? +m[2] : a;
  return { u: Math.min(a, b), height: Math.abs(a - b) + 1 };
}
export function parseWidth(v: string): number | null {
  const t = String(v).toLowerCase().replace(/\s+/g, "");
  if (/^(full|1|1\/1|100%|fullwidth)$/.test(t)) return 1;
  if (/^(half|1\/2|½|2|50%|halfwidth|2up)$/.test(t)) return 2;
  if (/^(third|1\/3|⅓|3|33%|33\.3%|thirdwidth|3up)$/.test(t)) return 3;
  return null;
}
function parsePos(v: string, wd: number): number {
  const t = String(v || "").toLowerCase().trim();
  if (!t) return 0;
  if (/^(l|left)/.test(t)) return 0;
  if (/^(r|right)/.test(t)) return wd - 1;
  if (/^(m|mid|middle|centre|center)/.test(t)) return Math.min(1, wd - 1);
  const n = parseInt(t);
  return n >= 1 ? Math.min(wd, n) - 1 : 0;
}
export function parseServices(str: string): ImportDevice["services"] {
  if (!str) return [];
  return String(str).split(/\s*[;|\n]\s*|,\s*(?=[A-Za-z])/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(.*?)[\s:(]+(\d[\d,\s\-]*)(?:\s*\/\s*(tcp|udp|tcp\/udp))?\)?$/i);
    return m
      ? { name: m[1].trim() || "Port " + m[2].trim(), port: m[2].trim(), proto: (m[3] || "TCP").toUpperCase(), status: "Running", notes: "" }
      : { name: x, port: "", proto: "TCP", status: "Running", notes: "" };
  });
}

// One place that maps loose key names (text keys, CSV headers) onto device fields. Targets are Rackwright field names.
export const FIELD_KEYS: Record<string, string> = {
  name: "name", device: "name", devicename: "name", equipment: "name",
  hostname: "hostname", host: "hostname", fqdn: "hostname", dns: "hostname", networkname: "hostname",
  type: "type", devicetype: "type", category: "type", kind: "type",
  rack: "rack", rackname: "rack", cabinet: "rack",
  u: "u", ru: "u", position: "u", rackunit: "u", startu: "u", bottomu: "u", unit: "u", uposition: "u", location: "u",
  height: "height", h: "height", size: "height", heightu: "height", units: "height", rusize: "height",
  mount: "face", mounted: "face", face: "face", mounting: "face", depth: "depth", fulldepth: "depth",
  width: "width", rackwidth: "width", devicewidth: "width", wdiv: "width", side: "pos", pos: "pos", wpos: "pos", sideposition: "pos", widthposition: "pos",
  manufacturer: "manufacturer", make: "manufacturer", vendor: "manufacturer", brand: "manufacturer", mfr: "manufacturer",
  model: "model", modelnumber: "model", product: "model", productnumber: "model", partnumber: "model",
  serial: "serial", serialnumber: "serial", sn: "serial", servicetag: "serial",
  assettag: "asset_tag", asset: "asset_tag", tag: "asset_tag", assetnumber: "asset_tag",
  ip: "ip", mgmt: "ip", mgmtip: "ip", managementip: "ip", ipaddress: "ip", ipv4address: "ip",
  ips: "ips", otherips: "ips", secondaryip: "ips", secondaryips: "ips",
  mac: "mac", macaddress: "mac", os: "os", osfirmware: "os", firmware: "os", operatingsystem: "os", version: "os",
  role: "role", purpose: "role", function: "role", description: "role", productdescription: "role", networkdescription: "role",
  owner: "owner", department: "owner",
  status: "status", state: "status", power: "power_w", powerw: "power_w", powerdraw: "power_w", draw: "power_w", watts: "power_w",
  warranty: "warranty_exp", warrantyexpires: "warranty_exp", warrantyexp: "warranty_exp", warrantyend: "warranty_exp",
  purchasedate: "purchase_date", purchased: "purchase_date", contract: "contract", supportcontract: "contract", support: "contract",
  lastverified: "last_verified", notes: "notes", note: "notes", comments: "notes", comment: "notes",
  services: "services", ports: "ports", portcount: "ports", numports: "ports", numberofports: "ports",
};

/** Port of RackMap devSpecFrom: key=value pairs onto an ImportDevice. */
export function devFrom(pairs: [string, string][], base: Partial<ImportDevice>): ImportDevice {
  const d: ImportDevice = { line: 0, name: "", type: null, rack: undefined, u: null, height: null, ports: null, ...base, fields: { ...(base.fields || {}) }, specs: { ...(base.specs || {}) }, services: [...(base.services || [])] };
  let posRaw = "";
  const extra: [string, string][] = [];
  for (const [k, raw] of pairs) {
    const v = raw == null ? "" : String(raw).trim();
    if (v === "") continue;
    const key = nk(k), f = FIELD_KEYS[key];
    if (f === "name") { if (!d.name) d.name = v; else d.fields.hostname = d.fields.hostname || v; }
    else if (f === "type") { if (!d.type) { d.type = typeWord(v); if (!d.type) d.specs.type = v; } }
    else if (f === "rack") d.rack = v;
    else if (f === "u") {
      const sp = parseUSpan(v);
      if (sp) { d.u = sp.u; if (sp.height > 1) d.height = d.height || sp.height; }
      else if (key !== "location") extra.push([k, v]);
      else d.fields.notes = (d.fields.notes ? d.fields.notes + "\n" : "") + "Location: " + v;
    }
    else if (f === "height") { const n = parseInt(v); if (n > 0) d.height = n; }
    else if (f === "width") { const w = parseWidth(v); if (w && w > 1) d.cols = w; else if (!w) extra.push([k, v]); }
    else if (f === "pos") posRaw = v;
    else if (f === "face") {
      if (/^(rear|back|r|b)\b/i.test(v)) d.face = "rear"; else if (/^(front|f)\b/i.test(v)) d.face = "front"; else extra.push([k, v]);
    }
    else if (f === "depth") { d.specs.depth = /half|short|shallow|no|false/i.test(v) ? "half" : /full|deep|long|yes|true/i.test(v) ? "full" : v; }
    else if (f === "ports") { const n = parseInt(v); if (n >= 0) d.ports = n; }
    else if (f === "services") d.services.push(...parseServices(v));
    else if (f === "contract") d.specs.contract = v;
    else if (f === "ips") d.specs.ips = v;
    else if (f === "power_w") { const n = parseFloat(v); if (Number.isFinite(n)) d.fields.power_w = n; else extra.push([k, v]); }
    else if (f) (d.fields as Record<string, string>)[f] = v;
    else extra.push([k, v]);
  }
  for (const [k, v] of extra) d.specs[k] = v;
  if (!d.type) d.type = guessType(d.name, d.fields.model, d.fields.role);
  if (d.cols && d.cols > 1) d.side = parsePos(posRaw, d.cols);
  return d;
}
