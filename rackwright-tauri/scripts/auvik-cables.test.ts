// Auvik cables: server links -> neighbours -> plan cables. Synthetic fixtures from the server tests.
import { readFileSync } from "node:fs";
import { linksToNeighbors } from "../src/auvik/api/links";
import { toAuvikDevice, type AuvikApiDevice } from "../src/auvik/api/map";
import { planSite, type SiteDocs } from "../src/auvik/api/sync";
import type { AuvikInventory, AuvikLinks, AuvikTenant } from "../src/api";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };
const fx = (n: string) => JSON.parse(readFileSync(new URL("../../web/server/tests/fixtures/auvik/" + n, import.meta.url), "utf8"));
const inv: AuvikInventory = fx("expected-inventory-main.json");
const links: AuvikLinks = fx("expected-links-main.json");
const tenant: AuvikTenant = { id: "t1", name: "Example Site", type: "client", parent: null };
const docs: SiteDocs = { siteId: 1, racks: [] };
const defaults = { model: "", u: 42 };
const plan = (l?: AuvikLinks) => planSite(inv, tenant, docs, defaults, "empty", undefined, undefined, undefined, l);
const between = (p: ReturnType<typeof plan>, x: string, y: string) =>
  p.plan.cables.filter((c) => { const n = [c.a.target.name, c.b.target.name]; return n.includes(x) && n.includes(y); });

// --- neighbours from fixture
const devs = inv.devices.map((d: AuvikApiDevice) => toAuvikDevice(d, "Example Site"));
const r = linksToNeighbors(devs, links.links);
const nb = (n: string) => devs.find((d) => d.name === n)!.neighbors;
t("neighbours from fixture", nb("EX-FW01").some((x) => x.name === "EX-SW01" && x.iface === "1/1/1") && nb("EX-SW01").some((x) => x.name === "EX-FW01" && x.iface === "X1"));
t("portless pair listed", r.portless.length === 1 && r.portless[0].a === "EX-SRV02" && r.portless[0].b === "EX-NAS01" && r.unresolved === 0);

// --- plan
const p = plan(links);
const fw = between(p, "EX-SW01", "EX-FW01");
t("one cable per link", fw.length === 1, String(fw.length));
const lag = between(p, "EX-SW01", "EX-SW02");
const pairs = lag.map((c) => [c.a.iface, c.b.iface].join("|")).sort();
t("lag members stay two cables", lag.length === 2 && pairs[0] === "1/1/47|1/1/47" && pairs[1] === "1/1/48|1/1/48", pairs.join(" "));
t("portless device link is a note", between(p, "EX-SRV02", "EX-NAS01").length === 0 && p.plan.warnings.some((w) => w.includes("EX-SRV02 and EX-NAS01 are connected (no port data)")), JSON.stringify(p.plan.warnings));
t("portless note once", p.plan.warnings.filter((w) => w.includes("no port data")).length === 1);

// --- no links = 3.19.2
const q = plan();
t("no links = 3.19.2", q.plan.cables.length === 0 && q.items.length === p.items.length && !q.plan.warnings.some((w) => w.includes("no port data")));

// --- unknown device id
const bad = linksToNeighbors(devs.map((d) => toAuvikDevice(inv.devices.find((x) => x.id === d.apiId)!, "x")), [{ device: "d-1001-01", iface: "1", peerDevice: "nope", peerIface: "2", portless: false }]);
t("unknown device id counted", bad.unresolved === 1 && bad.portless.length === 0);

if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
