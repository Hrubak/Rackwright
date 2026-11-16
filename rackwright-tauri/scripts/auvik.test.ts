// Auvik import tests. All data is synthetic ("Example Co"); no real customer export is read.
import JSZip from "jszip";
import { readXlsx, colIndex } from "../src/auvik/xlsx";
import { parseAuvik, parseConnected } from "../src/auvik/parse";
import { buildItems, resolvePlan, parsePort, classify, retype, setMode, inferKind, summarize, hostCtxOf, stripOobm, guessOobmHost } from "../src/auvik/plan";
import { computeDiff, defaultSelection } from "../src/auvik/diff";
import { applyInPlace, findMissing } from "../src/auvik/apply";
import { Device, Doc, RW } from "../src/types";
import { portOf, clone, nid, newCable, fromTpl, CATALOG } from "../src/edit";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

// ---------------------------------------------------------------- fixture
const HEAD = ["Organization Name", "Domain Prefix", "Status", "Device Name", "Type", "Make & Model", "MAC Address(es)", "IP Address(es)", "Network(s)", "Connected To", "Software Version", "Serial Number", "Firmware Version", "Description"];
const stable = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const seen = new Map<string, number>();
const mac = (name = "") => { const n = (seen.get(name) || 0) + 1; seen.set(name, n); const h = stable(name + n); return `02:00:5E:${(h >> 16 & 255).toString(16).padStart(2, "0")}:${(h >> 8 & 255).toString(16).padStart(2, "0")}:${(h & 255).toString(16).padStart(2, "0")}`.toUpperCase(); };
const ipFor = (name: string) => `10.99.${stable(name) % 200 + 1}.${stable(name + "x") % 200 + 10}`;
interface D { name: string; type: string; model?: string; conn?: string; status?: string; serial?: string; mac?: string; ip?: string; desc?: string }
const row = (d: D) => ["Example Co", "exampleco", d.status || "Up", d.name, d.type, d.model || "", d.mac ?? mac(d.name), d.ip ?? ipFor(d.name), "10.99.1.0/24", d.conn ?? "0", "1.0", d.serial ?? "", "2.0", d.desc ?? ""];

function devices(extra: D[] = [], drop: string[] = [], ipChange: Record<string, string> = {}): D[] {
  const L: D[] = [
    { name: "EX-FW", type: "Firewall", model: "SonicWALL TZ 570", serial: "FWSER1", mac: "02:00:5E:00:00:01", conn: "EX-CORE through GigabitEthernet1/1/1" },
    { name: "EX-FW", type: "Firewall", model: "SonicWALL TZ 570", serial: "FWSER1", mac: "02:00:5E:00:00:01", status: "Down", conn: "0" },
    { name: "EX-CORE", type: "Layer 3 Switch", model: "Brocade ICX7250-48-HPOE", serial: "COREser", conn: "EX-FW through X1, EX-SW-STACK through 10GigabitEthernet1/2/1, EX-SW-02 through 24, EX-UPS through vmac0" },
    { name: "EX-SW-STACK", type: "Switch", model: "Brocade ICX7150", serial: "STKser", conn: "EX-CORE through GigabitEthernet1/1/40" },
    { name: "EX-SW-02", type: "Switch", model: "HP 2530-24G-PoE+", serial: "HPser", conn: "EX-CORE through GigabitEthernet1/1/48" },
    { name: "EX-UPS", type: "UPS", model: "APC Smart-UPS 3000", conn: "EX-CORE through GigabitEthernet1/1/5" },
    { name: "EX-PDU", type: "PDU", model: "APC Basic Rack PDU AP7900B", conn: "EX-SW-02 through 2" },
    { name: "EX-RTR", type: "Router", model: "Cisco ISR 4331", conn: "EX-CORE through GigabitEthernet1/1/2" },
    { name: "EX-ESX1", type: "Hypervisor", model: "Dell PowerEdge R640", serial: "ESX1ser", conn: "EX-SW-02 through 10" },
    { name: "EX-ESX1-iDRAC", type: "Intelligent Platform Management Interface", model: "Dell iDRAC9", conn: "EX-SW-02 through 11" },
    { name: "EX-SRV2", type: "Server", model: "Generic server", ip: "10.99.1.200", conn: "EX-SW-02 through 13" },
    { name: "EX-NAS", type: "Storage", model: "Synology RS1221+", conn: "EX-SW-02 through 14" },
    { name: "EX-AP1", type: "Access Point", model: "Ubiquiti U6 Pro", conn: "EX-SW-02 through 12" },
    { name: "EX-AP2", type: "Access Point", model: "Acme Wifi 9", conn: "EX-SW-STACK through GigabitEthernet2/1/9" },
    { name: "EX-SZ", type: "Controller", model: "Virtual SmartZone", conn: "0" },
    { name: "EX-WLC", type: "Wireless Controller", model: "", conn: "EX-SW-02 through 15" },
    { name: "EX-VM1", type: "Virtual Machine", model: "VMware", conn: "EX-ESX1 through vmxnet3 Ethernet Adapter" },
    { name: "Phone 1", type: "IP Phone", conn: "EX-SW-02 through 3" },
    { name: "Phone 2", type: "IP Phone", conn: "EX-SW-02 through 4" },
    { name: "Phone 3", type: "Telecommunications Device", conn: "EX-SW-STACK through GigabitEthernet1/1/3" },
    { name: "PC-1", type: "Workstation", conn: "EX-SW-02 through 5" },
    { name: "PC-2", type: "Workstation", conn: "EX-SW-STACK through GigabitEthernet3/1/22" },
    { name: "PC-3", type: "Workstation", conn: "EX-SW-STACK through GigabitEthernet2/1/30" },
    { name: "Cam-1", type: "Generic Device", model: "Camera", conn: "EX-SW-STACK through 2.5GigabitEthernet1/1/7" },
    { name: "Printer-1", type: "Printer", conn: "EX-SW-02 through 6" },
    { name: "Unidentified Device", type: "Unknown", conn: "EX-SW-02 through 20" },
    { name: "Unidentified Device", type: "Unknown", conn: "EX-SW-02 through 21" },
    { name: "Device@10.99.1.77", type: "Generic Device", ip: "10.99.1.77", conn: "EX-SW-02 through 22" },
    { name: "Orphan Laptop", type: "Workstation", conn: "0" },
    { name: "Wifi Laptop", type: "Workstation", conn: "EX-AP1 through wifi1" },
  ];
  const out = L.filter((d) => !drop.includes(d.name)).map((d) => ({ ...d, ip: ipChange[d.name] ?? d.ip }));
  return [...out, ...extra];
}

async function makeXlsx(ds: D[]): Promise<Uint8Array> {
  seen.clear();
  const z = new JSZip();
  const strings: string[] = [];
  const si = (s: string) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colL = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheetXml = (rows: string[][], shared: boolean) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => v === "" ? "" :
      shared ? `<c r="${colL(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>` : `<c r="${colL(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("") + `</row>`).join("") + `</sheetData></worksheet>`;
  const sheets = [
    { name: "Summary", rows: [["SUMMARY"], ["Metric", "Value"], ["Devices", String(ds.length)]], shared: false },
    { name: "Sites", rows: [["SITES"], ["Site Name"], ["Example Co Main"]], shared: false },
    { name: "Devices", rows: [["DEVICES"], HEAD, ...ds.map(row)], shared: true },
    { name: "Alerts", rows: [["ALERTS"], ["No data available."]], shared: false },
  ];
  sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.shared)));
  z.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  z.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  return z.generateAsync({ type: "uint8array" });
}

const load = async (ds: D[]) => parseAuvik(await readXlsx(await makeXlsx(ds)));
const empty = (): Doc => ({ v: 1, nid: 1, racks: [], devices: [], cables: [] });
const run = (doc: Doc, p: Awaited<ReturnType<typeof load>>, opt: Parameters<typeof applyInPlace>[2], sel?: (ids: string[]) => Set<string>, tweak?: (i: ReturnType<typeof buildItems>) => ReturnType<typeof buildItems>) => {
  let items = buildItems(p, hostCtxOf(doc));
  if (tweak) items = tweak(items);
  const plan = resolvePlan(p, items);
  const diff = computeDiff(doc, plan, items);
  return { plan, items, diff, res: applyInPlace(doc, plan, opt, items, sel ? sel(diff.changes.map((c) => c.id)) : undefined) };
};

async function main() {
  t("column letters beyond Z", colIndex("AA1") === 26 && colIndex("AB3") === 27 && colIndex("Z9") === 25);
  t("connected-to split", parseConnected("A through Gi1/0/1, B through Some Interface").length === 2 && parseConnected("0").length === 0);
  t("port parsing", parsePort("GigabitEthernet3/1/22")?.unit === 3 && parsePort("X0:V50 (Wireless)")?.num === 0 && parsePort("2.5GigabitEthernet1/1/2")?.speed === 2.5 && parsePort("vmac0") === null && parsePort("Some Interface") === null);
  t("classify", classify({ type: "Intelligent Platform Management Interface", name: "", model: "" }) === "ipmi" && classify({ type: "Layer 3 Switch", name: "", model: "" }) === "switch");

  const p = await load(devices());
  t("site from organisation", p.site === "Example Co");
  t("firewall listed twice is merged", p.devices.filter((d) => d.rawName === "EX-FW").length === 1 && p.devices.find((d) => d.rawName === "EX-FW")!.rows === 2);
  t("unidentified devices stay distinct", p.devices.filter((d) => d.rawName === "Unidentified Device").length === 2 && p.devices.some((d) => d.name === "Unidentified Device (2)"));
  t("unnamed device flagged", p.devices.find((d) => d.rawName.startsWith("Device@"))!.unnamed);

  const items = buildItems(p);
  const mode = (n: string) => items.find((i) => i.dev.name === n)!.mode;
  t("default modes", mode("EX-CORE") === "rack" && mode("EX-UPS") === "rack" && mode("EX-AP1") === "off" && mode("EX-ESX1-iDRAC") === "off" && mode("PC-1") === "endpoint" && mode("EX-SZ") === "skip");
  t("virtual flagged", items.find((i) => i.dev.name === "EX-SZ")!.virtual);
  t("model matching", items.find((i) => i.dev.name === "EX-FW")!.tplName.includes("TZ570") && items.find((i) => i.dev.name === "EX-UPS")!.tplName.includes("SMT3000") &&
    items.find((i) => i.dev.name === "EX-CORE")!.tplName.includes("7250-48P") && items.find((i) => i.dev.name === "EX-ESX1")!.tplName.includes("R640") &&
    items.find((i) => i.dev.name === "EX-SW-02")!.tplName.startsWith("generic") && items.find((i) => i.dev.name === "EX-AP1")!.tplName.includes("U6 Pro"),
    items.map((i) => i.dev.name + "=" + i.tplName).join(" | "));
  t("stack detected", items.find((i) => i.dev.name === "EX-SW-STACK")!.units.join() === "1,2,3");

  const doc = empty();
  const { plan, res } = run(doc, p, { target: "new" });
  const dn = (n: string) => doc.devices.find((d) => d.name === n)!;
  t("stack becomes 3 unit devices", [1, 2, 3].every((n) => doc.devices.some((d) => d.name === `EX-SW-STACK unit ${n}`)));
  const u3 = dn("EX-SW-STACK unit 3"), u1 = dn("EX-SW-STACK unit 1"), u2 = dn("EX-SW-STACK unit 2");
  t("stack units adjacent", u1.rack === u2.rack && u2.rack === u3.rack && u1.u - u2.u === 1 && u2.u - u3.u === 1, `${u1.u},${u2.u},${u3.u}`);
  const rx = Math.min(...doc.racks.map((r) => r.x));
  t("off-rack items left of the racks", doc.devices.filter((d) => d.rack == null).every((d) => d.fx + RW <= rx), `rack x ${rx}`);
  const mgrs = doc.devices.filter((d) => d.type === "Cable manager");
  t("cable managers added", mgrs.length > 0 && res.managers === mgrs.length, `${mgrs.length}`);
  t("manager below the stack", mgrs.some((m) => m.rack === u3.rack && m.u === u3.u - 1));
  const land = (name: string, port: string) => { const pt = dn(name).ports.find((x) => x.name === port); return !!pt && doc.cables.some((c) => (c.a === pt.id || c.b === pt.id)); };
  const cableTo = (name: string, port: string) => {
    const pt = dn(name).ports.find((x) => x.name === port)!;
    const c = doc.cables.find((k) => k.a === pt.id || k.b === pt.id);
    return c ? portOf(doc, c.a === pt.id ? c.b : c.a)!.d : null;
  };
  t("GigabitEthernet3/1/22 lands on unit 3 port 22", land("EX-SW-STACK unit 3", "22") && cableTo("EX-SW-STACK unit 3", "22")?.name === "Endpoints on EX-SW-STACK unit 3");
  t("unit 2 port 30 uses a 48-port model", u2.ports.filter((x) => x.type === "RJ45").length >= 48 && land("EX-SW-STACK unit 2", "30"));
  t("firewall appears once", doc.devices.filter((d) => d.name === "EX-FW").length === 1);
  const g02 = dn("Endpoints on EX-SW-02");
  t("endpoint group sizes", g02.endpoints!.length === 7 && dn("Endpoints on EX-SW-STACK unit 3").endpoints!.length === 1 && dn("Endpoints on EX-SW-STACK unit 1").endpoints!.length === 2, g02.endpoints!.length + "");
  t("group summary label", /^7 devices \(/.test(g02.model || "") && /phones/.test(g02.model || ""), g02.model);
  t("group is off-rack with a port per endpoint", g02.rack == null && g02.ports.length === 7 && g02.type === "Endpoints");
  t("unplaced list", plan.unplaced.some((u) => u.name === "Orphan Laptop") && plan.unplaced.some((u) => u.name === "Wifi Laptop") && doc.auvik!.unplaced.length === plan.unplaced.length, plan.unplaced.map((u) => u.name).join());
  t("virtual listed, not drawn", plan.virtual.includes("EX-SZ") && !doc.devices.some((d) => d.name === "EX-SZ"));
  const ups = dn("EX-UPS");
  t("UPS at the bottom", ups.rack != null && ups.u === 1, "u=" + ups.u);
  t("network core above servers", dn("EX-CORE").u > dn("EX-ESX1").u && dn("EX-FW").u > dn("EX-CORE").u, `fw ${dn("EX-FW").u} core ${dn("EX-CORE").u} esx ${dn("EX-ESX1").u}`);
  t("desktop firewall gets a 1U mount kit by default", dn("EX-FW").rack != null && dn("EX-FW").u_size === 1 && !dn("EX-FW").half && !doc.devices.some((d) => d.type === "Shelf") && /mount kit/i.test(items.find((i) => i.dev.name === "EX-FW")!.kitName));
  t("VM listed in a VM box", doc.devices.some((d) => d.type === "Virtual machines" && d.endpoints!.some((e) => e.name === "EX-VM1")) && plan.vmBoxes.length === 1);
  t("AP off-rack", dn("EX-AP1").rack == null);
  t("iDRAC becomes the host's port, not a box", !doc.devices.some((d) => d.name === "EX-ESX1-iDRAC") && dn("EX-ESX1").oobm?.name === "EX-ESX1-iDRAC" && cableTo("EX-ESX1", "iDRAC")?.name === "EX-SW-02");
  const pairOf = (c: { a: number; b: number }) => { const a = portOf(doc, c.a)!.d, b = portOf(doc, c.b)!.d; return { a, b, k: a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}` }; };
  const plain = doc.cables.map(pairOf).filter((x) => x.a.type !== "Endpoints" && x.b.type !== "Endpoints" && x.a.name !== "EX-ESX1" && x.b.name !== "EX-ESX1");
  const portsUsed = doc.cables.flatMap((c) => [c.a, c.b]);
  t("no duplicate cables", new Set(portsUsed).size === portsUsed.length && new Set(plain.map((x) => x.k)).size === plain.length);
  t("both-sides link gives one UPS cable", doc.cables.filter((c) => { const a = portOf(doc, c.a)!.d.name, b = portOf(doc, c.b)!.d.name; return (a === "EX-UPS" && b === "EX-CORE") || (b === "EX-UPS" && a === "EX-CORE"); }).length === 1);
  t("cable label + type", doc.cables.some((c) => c.label === "EX-SW-STACK unit 3 GigabitEthernet3/1/22" && c.type === "Cat6"));
  t("uplink slot lands on SFP+", land("EX-SW-STACK unit 1", "SFP+1"));
  t("imported fields", dn("EX-SRV2").ip === "10.99.1.200" && dn("EX-CORE").serial === "COREser" && !!dn("EX-CORE").auvik_id && /Auvik:/.test(dn("EX-CORE").notes || ""));
  t("racks added", res.racksAdded >= 1 && doc.racks.length === res.racksAdded);

  // re-import: one IP changed, EX-AP2 removed, EX-SRV3 new
  const before = clone(doc);
  const posBefore = new Map(before.devices.map((d) => [d.id, `${d.rack}/${d.u}/${d.side}/${d.fx}/${d.fy}`]));
  const p2 = await load(devices([{ name: "EX-SRV3", type: "Server", model: "Generic server", conn: "EX-SW-02 through 16" }], ["EX-AP2"], { "EX-SRV2": "10.99.1.201" }));
  const it2 = buildItems(p2);
  t("removed device flagged missing", findMissing(doc, it2).map((d) => d.name).join() === "EX-AP2", findMissing(doc, it2).map((d) => d.name).join());
  const r2 = run(doc, p2, { target: "current", rackId: doc.racks[0].id });
  t("IP updated", dn("EX-SRV2").ip === "10.99.1.201");
  t("new device added", doc.devices.filter((d) => d.name === "EX-SRV3").length === 1 && r2.res.added === 1, `added ${r2.res.added}`);
  t("positions kept", [...posBefore].every(([n, pos]) => { const d = doc.devices.find((x) => x.id === n)!; return `${d.rack}/${d.u}/${d.side}/${d.fx}/${d.fy}` === pos; }));
  t("removed device not deleted", doc.devices.some((d) => d.name === "EX-AP2") && r2.res.missing.join() === "EX-AP2");
  t("one new cable only", doc.cables.length === before.cables.length + 1, `${before.cables.length} -> ${doc.cables.length}`);
  const ports2 = doc.cables.flatMap((c) => [c.a, c.b]);
  t("still no duplicate ports", new Set(ports2).size === ports2.length);
  t("group rebuilt in place", doc.devices.filter((d) => d.name === "Endpoints on EX-SW-02").length === 1 && dn("Endpoints on EX-SW-02").endpoints!.length === 7 && dn("Endpoints on EX-SW-02").id === g02.id);
  t("device count", doc.devices.length === before.devices.length + 1, `${before.devices.length} -> ${doc.devices.length}`);


  // ---------------------------------------------------------------- v2: dual links, kinds, VM hosts, type override, mount kit
  const fx2 = (extra: D[] = [], drop: string[] = []): D[] => [
    { name: "EX2-FW", type: "Firewall", model: "SonicWALL TZ 570", serial: "FW2SER", conn: "EX2-SW through GigabitEthernet1/1/1" },
    { name: "EX2-SW", type: "Layer 3 Switch", model: "Brocade ICX7250-48-HPOE", serial: "SW2SER", conn: "EX2-FW through X1, EX2-HV1 through eth0, EX2-HV1 through eth1" },
    { name: "EX2-HV1", type: "Hypervisor", model: "Pegatron Linux", desc: "Linux hc-node-1 4.19 .sc00", conn: "EX2-SW through 2.5GigabitEthernet1/1/7, EX2-SW through 2.5GigabitEthernet1/1/10" },
    { name: "EX2-HV2", type: "Hypervisor", model: "Microsoft Hyper-V", conn: "EX2-SW through GigabitEthernet1/1/11" },
    { name: "EX2-ESX", type: "Server", model: "VMware ESXi host", conn: "EX2-SW through GigabitEthernet1/1/12" },
    { name: "VM-S1", type: "Virtual Machine", model: "Scale Computing" },
    { name: "VM-H1", type: "Virtual Machine", model: "Microsoft Hyper-V" },
    { name: "VM-V1", type: "Virtual Machine", model: "VMware Virtual Machine" },
    { name: "VM-X", type: "Virtual Machine", model: "Mitel 3300 MAS" },
    { name: "Ph-1", type: "IP Phone", conn: "EX2-SW through GigabitEthernet1/1/20" },
    { name: "Tel-1", type: "Telecommunications Device", conn: "EX2-SW through GigabitEthernet1/1/24" },
    { name: "Cam-D", type: "Generic Device", model: "Dahua IPC", conn: "EX2-SW through GigabitEthernet1/1/21" },
    { name: "Gen-Pi", type: "Generic Device", model: "Raspberry Pi Foundation", conn: "EX2-SW through GigabitEthernet1/1/23" },
    { name: "Gen-Plain", type: "Generic Device", model: "", conn: "EX2-SW through GigabitEthernet1/1/25" },
    { name: "PC-X", type: "Workstation", conn: "EX2-SW through GigabitEthernet1/1/22" },
    ...extra,
  ].filter((d) => !drop.includes(d.name));
  const q = await load(fx2());
  const qi = buildItems(q);
  const qm = (n: string) => qi.find((i) => i.dev.name === n)!;
  t("hypervisor is a server in the rack", qm("EX2-HV1").kind === "server" && qm("EX2-HV1").mode === "rack");
  t("VM default mode is Virtual machine", ["VM-S1", "VM-H1", "VM-V1", "VM-X"].every((n) => qm(n).mode === "vm"));
  t("phone / IoT default modes", qm("Ph-1").mode === "phone" && qm("Tel-1").mode === "phone" && qm("Cam-D").mode === "iot" && qm("Gen-Pi").mode === "iot" && qm("Gen-Plain").mode === "endpoint" && qm("PC-X").mode === "endpoint");
  t("kind inference", inferKind("Workstation") === "pc" && inferKind("Printer") === "printer" && inferKind("Generic Device", "Espressif Inc.") === "iot" && inferKind("Unknown") === "other" && inferKind("Generic Device", "Grandstream") === "phone");
  t("VM host guess by vendor", qm("VM-S1").host === qm("EX2-HV1").key && qm("VM-H1").host === qm("EX2-HV2").key && qm("VM-V1").host === qm("EX2-ESX").key && qm("VM-X").host === "",
    qi.filter((i) => i.mode === "vm").map((i) => `${i.dev.name}=${i.host}`).join());
  t("desktop firewall defaults to the mount kit", qm("EX2-FW").desktop && qm("EX2-FW").mount === "kit" && /rack mount kit/i.test(qm("EX2-FW").kitName), qm("EX2-FW").kitName);
  t("summary uses kinds", summarize(["phone", "phone", "pc", "iot"]) === "4 devices (2 phones, 1 PC, 1 IoT device)", summarize(["phone", "phone", "pc", "iot"]));

  const d2 = empty();
  const r2a = run(d2, q, { target: "new" });
  const n2 = (n: string) => d2.devices.find((d) => d.name === n)!;
  const links = (a: string, b: string) => d2.cables.filter((c) => { const x = portOf(d2, c.a)!.d.name, y = portOf(d2, c.b)!.d.name; return (x === a && y === b) || (x === b && y === a); });
  const hvLinks = links("EX2-HV1", "EX2-SW");
  t("both links of a dual-homed server get cables", hvLinks.length === 2, `${hvLinks.length}`);
  const swPorts = hvLinks.map((c) => { const a = portOf(d2, c.a)!, b = portOf(d2, c.b)!; return (a.d.name === "EX2-SW" ? a : b).p.name; }).sort();
  const hvPorts = hvLinks.map((c) => { const a = portOf(d2, c.a)!, b = portOf(d2, c.b)!; return (a.d.name === "EX2-HV1" ? a : b).p.id; });
  t("each link uses its own switch port and its own server port", swPorts.join() === "SFP+1,SFP+2" || swPorts.join() === "10,7", swPorts.join());
  t("server ports differ", new Set(hvPorts).size === 2);
  const allPorts2 = d2.cables.flatMap((c) => [c.a, c.b]);
  t("no port is cabled twice", new Set(allPorts2).size === allPorts2.length);
  t("mount kit: firewall is 1U in the rack with X1 on the front ports", n2("EX2-FW").rack != null && n2("EX2-FW").u_size === 1 && !d2.devices.some((d) => d.type === "Shelf") &&
    n2("EX2-FW").ports.some((x) => x.name === "X1") && links("EX2-FW", "EX2-SW").length === 1 && (() => { const c = links("EX2-FW", "EX2-SW")[0]; const a = portOf(d2, c.a)!, b = portOf(d2, c.b)!; return (a.d.name === "EX2-FW" ? a : b).p.name === "X1"; })());
  t("mount kit has no leftover shelf port clash", !n2("EX2-FW").plate?.off);

  const hv1 = n2("EX2-HV1"), vms = d2.devices.filter((d) => d.type === "Virtual machines");
  const boxS = d2.devices.find((d) => d.name === "VMs on EX2-HV1")!;
  const boxN = d2.devices.find((d) => d.name === "VMs (no host)")!;
  t("VM boxes: one per host plus no-host box", vms.length === 4 && !!boxS && !!boxN, vms.map((d) => d.name).join());
  t("VM box points at its host", boxS.vm_host === hv1.id && boxS.auvik_id === `vm:${qm("EX2-HV1").key}` && boxN.vm_host === undefined && boxN.auvik_id === "vm:none");
  t("VM box content", boxS.endpoints!.length === 1 && boxS.endpoints![0].kind === "vm" && boxS.endpoints![0].name === "VM-S1" && boxN.endpoints![0].name === "VM-X" && boxS.ports.length === 0 && boxS.rack == null);
  t("VM boxes are laid out off-rack, left of the racks", vms.every((d) => d.fx + RW <= Math.min(...d2.racks.map((r) => r.x))));
  const g2 = d2.devices.find((d) => d.name === "Endpoints on EX2-SW")!;
  const kc = (k: string) => g2.endpoints!.filter((e) => e.kind === k).length;
  t("endpoint kinds recorded", kc("phone") === 2 && kc("iot") === 2 && kc("pc") === 1 && kc("other") === 1, g2.endpoints!.map((e) => e.kind).join());
  t("group summary from kinds", /2 phones/.test(g2.model || "") && /2 IoT devices/.test(g2.model || "") && /1 PC/.test(g2.model || ""), g2.model);

  // re-import: same cables, VM box rebuilt in place with the changed VM list
  const idBefore = boxS.id, cablesBefore = d2.cables.length, devsBefore = d2.devices.length;
  const q2 = await load(fx2([{ name: "VM-S2", type: "Virtual Machine", model: "Scale Computing" }], ["VM-S1"]));
  run(d2, q2, { target: "current", rackId: d2.racks[0].id });
  const boxS2 = d2.devices.find((d) => d.name === "VMs on EX2-HV1")!;
  t("re-import adds no cables for dual links", d2.cables.length === cablesBefore && links("EX2-HV1", "EX2-SW").length === 2, `${cablesBefore} -> ${d2.cables.length}`);
  t("re-import rebuilds the VM box in place and keeps the VM that left the export", boxS2.id === idBefore && boxS2.endpoints!.map((e) => e.name).join() === "VM-S2,VM-S1" && boxS2.vm_host === n2("EX2-HV1").id, boxS2.endpoints!.map((e) => e.name).join());
  t("re-import adds no devices", d2.devices.length === devsBefore, `${devsBefore} -> ${d2.devices.length}`);
  t("re-import keeps server ports", n2("EX2-HV1").ports.length === hv1.ports.length);

  // user choices: Include as, Host, Type, Mount
  let ui = setMode(qi, "Gen-Plain" && qm("Gen-Plain").key, "phone");
  t("Include as Phone", ui.find((i) => i.dev.name === "Gen-Plain")!.mode === "phone");
  ui = setMode(ui, qm("PC-X").key, "vm");
  t("switching to Virtual machine guesses no host for a plain row", ui.find((i) => i.dev.name === "PC-X")!.host === "");
  const asPrinter = retype(q, qi, qm("PC-X").key, "Printer");
  const pp = resolvePlan(q, asPrinter);
  t("Type override re-classifies the row", asPrinter.find((i) => i.dev.name === "PC-X")!.type === "Printer" && pp.groups[0].members.find((m) => m.name === "PC-X")!.kind === "printer");
  const asVm = retype(q, qi, qm("Gen-Plain").key, "Virtual Machine");
  t("Type override to Virtual Machine switches to VM mode with a host guess", asVm.find((i) => i.dev.name === "Gen-Plain")!.kind === "vm" && asVm.find((i) => i.dev.name === "Gen-Plain")!.mode === "vm" && asVm.find((i) => i.dev.name === "Gen-Plain")!.host === "");
  const asSw = retype(q, qi, qm("EX2-ESX").key, "Switch");
  t("Type override changes the template match", asSw.find((i) => i.dev.name === "EX2-ESX")!.kind === "switch" && asSw.find((i) => i.dev.name === "EX2-ESX")!.tplName !== qm("EX2-ESX").tplName && asSw.find((i) => i.dev.name === "VM-V1")!.host === "");
  t("edits on other rows survive a Type change", retype(q, setMode(qi, qm("Cam-D").key, "skip"), qm("PC-X").key, "Printer").find((i) => i.dev.name === "Cam-D")!.mode === "skip");

  const d3 = empty();
  const shelfItems = qi.map((i) => (i.dev.name === "EX2-FW" ? { ...i, mount: "shelf" as const } : i));
  const plan3 = resolvePlan(q, shelfItems);
  applyInPlace(d3, plan3, { target: "new" }, shelfItems);
  const fw3 = d3.devices.find((d) => d.name === "EX2-FW")!;
  t("Mount = Shelf keeps the shelf path", d3.devices.some((d) => d.type === "Shelf" && d.rack === fw3.rack) && !!fw3.plate?.off);
  t("host changed by the user is used", (() => {
    const it = qi.map((i) => (i.dev.name === "VM-S1" ? { ...i, host: qm("EX2-ESX").key } : i));
    return resolvePlan(q, it).vmBoxes.some((b) => b.name === "VMs on EX2-ESX" && b.members.some((m) => m.name === "VM-S1"));
  })());

  // ---------------------------------------------------------------- v3: re-import review (diff) and OOBM on the host
  t("stripOobm", stripOobm("Host1-iDrac") === "Host1" && stripOobm("esxi9-idrac") === "esxi9" && stripOobm("idrac-esxi4") === "esxi4" && stripOobm("Node7-ILO") === "Node7" && stripOobm("plain") === "plain");

  const fx3 = (o: { pc1?: string; pc3?: string; srvPort?: string; srvIp?: string; noUplink?: boolean; noPhone?: boolean; extra?: D[]; idracOn?: string } = {}): D[] => [
    { name: "EX3-SWA", type: "Layer 3 Switch", model: "Brocade ICX7250-48-HPOE", serial: "SWAser", conn: o.noUplink ? "0" : "EX3-SWB through GigabitEthernet1/1/48" },
    { name: "EX3-SWB", type: "Layer 3 Switch", model: "Brocade ICX7250-48-HPOE", serial: "SWBser", conn: o.noUplink ? "0" : "EX3-SWA through GigabitEthernet1/1/47" },
    { name: "Host1", type: "Server", model: "Dell PowerEdge R640", serial: "PXser", ip: "10.99.3.10", conn: `EX3-SWA through GigabitEthernet1/1/${o.srvPort ?? "10"}` },
    { name: "Host1-iDrac", type: "Intelligent Platform Management Interface", model: "Dell iDRAC9", ip: "10.99.3.110", conn: `EX3-SWA through GigabitEthernet1/1/${o.idracOn ?? "11"}` },
    { name: "Lonely-bmc", type: "Intelligent Platform Management Interface", model: "Supermicro BMC", ip: "10.99.3.120", conn: "EX3-SWB through GigabitEthernet1/1/12" },
    { name: "PC-1", type: "Workstation", conn: `EX3-SWA through GigabitEthernet1/1/${o.pc1 ?? "5"}` },
    { name: "PC-2", type: "Workstation", conn: "EX3-SWA through GigabitEthernet1/1/6" },
    ...(o.noPhone ? [] : [{ name: "Phone-1", type: "IP Phone", conn: "EX3-SWA through GigabitEthernet1/1/7" } as D]),
    { name: "PC-3", type: "Workstation", conn: o.pc3 ?? "EX3-SWB through GigabitEthernet1/1/5" },
    { name: "PC-5", type: "Workstation", conn: "EX3-SWB through GigabitEthernet1/1/6" },
    ...(o.extra ?? []),
  ].map((d) => ({ ...d, ip: d.name === "Host1" && o.srvIp ? o.srvIp : (d as D).ip }));
  const idsOf = (ds: ReturnType<typeof computeDiff>) => ds.changes.map((c) => c.id);

  // guess + first import
  const p3 = await load(fx3());
  const it3 = buildItems(p3, { servers: [] });
  const idr = it3.find((i) => i.dev.name === "Host1-iDrac")!, lone = it3.find((i) => i.dev.name === "Lonely-bmc")!, px = it3.find((i) => i.dev.name === "Host1")!;
  t("OOBM host guessed by name", idr.host === px.key && lone.host === "new", `${idr.host} / ${lone.host}`);
  t("OOBM host guessed by serial", guessOobmHost({ key: "k", dev: { ...idr.dev, name: "Mgmt-A", serial: "PXser" } }, it3.filter((i) => i.kind === "server")) === px.key);
  t("OOBM host picks a server already in the document", guessOobmHost(lone, [], { servers: [{ id: 7, name: "lonely", serial: "" }] }) === "doc:7");
  const e3 = empty();
  run(e3, p3, { target: "new" });
  const m3 = (n: string) => e3.devices.find((d) => d.name === n)!;
  const pid3 = m3("Host1").ports.find((x) => x.name === "iDRAC")!;
  const cableAt = (doc: Doc, pid: number) => doc.cables.find((c) => c.a === pid || c.b === pid);
  t("OOBM: port on the host, cabled to the switch", !!pid3 && !!cableAt(e3, pid3.id) && portOf(e3, cableAt(e3, pid3.id)!.a === pid3.id ? cableAt(e3, pid3.id)!.b : cableAt(e3, pid3.id)!.a)!.d.name === "EX3-SWA" && cableAt(e3, pid3.id)!.label === "EX3-SWA GigabitEthernet1/1/11");
  t("OOBM: host keeps its details", m3("Host1").oobm?.name === "Host1-iDrac" && m3("Host1").oobm?.ip === "10.99.3.110" && /OOBM: iDRAC Host1-iDrac; IP 10.99.3.110/.test(m3("Host1").notes || "") && m3("Host1").oobm?.portId === pid3.id);
  t("OOBM: no off-rack box and no stray iDRAC port", !e3.devices.some((d) => d.name === "Host1-iDrac") && m3("Host1").ports.filter((x) => /idrac/i.test(x.name)).length === 1);
  const ph = m3("Lonely");
  t("OOBM: placeholder server in the rack", ph.rack != null && ph.u_size === 2 && ph.type === "Server" && /Placeholder: created for Lonely-bmc/.test(ph.notes || "") && !ph.auvik_id && ph.oobm?.key === lone.key);
  t("OOBM: placeholder port is cabled to its switch", (() => { const pt = ph.ports.find((x) => x.id === ph.oobm!.portId)!; const c = cableAt(e3, pt.id); return !!c && portOf(e3, c.a === pt.id ? c.b : c.a)!.d.name === "EX3-SWB"; })());
  t("OOBM: the rear port lives in the host's port list next to the NICs", (() => { const i = ph.ports.findIndex((x) => x.id === ph.oobm!.portId); return i > 0 && ph.ports[i - 1].name.startsWith("NIC") || /idrac/i.test(ph.ports[i].name); })());

  // re-import of the same export: nothing to do, nothing duplicated
  const sameDevs = e3.devices.length, sameCables = e3.cables.length, samePorts = e3.devices.reduce((n, d) => n + d.ports.length, 0);
  const rs = run(e3, p3, { target: "current", rackId: e3.racks[0].id });
  t("re-import of the same export has no changes", rs.diff.changes.length === 0, idsOf(rs.diff).join());
  t("re-import: no duplicate placeholder, port or cable", e3.devices.length === sameDevs && e3.cables.length === sameCables && e3.devices.reduce((n, d) => n + d.ports.length, 0) === samePorts, `${sameDevs}/${sameCables}/${samePorts} -> ${e3.devices.length}/${e3.cables.length}`);
  t("re-import: OOBM controller found again through the host", rs.items.find((i) => i.dev.name === "Lonely-bmc")!.host === `doc:${ph.id}` && rs.items.find((i) => i.dev.name === "Host1-iDrac")!.host === px.key);

  // the user edits the rack by hand
  const swA = m3("EX3-SWA");
  const gA = () => e3.devices.find((d) => d.name === "Endpoints on EX3-SWA")!;
  const gB = () => e3.devices.find((d) => d.name === "Endpoints on EX3-SWB")!;
  t("endpoint members carry a stable key", gA().endpoints!.every((e) => !!e.key));
  m3("Host1").ip = "10.99.3.77"; m3("Host1").locked = ["ip"];
  const pc2 = gA().endpoints!.find((e) => e.name === "PC-2")!;
  pc2.name = "Reception PC"; pc2.locked = ["name"]; gA().ports[gA().endpoints!.indexOf(pc2)].name = "Reception PC";
  { // a member added by hand, with its own cable to a free switch port
    const g = gA(), pt = { id: nid(e3), name: "Hand PC", type: "RJ45", label: "20" };
    g.endpoints!.push({ name: "Hand PC", type: "", model: "", ip: "", mac: "", port: "20", status: "", kind: "pc", manual: true });
    g.ports.push(pt);
    newCable(e3, swA.ports.find((x) => x.name === "20")!.id, pt.id);
  }
  { // a device and a cable drawn by hand on a switch port
    const h = fromTpl(e3, CATALOG.find((c) => c.name === "Server 1U")!); h.name = "Hand NAS"; h.rack = null; e3.devices.push(h);
    newCable(e3, swA.ports.find((x) => x.name === "30")!.id, h.ports[0].id);
  }
  const handCables = e3.cables.length;

  // Auvik now says: Host1 ip changed, PC-1 on port 8, PC-3 on SWA 9, Host1 on port 12, uplink gone, Phone-1 gone, PC-4 new
  const p4 = await load(fx3({ pc1: "8", pc3: "EX3-SWA through GigabitEthernet1/1/9", srvPort: "12", srvIp: "10.99.3.88", noUplink: true, noPhone: true, extra: [{ name: "PC-4", type: "Workstation", conn: "EX3-SWA through GigabitEthernet1/1/13" }] }));
  const k3 = (n: string) => it3.find((i) => i.dev.name === n)!.key;
  const before4 = clone(e3);
  const items4 = buildItems(p4, hostCtxOf(e3));
  const plan4 = resolvePlan(p4, items4);
  const df = computeDiff(e3, plan4, items4);
  const ch = (id: string) => df.changes.find((c) => c.id === id);
  const idOf = (pre: string, title: string) => df.changes.find((c) => c.id.startsWith(pre) && c.title === title);
  t("diff: new member", !!ch(`newm:g:${k3("EX3-SWA")}|${p4.devices.length ? items4.find((i) => i.dev.name === "PC-4")!.key : ""}`) && ch(`newm:g:${k3("EX3-SWA")}|${items4.find((i) => i.dev.name === "PC-4")!.key}`)!.defaultOn);
  t("diff: changed IP is ticked unless locked, locked one is kept and unticked", (() => { const c = ch(`fld:${k3("Host1")}:ip`); return !!c && !!c.locked && !c.defaultOn && c.to === "10.99.3.88" && c.from === "10.99.3.77"; })());
  t("diff: member port moved within a switch", (() => { const c = df.changes.find((x) => x.cat === "moved" && x.title === "PC-1"); return !!c && c.defaultOn && /5/.test(c.from!) && /8/.test(c.to!); })());
  t("diff: member moved to another switch", (() => { const c = df.changes.find((x) => x.cat === "moved" && x.title === "PC-3"); return !!c && /EX3-SWB/.test(c.from!) && /EX3-SWA/.test(c.to!) && /moves to Endpoints on EX3-SWA/.test(c.detail || ""); })());
  t("diff: server on another port is a move", (() => { const c = df.changes.find((x) => x.cat === "moved" && x.title === "Host1"); return !!c && /10/.test(c.from!) && /12/.test(c.to!); })());
  t("diff: gone cable is unticked", (() => { const c = df.changes.find((x) => x.cat === "gone"); return !!c && !c.defaultOn && /EX3-SWA/.test(c.title) && /EX3-SWB/.test(c.title); })());
  t("diff: only the uplink is gone; hand-made and manual cables are not listed", df.changes.filter((x) => x.cat === "gone").length === 1);
  t("diff: member missing from the export is unticked, manual member is not listed", df.changes.some((x) => x.cat === "missingMember" && x.title === "Phone-1" && !x.defaultOn) && !df.changes.some((x) => x.title === "Hand PC"));
  t("diff: locked member name is shown as kept, unticked", df.changes.some((x) => x.id.startsWith("fldm:") && x.detail === "name" && x.locked === true && !x.defaultOn && x.from === "Reception PC" && x.to === "PC-2"));
  void idOf;

  // apply only what is ticked: nothing ticked changes nothing
  const dn0 = clone(e3);
  applyInPlace(dn0, plan4, { target: "current", rackId: dn0.racks[0].id }, items4, new Set());
  t("apply with nothing ticked keeps cables, devices and values", dn0.cables.length === before4.cables.length && dn0.devices.length === before4.devices.length && dn0.devices.find((d) => d.name === "Host1")!.ip === "10.99.3.77" &&
    !dn0.devices.some((d) => d.name === "Endpoints on EX3-SWA" && d.endpoints!.some((e) => e.name === "PC-4")));

  // apply the defaults
  applyInPlace(e3, plan4, { target: "current", rackId: e3.racks[0].id }, items4);
  const pt = (d: Device, name: string) => d.ports.find((x) => x.name === name)!;
  const otherEnd = (pid: number) => { const c = cableAt(e3, pid)!; return portOf(e3, c.a === pid ? c.b : c.a)!; };
  const swAn = m3("EX3-SWA"), swBn = m3("EX3-SWB");
  const memberOnPort = (g: Device, name: string) => g.ports[g.endpoints!.findIndex((e) => e.name === name)];
  t("apply: locked IP kept, no lock lost", m3("Host1").ip === "10.99.3.77" && m3("Host1").locked?.join() === "ip");
  t("apply: PC-1 cable moved to port 8 on the same port object", (() => { const pp = memberOnPort(gA(), "PC-1"); const c = cableAt(e3, pp.id); return !!c && portOf(e3, c.a === pp.id ? c.b : c.a)!.p.name === "8" && !cableAt(e3, pt(swAn, "5").id); })());
  t("apply: PC-3 now in the SWA group with a cable on port 9, SWB group has no PC-3", (() => { const pp = memberOnPort(gA(), "PC-3"); return !!pp && !!cableAt(e3, pp.id) && portOf(e3, otherEnd(pp.id).p.id) !== null && otherEnd(pp.id).p.name === "9" && otherEnd(pp.id).d.id === swAn.id && !gB().endpoints!.some((e) => e.name === "PC-3"); })());
  t("apply: moved cable keeps its colour and type", (() => { const pp = memberOnPort(gA(), "PC-3"); return cableAt(e3, pp.id)!.type === "Cat6"; })());
  t("apply: server cable moved to port 12", otherEnd(pt(m3("Host1"), "NIC1").id).p.name === "12" || e3.cables.some((c) => { const a = portOf(e3, c.a)!, b = portOf(e3, c.b)!; return (a.d.name === "Host1" && b.p.name === "12" && b.d.id === swAn.id) || (b.d.name === "Host1" && a.p.name === "12" && a.d.id === swAn.id); }));
  t("apply: new member added", gA().endpoints!.some((e) => e.name === "PC-4" && !!e.key));
  t("apply: locked member name kept", gA().endpoints!.some((e) => e.name === "Reception PC" && e.locked?.join() === "name") && gA().endpoints!.length === gA().ports.length);
  t("apply: manual member and its cable kept", (() => { const pp = memberOnPort(gA(), "Hand PC"); return !!pp && otherEnd(pp.id).p.name === "20" && gA().endpoints!.find((e) => e.name === "Hand PC")!.manual === true; })());
  t("apply: hand-made device cable kept", e3.devices.some((d) => d.name === "Hand NAS") && otherEnd(m3("Hand NAS").ports[0].id).p.name === "30");
  t("apply: unticked gone cable still there, missing member kept", e3.cables.some((c) => { const a = portOf(e3, c.a)!, b = portOf(e3, c.b)!; return a.d.name.startsWith("EX3-SW") && b.d.name.startsWith("EX3-SW"); }) && gA().endpoints!.some((e) => e.name === "Phone-1"));
  t("apply: unchanged members keep their port ids", (() => { const old = before4.devices.find((d) => d.name === "Endpoints on EX3-SWA")!; const o = old.ports[old.endpoints!.findIndex((e) => e.name === "PC-2" || e.name === "Reception PC")].id; return memberOnPort(gA(), "Reception PC").id === o; })());
  t("apply: cable count = before + new member + 0 net moves", e3.cables.length === handCables + 1 - 0 + 0 && true, `${handCables} -> ${e3.cables.length}`);

  // now tick the rest: gone cable, missing member, locked IP
  const p5 = p4, items5 = buildItems(p5, hostCtxOf(e3)), plan5 = resolvePlan(p5, items5);
  const df5 = computeDiff(e3, plan5, items5);
  const sel5 = new Set(df5.changes.filter((c) => c.cat === "gone" || c.cat === "missingMember" || c.id === `fld:${k3("Host1")}:ip`).map((c) => c.id));
  t("second diff lists only what was left", df5.changes.length === 4 && sel5.size === 3 && df5.changes.every((c) => sel5.has(c.id) || c.detail === "name"), idsOf(df5).join());
  applyInPlace(e3, plan5, { target: "current", rackId: e3.racks[0].id }, items5, sel5);
  t("ticked: locked IP replaced and unlocked", m3("Host1").ip === "10.99.3.88" && !m3("Host1").locked);
  t("ticked: gone cable removed, missing member removed, manual member still there", !e3.cables.some((c) => { const a = portOf(e3, c.a)!, b = portOf(e3, c.b)!; return a.d.name.startsWith("EX3-SW") && b.d.name.startsWith("EX3-SW"); }) && !gA().endpoints!.some((e) => e.name === "Phone-1") && gA().endpoints!.some((e) => e.manual));
  t("ticked: hand-made device cable still there", otherEnd(m3("Hand NAS").ports[0].id).p.name === "30");
  { // tick the kept name: Auvik's value wins and the lock goes
    const nameId = df5.changes.find((c) => c.detail === "name")!.id;
    const pl = resolvePlan(p5, items5);
    applyInPlace(e3, pl, { target: "current", rackId: e3.racks[0].id }, items5, new Set([nameId]));
    const g = e3.devices.find((d) => d.name === "Endpoints on EX3-SWA")!;
    t("ticking a kept field takes the Auvik value and clears the lock", g.endpoints!.some((e) => e.name === "PC-2" && !e.locked) && g.ports.some((x) => x.name === "PC-2"));
  }

  // the same flow through the plain default apply (no selection) is the "Apply" of the dialog with defaults
  const dflt = empty(); run(dflt, p3, { target: "new" });
  run(dflt, p4, { target: "current", rackId: dflt.racks[0].id });
  t("default apply on a fresh import moves and adds, removes nothing", dflt.devices.find((d) => d.name === "Endpoints on EX3-SWA")!.endpoints!.some((e) => e.name === "PC-4") && dflt.devices.some((d) => d.name === "Endpoints on EX3-SWA" && d.endpoints!.some((e) => e.name === "Phone-1")));

  const small = empty();
  run(small, p, { target: "new", rackU: 12 });
  t("overflow adds racks", small.racks.length > 1, small.racks.length + " racks");

  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
