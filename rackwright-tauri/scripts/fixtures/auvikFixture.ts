// Synthetic Auvik export fixture shared by the Auvik tests ("Example Co"); no real data.
import JSZip from "jszip";
import type { Sheets } from "../../src/auvik/xlsx";

const HEAD = ["Organization Name", "Domain Prefix", "Status", "Device Name", "Type", "Make & Model", "MAC Address(es)", "IP Address(es)", "Network(s)", "Connected To", "Software Version", "Serial Number", "Firmware Version", "Description"];
const stable = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const seen = new Map<string, number>();
const mac = (name = "") => { const n = (seen.get(name) || 0) + 1; seen.set(name, n); const h = stable(name + n); return `02:00:5E:${(h >> 16 & 255).toString(16).padStart(2, "0")}:${(h >> 8 & 255).toString(16).padStart(2, "0")}:${(h & 255).toString(16).padStart(2, "0")}`.toUpperCase(); };
const ipFor = (name: string) => `10.99.${stable(name) % 200 + 1}.${stable(name + "x") % 200 + 10}`;
export interface D { name: string; type: string; model?: string; conn?: string; status?: string; serial?: string; mac?: string; ip?: string; desc?: string }
const row = (d: D) => ["Example Co", "exampleco", d.status || "Up", d.name, d.type, d.model || "", d.mac ?? mac(d.name), d.ip ?? ipFor(d.name), "10.99.1.0/24", d.conn ?? "0", "1.0", d.serial ?? "", "2.0", d.desc ?? ""];

export function devices(extra: D[] = [], drop: string[] = [], ipChange: Record<string, string> = {}): D[] {
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

const sheetDefs = (ds: D[]) => {
  seen.clear();
  return [
    { name: "Summary", rows: [["SUMMARY"], ["Metric", "Value"], ["Devices", String(ds.length)]], shared: false },
    { name: "Sites", rows: [["SITES"], ["Site Name"], ["Example Co Main"]], shared: false },
    { name: "Devices", rows: [["DEVICES"], HEAD, ...ds.map(row)], shared: true },
    { name: "Alerts", rows: [["ALERTS"], ["No data available."]], shared: false },
  ];
};
export const fixtureSheets = (extra: D[] = [], drop: string[] = [], ipChange: Record<string, string> = {}): Sheets =>
  sheetDefs(devices(extra, drop, ipChange)).map(({ name, rows }) => ({ name, rows }));

export async function makeXlsx(ds: D[]): Promise<Uint8Array> {
  const z = new JSZip();
  const strings: string[] = [];
  const si = (s: string) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colL = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheetXml = (rows: string[][], shared: boolean) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => v === "" ? "" :
      shared ? `<c r="${colL(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>` : `<c r="${colL(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("") + `</row>`).join("") + `</sheetData></worksheet>`;
  const sheets = sheetDefs(ds);
  sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.shared)));
  z.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  z.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  return z.generateAsync({ type: "uint8array" });
}
