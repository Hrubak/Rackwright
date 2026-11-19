// Auvik cables: server links -> neighbours -> plan cables. Synthetic fixtures from the server tests.
import { readFileSync } from "node:fs";
import { endpointPorts, linksToNeighbors } from "../src/auvik/api/links";
import { apiItems, toAuvikDevice, type AuvikApiDevice } from "../src/auvik/api/map";
import { applySite, planSite, type SiteDocs } from "../src/auvik/api/sync";
import type { Doc } from "../src/types";
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

// --- endpoints move onto their switch
const mk = (doc?: Doc): SiteDocs => ({ siteId: 1, racks: doc ? [{ id: 3, name: "Example Site (Auvik)", version: 1, doc }] : [] });
const sitePlan = (i: AuvikInventory, doc: Doc | undefined, l: AuvikLinks) => planSite(i, tenant, mk(doc), defaults, "empty", undefined, undefined, undefined, l);
const ticked = (p: ReturnType<typeof plan>, skip: string[] = []) => new Set(p.diff!.changes.filter((c) => c.defaultOn && !skip.includes(c.id)).map((c) => c.id));
const firstImport = (i: AuvikInventory) => applySite(planSite(i, tenant, mk(), defaults, "empty"), null as any).auvikDoc;   // no links: Endpoints boxes
const boxOf = (d: Doc, ep: string) => d.devices.filter((x) => x.endpoints?.some((e) => e.name === ep)).map((x) => x.name);
const epOf = (d: Doc, ep: string) => d.devices.flatMap((x) => x.endpoints ?? []).find((e) => e.name === ep);
const MOVE = "Move to Endpoints on EX-SW01";
const cabled = (d: Doc, group: string, ep: string, label: string) => {
  const g = d.devices.find((x) => x.name === group);
  const i = g?.endpoints?.findIndex((e) => e.name === ep) ?? -1, gp = g?.ports[i];
  return !!gp && d.cables.some((c) => (c.a === gp.id || c.b === gp.id) && c.label === label);
};
const doc1 = firstImport(inv);
t("setup: printer in the Printers box", boxOf(doc1, "EX-PRN01").join() === "Printers" && epOf(doc1, "EX-PRN01")!.port === "");

const mp = sitePlan(inv, doc1, links);
const mv = mp.diff!.changes.filter((c) => c.title === MOVE);
t("endpoint moves from import box: one change, ticked", mv.length === 1 && mv[0].defaultOn === true && mv[0].cat === "moved", JSON.stringify(mp.diff!.changes.map((c) => c.id + ":" + c.title)));
t("no separate cable change for the move", !mp.diff!.changes.some((c) => c.id.startsWith("cn:g:")));
const moved = applySite(mp, ticked(mp)).auvikDoc;
t("moved: member of Endpoints on EX-SW01 with its cable", boxOf(moved, "EX-PRN01").join() === "Endpoints on EX-SW01" && cabled(moved, "Endpoints on EX-SW01", "EX-PRN01", "EX-SW01 1/1/5"), boxOf(moved, "EX-PRN01").join());
t("moved: Printers box is gone", !moved.devices.some((x) => x.name === "Printers" || (x as any).auvik_epbox === "printer"));
t("moved: port is the switch port", epOf(moved, "EX-PRN01")!.port === "1/1/5");

const kept = applySite(mp, ticked(mp, [mv[0].id])).auvikDoc;
t("move unticked keeps box", boxOf(kept, "EX-PRN01").join() === "Printers" && epOf(kept, "EX-PRN01")!.port === "EX-SW01 1/1/5", boxOf(kept, "EX-PRN01").join() + " / " + epOf(kept, "EX-PRN01")!.port);
t("move unticked: no group, no cable", !kept.devices.some((x) => x.name === "Endpoints on EX-SW01") && !kept.cables.some((c) => c.label === "EX-SW01 1/1/5"));

// behind an uplink: SW02 also connects to SW01 port 1/1/5
const up: AuvikLinks = { ...links, links: [...links.links, { device: "d-1001-01", iface: "1/1/5", peerDevice: "d-1001-02", peerIface: "1/1/10", portless: false }] };
const upp = sitePlan(inv, doc1, up);
t("no move behind uplink", !upp.diff!.changes.some((c) => c.title === MOVE || c.id.startsWith("mvm:")));
t("uplink: member port shows the switch port", epOf(applySite(upp, ticked(upp)).auvikDoc, "EX-PRN01")!.port === "EX-SW01 1/1/5" && boxOf(applySite(upp, ticked(upp)).auvikDoc, "EX-PRN01").join() === "Printers");

// two endpoints on one port
const prn = inv.devices.find((x) => x.id === "d-1001-10")!;
const inv2: AuvikInventory = { ...inv, devices: [...inv.devices, { ...prn, id: "d-1001-20", name: "EX-PRN02", serial: "EXSN0020", ips: ["198.51.100.62"], macs: ["00:00:5E:00:53:0B"] }] };
const shared: AuvikLinks = { ...links, links: [...links.links, { device: "d-1001-01", iface: "1/1/5", peerDevice: "d-1001-20", peerIface: "eth0", portless: false }] };
const sh = sitePlan(inv2, firstImport(inv2), shared);
const shDoc = applySite(sh, ticked(sh)).auvikDoc;
t("no move when port is shared", !sh.diff!.changes.some((c) => c.title === MOVE) && boxOf(shDoc, "EX-PRN01").join() === "Printers" && boxOf(shDoc, "EX-PRN02").join() === "Printers");
t("shared: both list the port", epOf(shDoc, "EX-PRN01")!.port === "EX-SW01 1/1/5" && epOf(shDoc, "EX-PRN02")!.port === "EX-SW01 1/1/5");

// a hand-made group keeps its member
const hand = JSON.parse(JSON.stringify(doc1)) as Doc;
const pb = hand.devices.find((x) => x.name === "Printers")!;
(pb as any).auvik_epbox = undefined; delete (pb as any).auvik_epbox; pb.name = "Front desk"; pb.type = "Endpoints";
const hp = sitePlan(inv, hand, links);
const hd = applySite(hp, ticked(hp)).auvikDoc;
t("hand-made group untouched", !hp.diff!.changes.some((c) => c.title === MOVE || c.id.startsWith("mvm:")) && boxOf(hd, "EX-PRN01").join() === "Front desk" && !hd.devices.some((x) => x.name === "Endpoints on EX-SW01"), boxOf(hd, "EX-PRN01").join());

// no port data
const none: AuvikLinks = { status: "ok", note: "", dropped: 0, links: [{ device: "d-1001-01", iface: "", peerDevice: "d-1001-10", peerIface: "", portless: true }] };
const np = sitePlan(inv, doc1, none);
const nmv = np.diff!.changes.find((c) => c.title === MOVE);
t("portless endpoint: move says no port data", !!nmv && (nmv.detail ?? "").includes("no port data"), JSON.stringify(nmv));
const nk = applySite(np, ticked(np, nmv ? [nmv.id] : [])).auvikDoc;
t("portless endpoint: box port reads no port data", epOf(nk, "EX-PRN01")!.port === "EX-SW01 (no port data)", epOf(nk, "EX-PRN01")!.port);
const nm = applySite(np, ticked(np)).auvikDoc;
t("portless endpoint: moved, port stays empty, no cable", boxOf(nm, "EX-PRN01").join() === "Endpoints on EX-SW01" && epOf(nm, "EX-PRN01")!.port === "" && nm.cables.length === 0, boxOf(nm, "EX-PRN01").join() + "|" + epOf(nm, "EX-PRN01")!.port);

// first import: straight into the group
const fresh = applySite(sitePlan(inv, undefined, links), null as any).auvikDoc;
t("new endpoint on clean port", boxOf(fresh, "EX-PRN01").join() === "Endpoints on EX-SW01" && cabled(fresh, "Endpoints on EX-SW01", "EX-PRN01", "EX-SW01 1/1/5") && !fresh.devices.some((x) => (x as any).auvik_epbox === "printer"), boxOf(fresh, "EX-PRN01").join());

// two switch neighbours, one of them an uplink port: the endpoint is not attached
const two: AuvikLinks = { ...links, links: [...links.links,
  { device: "d-1001-02", iface: "1/1/9", peerDevice: "d-1001-10", peerIface: "eth1", portless: false },
  { device: "d-1001-02", iface: "1/1/9", peerDevice: "d-1001-03", peerIface: "X2", portless: false }] };
const twop = sitePlan(inv, doc1, two);
t("two switch neighbours, one uplink: no move", !twop.diff!.changes.some((c) => c.title === MOVE || c.id.startsWith("mvm:")) && twop.epPorts!.get("api:d-1001-10")?.attach === false);
// the person skips the uplink switch / one of two endpoints: the wire is still shared
const raw = (l: AuvikLinks, skip: string[]) => {
  const { parsed, items } = apiItems(inv2.devices, "Example Site", undefined, undefined, undefined, undefined, l.links);
  return endpointPorts(parsed, items.map((i) => (skip.includes(i.dev.name) ? { ...i, mode: "skip" as const } : i)));
};
t("uplink switch skipped: still not attached", raw(up, []).get("api:d-1001-10")?.attach === false && raw(up, ["EX-SW02"]).get("api:d-1001-10")?.attach === false);
t("clean port attaches", raw(links, [])?.get("api:d-1001-10")?.attach === true);
t("one of two endpoints skipped: the other is still not attached", raw(shared, []).get("api:d-1001-10")?.attach === false && raw(shared, ["EX-PRN02"]).get("api:d-1001-10")?.attach === false);

// second import after the move changes nothing
const again = sitePlan(inv, moved, links);
t("re-import after the move: no move, one copy", !again.diff!.changes.some((c) => c.title === MOVE) && boxOf(applySite(again, ticked(again)).auvikDoc, "EX-PRN01").length === 1);

if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
