// npx tsx scripts/report.test.ts — report model (synthetic data only)
import { readFileSync } from "node:fs";
import { buildReportModel } from "../src/report/model";
import type { ClientItem } from "../src/clients/store";
import type { Doc } from "../src/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const doc: Doc = JSON.parse(readFileSync("../Homelab.rack.json", "utf8"));
const client: ClientItem = {
  key: "c1", name: "Example Client", notes: "",
  sites: [
    { id: 1, name: "Head Office", address: "1 Example St", notes: "", racks: [{ key: "r1", name: "MDF" }, { key: "r2", name: "Broken" }] },
    { id: 2, name: "Warehouse", address: "", notes: "", racks: [] },
  ],
  links: [
    { id: 1, site_a: 1, site_b: 2, kind: "VPN", provider: "Example IT", circuit: "C1", bandwidth: "100 Mbps", notes: "", a_end: null, b_end: null },
    { id: 2, site_a: 2, site_b: null, kind: "Internet", provider: "Example IT", circuit: "", bandwidth: "", notes: "", a_end: null, b_end: null },
  ],
};
const opts = { level: "detailed" as const, sites: "all" as const, summary: "S", recommendations: "R", date: "2026-11-17", prepared_for: "Example Client" };
const docs = { r1: doc, r2: "Could not open file" };
const m = buildReportModel({ client, docs, options: opts, company: "Example IT" });

eq("title", m.title, "Network review — Example Client");
eq("prepared by", m.preparedBy, "Example IT");
eq("totals sites", m.totals.sites, 2);
eq("totals racks", m.totals.racks, doc.racks.length);
eq("totals devices", m.totals.devices, doc.devices.length);
eq("byType sum", m.totals.byType.reduce((n, t) => n + t[1], 0), doc.devices.length);
eq("inventory", m.inventory.length, doc.devices.length);
eq("error rack", m.sites[0].racks[1], { key: "r2", name: "Broken", error: "Could not open file" });
eq("empty site", m.sites[1].racks, []);
eq("model.client holds only chosen sites", buildReportModel({ client, docs, options: { ...opts, sites: [2] }, company: "x" }).client.sites.map((s) => s.id), [2]);
eq("site filter", buildReportModel({ client, docs, options: { ...opts, sites: [2] }, company: "x" }).sites.map((s) => s.id), [2]);
eq("link both names", [m.links[0].from, m.links[0].to], ["Head Office", "Warehouse"]);
eq("link internet", m.links[1].to, "Internet");
const sw = m.sites[0].switches;
eq("switch maps exist", sw.length > 0 && sw.every((s) => s.ports.length > 0), true);
eq("to wording", sw.some((s) => s.ports.some((p) => / \(.+\)$/.test(p.to))), true);

// attention and power in the report
{
  const base = JSON.parse(JSON.stringify(doc)) as Doc;
  const rk = base.racks[0];
  const dv = { ...base.devices.find((d) => d.rack === rk.id)!, id: 9001, name: "Example Box", rack: rk.id, power_w: 400, warranty_exp: "2020-01-01", status: "active" } as any;
  const d2: Doc = { ...base, devices: [dv] };
  const c2: ClientItem = { ...client, sites: [{ id: 1, name: "Head Office", address: "", notes: "", racks: [{ key: "p1", name: "P" }] }], links: [] };
  const m2 = buildReportModel({ client: c2, docs: { p1: d2 }, options: opts, company: "x" });
  eq("attention critical first", m2.attention[0]?.level, "critical");
  eq("power watts", m2.power[0]?.w, 400);
  eq("power site", m2.power[0]?.site, "Head Office");
}

// a site filter keeps cross-site IP clashes; stale rack alerts are left out; power rows carry the site id
{
  const mkDoc = (name: string, ip: string): Doc => ({ v: 1, nid: 10, racks: [{ id: 1, name: "Rack " + name, u: 12, x: 0, y: 0 }],
    devices: [{ id: 1, name, type: "NAS", u_size: 1, rack: 1, u: 1, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front", model: "", ports: [], ip } as any], cables: [] });
  const c3: ClientItem = { ...client, links: [], sites: [
    { id: 1, name: "Site A", address: "", notes: "", racks: [{ key: "a", name: "A" }] },
    { id: 2, name: "Site B", address: "", notes: "", racks: [{ key: "b", name: "B" }] }] };
  const m3 = buildReportModel({ client: c3, docs: { a: mkDoc("NAS-A", "10.0.0.5"), b: mkDoc("NAS-B", "10.0.0.5") }, options: { ...opts, sites: [1] }, company: "x" });
  eq("ip clash kept for site A", m3.attention.map((a) => [a.kind, a.rackKey]), [["ip", "a"]]);
  eq("no stale in report", m3.attention.some((a) => a.kind === "stale"), false);
  eq("power site id", m3.power.map((p) => p.siteId), [1]);
}

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
