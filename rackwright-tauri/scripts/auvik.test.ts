// Auvik import tests. All data is synthetic ("Example Co"); no real customer export is read.
import JSZip from "jszip";
import { readXlsx, colIndex } from "../src/auvik/xlsx";
import { parseAuvik, parseConnected } from "../src/auvik/parse";
import { buildItems, resolvePlan, parsePort, classify } from "../src/auvik/plan";
import { applyInPlace, findMissing } from "../src/auvik/apply";
import { Doc, RW } from "../src/types";
import { portOf, clone } from "../src/edit";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

// ---------------------------------------------------------------- fixture
const HEAD = ["Organization Name", "Domain Prefix", "Status", "Device Name", "Type", "Make & Model", "MAC Address(es)", "IP Address(es)", "Network(s)", "Connected To", "Software Version", "Serial Number", "Firmware Version", "Description"];
const stable = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const seen = new Map<string, number>();
const mac = (name = "") => { const n = (seen.get(name) || 0) + 1; seen.set(name, n); const h = stable(name + n); return `02:00:5E:${(h >> 16 & 255).toString(16).padStart(2, "0")}:${(h >> 8 & 255).toString(16).padStart(2, "0")}:${(h & 255).toString(16).padStart(2, "0")}`.toUpperCase(); };
const ipFor = (name: string) => `10.99.${stable(name) % 200 + 1}.${stable(name + "x") % 200 + 10}`;
interface D { name: string; type: string; model?: string; conn?: string; status?: string; serial?: string; mac?: string; ip?: string }
const row = (d: D) => ["Example Co", "exampleco", d.status || "Up", d.name, d.type, d.model || "", d.mac ?? mac(d.name), d.ip ?? ipFor(d.name), "10.99.1.0/24", d.conn ?? "0", "1.0", d.serial ?? "", "2.0", ""];

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
const run = (doc: Doc, p: Awaited<ReturnType<typeof load>>, opt: Parameters<typeof applyInPlace>[2]) => {
  const items = buildItems(p);
  const plan = resolvePlan(p, items);
  return { plan, items, res: applyInPlace(doc, plan, opt, items) };
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
  t("unplaced list", plan.unplaced.some((u) => u.name === "Orphan Laptop") && plan.unplaced.some((u) => u.name === "EX-VM1") && plan.unplaced.some((u) => u.name === "Wifi Laptop") && doc.auvik!.unplaced.length === plan.unplaced.length, plan.unplaced.map((u) => u.name).join());
  t("virtual listed, not drawn", plan.virtual.includes("EX-SZ") && !doc.devices.some((d) => d.name === "EX-SZ"));
  const ups = dn("EX-UPS");
  t("UPS at the bottom", ups.rack != null && ups.u === 1, "u=" + ups.u);
  t("network core above servers", dn("EX-CORE").u > dn("EX-ESX1").u && dn("EX-FW").u > dn("EX-CORE").u, `fw ${dn("EX-FW").u} core ${dn("EX-CORE").u} esx ${dn("EX-ESX1").u}`);
  t("desktop firewall sits on a shelf", doc.devices.some((d) => d.type === "Shelf" && d.rack === dn("EX-FW").rack));
  t("AP and iDRAC off-rack", dn("EX-AP1").rack == null && dn("EX-ESX1-iDRAC").rack == null && cableTo("EX-ESX1-iDRAC", "Mgmt")?.name === "EX-SW-02");
  const pairs = doc.cables.map((c) => { const a = portOf(doc, c.a)!.d.id, b = portOf(doc, c.b)!.d.id; return a < b ? `${a}-${b}` : `${b}-${a}`; });
  const portsUsed = doc.cables.flatMap((c) => [c.a, c.b]);
  const grp = (id: number) => doc.devices.find((d) => d.id === id)!.type === "Endpoints";
  t("no duplicate cables", new Set(portsUsed).size === portsUsed.length && new Set(pairs.filter((_, i) => !grp(portOf(doc, doc.cables[i].a)!.d.id) && !grp(portOf(doc, doc.cables[i].b)!.d.id))).size === pairs.filter((_, i) => !grp(portOf(doc, doc.cables[i].a)!.d.id) && !grp(portOf(doc, doc.cables[i].b)!.d.id)).length);
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

  const small = empty();
  run(small, p, { target: "new", rackU: 12 });
  t("overflow adds racks", small.racks.length > 1, small.racks.length + " racks");

  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
