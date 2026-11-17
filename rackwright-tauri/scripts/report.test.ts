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

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
