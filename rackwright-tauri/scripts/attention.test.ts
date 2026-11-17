// npx tsx scripts/attention.test.ts — attention model (synthetic data only)
import { addYears, clientAlerts, countLevels, daysUntil, deviceAlerts, docAlerts, groupInfo, ipClashes, ipsOf, ipEntries, todayIso } from "../src/attention/model";
import type { Device, Doc } from "../src/types";
import type { ClientItem } from "../src/clients/store";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const TODAY = "2026-11-17";
let pid = 100;
const mk = (id: number, name: string, type: string, extra: Partial<Device> = {}, ports: string[] = []): Device => ({
  id, name, type, u_size: 1, rack: 1, u: id, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front", model: "",
  ports: ports.map((n) => ({ id: pid++, name: n, type: "Power", label: "" })), ...extra,
});
const mkDoc = (devices: Device[], rack: Partial<Doc["racks"][0]> = {}): Doc => ({
  v: 1, nid: 100, racks: [{ id: 1, name: "Rack A", u: 12, x: 0, y: 0, last_verified: "2026-10-01", ...rack }], devices, cables: [],
});

eq("days", daysUntil("2026-12-17", TODAY), 30);
eq("days past", daysUntil("2026-11-01", TODAY), -16);
eq("days none", daysUntil(undefined, TODAY), null);
eq("days bad", daysUntil("soon", TODAY), null);
eq("addYears", addYears("2023-11-01", 3), "2026-11-01");

// warranty
const w = (exp: string, status?: Device["status"]) => deviceAlerts(mkDoc([]), mk(1, "NAS-01", "NAS", { warranty_exp: exp, status }), TODAY).map((a) => [a.level, a.kind, a.msg]);
eq("warranty ended", w("2026-11-01"), [["critical", "warranty", "Warranty ended 2026-11-01"]]);
eq("warranty soon", w("2026-12-17"), [["warning", "warranty", "Warranty ends in 30 days"]]);
eq("warranty far", w("2027-03-01"), []);
eq("warranty planned", w("2026-11-01", "planned"), []);

// battery
const b = (d: string) => deviceAlerts(mkDoc([]), mk(1, "UPS-01", "UPS", { battery_date: d }), TODAY).map((a) => [a.level, a.kind, a.msg]);
eq("battery overdue", b("2023-11-01"), [["critical", "battery", "UPS battery replacement overdue (due 2026-11-01)"]]);
eq("battery soon", b("2023-12-17"), [["warning", "battery", "UPS battery due in 30 days"]]);
eq("battery fine", b("2025-01-01"), []);

// load
function loadDoc(w: number, extra: Partial<Device> = {}) {
  pid = 100;
  const ups = mk(1, "UPS-01", "UPS", { rated_w: 1000 }, ["Out1", "Out2"]);
  const srv = mk(2, "Server A", "Server", { power_w: w }, ["Inlet"]);
  const doc = mkDoc([ups, srv]);
  doc.cables.push({ id: 1, a: ups.ports[0].id, b: srv.ports[0].id, color: "#000", type: "Power" });
  if (extra.name) {
    const u = mk(3, "Unknown box", "Server", {}, ["Inlet"]);
    doc.devices.push(u);
    doc.cables.push({ id: 2, a: ups.ports[1].id, b: u.ports[0].id, color: "#000", type: "Power" });
  }
  return { doc, ups };
}
{ const { doc, ups } = loadDoc(900); eq("load warn", deviceAlerts(doc, ups, TODAY).map((a) => [a.level, a.msg]), [["warning", "Load 900 W is 90% of 1,000 W"]]); }
{ const { doc, ups } = loadDoc(1100); eq("load crit", deviceAlerts(doc, ups, TODAY).map((a) => [a.level, a.msg]), [["critical", "Load 1,100 W is 110% of 1,000 W"]]); }
{ const { doc, ups } = loadDoc(900, { name: "x" }); eq("load unknown", deviceAlerts(doc, ups, TODAY).map((a) => [a.level, a.msg]), [["warning", "Load at least 900 W is 90% of 1,000 W"]]); }
{ const { doc, ups } = loadDoc(500); eq("load fine", deviceAlerts(doc, ups, TODAY), []); }

// wording for today and one day
eq("warranty today", w("2026-11-17"), [["warning", "warranty", "Warranty ends today"]]);
eq("warranty 1 day", w("2026-11-18"), [["warning", "warranty", "Warranty ends in 1 day"]]);
eq("battery today", deviceAlerts(mkDoc([]), mk(1, "UPS-01", "UPS", { battery_date: "2023-11-17" }), TODAY).map((x) => x.msg), ["UPS battery due today"]);
eq("battery 1 day", deviceAlerts(mkDoc([]), mk(1, "UPS-01", "UPS", { battery_date: "2023-11-18" }), TODAY).map((x) => x.msg), ["UPS battery due in 1 day"]);
eq("todayIso", /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(todayIso()), true);
eq("ipsOf cidr", ipsOf(mk(1, "X", "NAS", { ip: "10.0.0.5/24, 10.0.0.6" })), ["10.0.0.5", "10.0.0.6"]);

// stale racks
const st = (rack: Partial<Doc["racks"][0]>, devs = [mk(1, "NAS-01", "NAS")]) => docAlerts("k", mkDoc(devs, rack), TODAY, new Map()).map((a) => [a.level, a.kind, a.msg, a.rackKey, a.rackId, a.rackName]);
eq("never", st({ last_verified: undefined }), [["info", "stale", "Never checked on site", "k", 1, "Rack A"]]);
eq("old", st({ last_verified: "2026-07-01" }), [["info", "stale", "Not checked on site since 2026-07-01", "k", 1, "Rack A"]]);
eq("recent", st({ last_verified: "2026-10-01" }), []);
eq("90 days", st({ last_verified: "2026-08-19" }), []);
eq("91 days", st({ last_verified: "2026-08-18" }).length, 1);
eq("empty rack", st({ last_verified: undefined }, []), []);

// ips
eq("ipsOf", ipsOf(mk(1, "X", "NAS", { ip: "10.0.0.5, 10.0.0.300; 127.0.0.1 10.0.0.255", oobm: { name: "", ip: "10.0.0.6", mac: "", key: "" } })), ["10.0.0.5", "10.0.0.6"]);
eq("ipsOf dup", ipsOf(mk(1, "X", "NAS", { ip: "10.0.0.5 10.0.0.5" })), ["10.0.0.5"]);
eq("ipsOf 0", ipsOf(mk(1, "X", "NAS", { ip: "0.0.0.0" })), []);
{
  const d = mk(1, "NAS-01", "NAS", { ip: "10.0.0.5", oobm: { name: "", ip: "10.0.0.5", mac: "", key: "" } });
  eq("self not clash", ipClashes(ipEntries("k", mkDoc([d]))).size, 0);
  eq("planned skipped", ipEntries("k", mkDoc([mk(1, "P", "NAS", { ip: "10.0.0.9", status: "planned" })])), []);
}

// client
const docA = mkDoc([mk(1, "NAS-01", "NAS", { ip: "10.0.0.5", warranty_exp: "2026-11-01" })]);
const docB = mkDoc([mk(1, "Printer", "Other", { ip: "10.0.0.5" })], { last_verified: undefined });
const client: ClientItem = {
  key: "c", name: "Example Client", notes: "", links: [],
  sites: [{ id: 1, name: "HQ", address: "", notes: "", racks: [{ key: "r1", name: "A" }, { key: "r2", name: "B" }, { key: "r3", name: "C" }] }],
};
const alerts = clientAlerts(client, { r1: docA, r2: docB, r3: "Could not read" }, TODAY);
eq("client order", alerts.map((a) => [a.level, a.msg]), [
  ["critical", "Warranty ended 2026-11-01"],
  ["warning", "IP 10.0.0.5 is also used by NAS-01"],
  ["warning", "IP 10.0.0.5 is also used by Printer"],
  ["info", "Never checked on site"],
]);
eq("ip alert fields", alerts[2].rackKey + "/" + alerts[2].devName + "/" + alerts[2].rackName + "/" + alerts[2].ip, "r1/NAS-01/Rack A/10.0.0.5");
eq("counts", countLevels(alerts), { critical: 1, warning: 2, info: 1 });
eq("groupInfo", (({ shown, staleRacks }) => [shown.length, staleRacks])(groupInfo(alerts)), [3, 1]);

if (fail) { console.log(`${fail} failed`); process.exit(1); } else console.log("attention: all passed");
