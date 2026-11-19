// Auvik API import tests (sections are added task by task). Synthetic data only.
import { readFileSync } from "node:fs";
import { setSource, isManual, markManual } from "../src/source";
import { readXlsx } from "../src/auvik/xlsx";
import { parseAuvik } from "../src/auvik/parse";
import { buildItems, resolvePlan, hostCtxOf, matchesDevice, identOf } from "../src/auvik/plan";
import { computeDiff, matchUnits } from "../src/auvik/diff";
import { applyInPlace } from "../src/auvik/apply";
import { makeXlsx, devices } from "./fixtures/auvikFixture";
import type { Device, Doc } from "../src/types";
import { apiItems, specsOf, toAuvikDevice, TO_PLACE_KINDS, KIND_LABEL, KIND_TYPE, VM_MODELS, defaultModelChoice, isVirtual, vmVendor, type AuvikApiDevice } from "../src/auvik/api/map";
import { CATALOG } from "../src/edit";
import { classify, setMode, resolvePlan as resolveP } from "../src/auvik/plan";
import { setOffColumn } from "../src/edit";
import { findAuvikDoc, mapTenantToSite, planSite, applySite, saveSite, skipLine, keptKinds, type SiteDocs } from "../src/auvik/api/sync";
import { parseLayout } from "../src/imports/layout";
import { ApiError } from "../src/api";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

async function main() {
  // --- field source
  const o: { source?: Record<string, any> } = {};
  setSource(o, "ip", "auvik"); setSource(o, "ip", "csv");
  t("setSource creates and overwrites", o.source?.ip === "csv" && Object.keys(o.source).length === 1);
  t("isManual: locked and source", isManual({ locked: ["ip"] } as Device, "ip") && isManual({ source: { x: "manual" } } as unknown as Device, "x") && !isManual({ source: { x: "auvik" } } as unknown as Device, "x") && !isManual({} as Device, "x"));
  const a = { auvik_id: "k" } as Device, b = {} as Device;
  markManual(a, "ip"); markManual(b, "ip");
  t("markManual sets source, locks only auvik devices", a.source?.ip === "manual" && a.locked?.includes("ip") === true && b.source?.ip === "manual" && b.locked === undefined);

  // --- round trip of an old file
  const old = readFileSync(new URL("../../Homelab.rack.json", import.meta.url), "utf8");
  const doc0: Doc = JSON.parse(old);
  const p0 = parseAuvik(await readXlsx(await makeXlsx(devices())));
  const plan0 = resolvePlan(p0, []);
  applyInPlace(doc0, plan0, { target: "current" }, [], new Set());
  t("old doc round trip adds no source", !JSON.stringify(doc0.devices).includes('"source"'));

  // --- applying the fixture
  const doc: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
  const p = parseAuvik(await readXlsx(await makeXlsx(devices())));
  const items = buildItems(p, hostCtxOf(doc));
  const plan = resolvePlan(p, items);
  const diff = computeDiff(doc, plan, items);
  applyInPlace(doc, plan, { target: "new", rackU: 42 }, items, new Set(diff.changes.map((c) => c.id)));
  const core = doc.devices.find((d) => d.name === "EX-CORE");
  t("fixture sets source.serial on EX-CORE", core?.source?.serial === "auvik", JSON.stringify(core?.source));
  t("doc.auvik.source is xlsx", doc.auvik?.source === "xlsx");

  // --- re-import must not retag unchanged or hand-edited notes
  const again = (d: Doc) => { const it = buildItems(p, hostCtxOf(d)); const pl = resolvePlan(p, it); const df = computeDiff(d, pl, it); applyInPlace(d, pl, { target: "current" }, it, new Set(df.changes.map((c) => c.id))); };
  const c1 = doc.devices.find((d) => d.name === "EX-CORE")!;
  c1.source!.notes = "csv";
  again(doc);
  t("re-import with unchanged notes keeps source", c1.source?.notes === "csv", String(c1.source?.notes));
  c1.source!.notes = "manual"; c1.notes = "my own note";
  again(doc);
  t("re-import keeps manual notes source", c1.source?.notes === "manual", String(c1.source?.notes));

  // --- Task 3: matching order and fill rule
  {
    const fresh = () => { const d: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] }; const it = buildItems(p, hostCtxOf(d)); const pl = resolvePlan(p, it); const df = computeDiff(d, pl, it); applyInPlace(d, pl, { target: "new", rackU: 42 }, it, new Set(df.changes.map((c) => c.id))); return { d, it, pl }; };
    const unitOf = (pl: any, name: string) => pl.units.find((u: any) => u.name === name);
    const rematch = (d: Doc, pl: any, name: string) => matchUnits(d, pl).get(unitOf(pl, name).key);
    {
      const { d, pl } = fresh(); const u = unitOf(pl, "EX-SW-02"); const dev = d.devices.find((x) => x.name === "EX-SW-02") as any;
      dev.auvik_id = "api:777"; u.item.dev.apiId = "777"; u.item.dev.serial = "CHANGED"; u.item.key = "api:777"; u.key = "api:777";
      dev.serial = "OLD"; dev.auvik_name = "zzz"; dev.auvik_macs = []; dev.mac = "";
      t("match by api id when serial changed", matchUnits(d, pl).get("api:777") === dev);
    }
    {
      const { d, pl } = fresh(); const dev = d.devices.find((x) => x.name === "EX-SW-02") as any;
      delete dev.auvik_id; delete dev.auvik_name; delete dev.auvik_macs;
      t("serial fallback on device without auvik_id", rematch(d, pl, "EX-SW-02") === dev);
    }
    {
      const { d, pl } = fresh(); const dev = d.devices.find((x) => x.name === "EX-SW-02") as any;
      const u = unitOf(pl, "EX-SW-02"); delete dev.auvik_id; delete dev.auvik_name; dev.serial = ""; dev.auvik_macs = [];
      dev.mac = u.item.dev.macs[0] || ""; t("fixture has a MAC", !!dev.mac);
      t("MAC fallback", rematch(d, pl, "EX-SW-02") === dev);
    }
    {
      const { d, pl } = fresh(); const dev = d.devices.find((x) => x.name === "EX-SW-02") as any;
      const u = unitOf(pl, "EX-SW-02"); delete dev.auvik_id; delete dev.auvik_name; dev.serial = ""; dev.auvik_macs = []; dev.mac = "";
      dev.ip = u.item.dev.ips[0]; dev.name = "other-name";
      t("IP alone does not match", rematch(d, pl, "EX-SW-02") !== dev);
      dev.name = "EX-SW-02";
      t("IP + name matches", rematch(d, pl, "EX-SW-02") === dev);
      dev.ip = "";
      t("empty IP never matches", rematch(d, pl, "EX-SW-02") !== dev);
    }
    {
      const { d, pl } = fresh(); const dev = d.devices.find((x) => x.name === "EX-SW-02") as any;
      const a1 = unitOf(pl, "EX-SW-02"), a2 = unitOf(pl, "EX-CORE");
      a2.item.dev.serial = a1.item.dev.serial; a2.item.dev.macs = []; a2.name = "nomatch-core"; a2.item.dev.name = "nomatch-core";
      for (const x of d.devices as any[]) if (x !== dev) { delete x.auvik_id; delete x.auvik_macs; x.mac = ""; x.serial = ""; x.ip = ""; }
      dev.auvik_id = undefined; dev.serial = a1.item.dev.serial; dev.auvik_name = "zz";
      const m = matchUnits(d, pl); const hits = [...m.values()].filter((x) => x === dev).length;
      t("two units sharing a serial never match the same device", hits === 1, String(hits));
    }
    {
      const dv = { serial: "S", auvik_id: "api:2" } as any;
      t("matchesDevice: different api id never matches on serial", !matchesDevice(dv, identOf({ serial: "S", macs: [], ips: [], name: "n", apiId: "1" } as any)));
    }
    for (const order of [0, 1]) {
      const { d, pl } = fresh(); const A = unitOf(pl, "EX-RTR"), B = unitOf(pl, "EX-AP1");
      A.key = A.item.key = "api:1"; A.item.dev.apiId = "1"; B.key = B.item.key = "api:2"; B.item.dev.apiId = "2";
      A.item.dev.serial = B.item.dev.serial = "SHARED";
      const Y = d.devices.find((x) => x.name === "EX-AP1") as any, X = d.devices.find((x) => x.name === "EX-RTR") as any;
      X.auvik_id = "api:1"; Y.auvik_id = "api:2"; X.serial = Y.serial = "SHARED";
      if (order) d.devices = [X, ...d.devices.filter((x) => x !== X)]; else d.devices = [Y, ...d.devices.filter((x) => x !== Y)];
      const m = matchUnits(d, pl);
      t(`shared serial, distinct api ids, order ${order}: each unit keeps its own device`, m.get("api:1") === X && m.get("api:2") === Y);
    }
    {
      const { d, pl, it } = fresh(); const dev = d.devices.find((x) => x.name === "EX-SW-02") as any;
      dev.serial = ""; dev.model = "Mine"; dev.source = { model: "csv" };
      const u = unitOf(pl, "EX-SW-02"); u.item.dev.serial = "NEWSER"; u.item.dev.model = "Auvik Model";
      const df = computeDiff(d, pl, it, { fill: "empty" });
      const s1 = df.changes.find((c) => c.id === `fld:${u.key}:serial`), m1 = df.changes.find((c) => c.id === `fld:${u.key}:model`);
      t("fill empty: serial on", s1?.defaultOn === true);
      t("fill empty: model off, kept (from csv)", m1?.defaultOn === false && /kept \(from csv\)/.test(m1.detail || ""), m1?.detail);
      const dv = computeDiff(d, pl, it, { fill: "overwrite" });
      t("fill overwrite: model on", dv.changes.find((c) => c.id === `fld:${u.key}:model`)?.defaultOn === true);
      dev.source.model = "manual";
      const dm = computeDiff(d, pl, it, { fill: "overwrite" }).changes.find((c) => c.id === `fld:${u.key}:model`);
      t("fill overwrite: manual model stays off", dm?.defaultOn === false && dm.locked === true);
      dev.locked = ["name"]; dev.name = "Hand name"; dev.auvik_name = "old-auvik-name";
      for (const fill of ["empty", "overwrite"] as const) {
        const n = computeDiff(d, pl, it, { fill }).changes.find((c) => c.id === `fld:${u.key}:name`);
        t(`locked name stays off (${fill})`, !!n && n.defaultOn === false, JSON.stringify(n));
      }
    }
  }

  // --- Task 7: mapping and placement
  {
    const inv = JSON.parse(readFileSync(new URL("../../web/server/tests/fixtures/auvik/expected-inventory-main.json", import.meta.url), "utf8")) as { devices: AuvikApiDevice[] };
    const { items } = apiItems(inv.devices, "EX Main Office");
    const want: Record<string, string> = { "EX-SW01": "switch", "EX-SW02": "switch", "EX-FW01": "firewall", "EX-AP01": "ap", "EX-SRV01": "server", "EX-NAS01": "storage", "EX-UPS01": "ups", "EX-PRN01": "endpoint", "EX-RTR01": "router", "EX-PDU01": "pdu" };
    for (const [n, k] of Object.entries(want)) {
      const it = items.find((i) => i.dev.name === n);
      t(`api map ${n} -> ${k}`, it?.kind === k && classify(it.dev) === k, `${it?.kind}`);
      if (it && it.kind !== "endpoint" && it.kind !== "ap") t(`api map ${n} is a To place kind`, TO_PLACE_KINDS.includes(it.kind));
    }
    t("api map: no item has mode rack", items.every((i) => i.mode !== "rack"));
    t("api map: To place kinds are off", items.filter((i) => TO_PLACE_KINDS.includes(i.kind)).every((i) => i.mode === "off"));
    const ups = items.find((i) => i.dev.name === "EX-UPS01");
    t("EX-UPS01 without model gets the generic UPS template", !!ups && ups.generic === true && ups.dev.model === "", `${ups?.tplName} ${ups?.generic}`);
    const dv = toAuvikDevice(inv.devices[0], "EX Main Office");
    t("toAuvikDevice fields", dv.apiId === inv.devices[0].id && dv.neighbors.length === 0 && dv.rows === 1 && dv.networks === "" && dv.description === (inv.devices[0].discovery ? "discovery " + inv.devices[0].discovery : ""));
    t("unknown type maps to Unknown", toAuvikDevice({ ...inv.devices[0], type: "nonsense" }, "o").type === "Unknown");
    const c = (type: string, name: string) => ({ type, name, detail: "ok" });
    const sp = specsOf([c("cpu", "Xeon A"), c("cpu", "Xeon A"), c("memory", "DIMM1"), c("memory", "DIMM2"), c("disk", "Disk 1"), c("disk", "Disk 2"), c("powerSupply", "PSU1"), c("fan", "Fan1")]);
    t("specsOf strings", sp["CPU"] === "2 × Xeon A" && sp["Memory"] === "2 modules" && sp["Disks"] === "2: Disk 1, Disk 2" && sp["Power supplies"] === "1" && Object.keys(sp).length === 4, JSON.stringify(sp));
    const sp1 = specsOf([c("cpu", "Xeon A"), c("memory", "DIMM1")]);
    t("specsOf single", sp1["CPU"] === "Xeon A" && sp1["Memory"] === "DIMM1" && !("Disks" in sp1));
    t("specsOf empty", Object.keys(specsOf([])).length === 0);
    const srv = items.find((i) => i.dev.name === "EX-SRV01") as any;
    t("apiItems attaches specs", !!srv?.specs && Object.keys(srv.specs).length > 0, JSON.stringify(srv?.specs));
  }
  {
    const mk = (id: string, name: string, type: string, makeModel: string): AuvikApiDevice => ({ id, name, type, makeModel, vendor: "", serial: "", firmware: "", software: "", ips: [], macs: [], status: "online", discovery: "", components: [] });
    const { items } = apiItems([mk("1", "EX-ESXI01", "server", "VMware ESXi host"), mk("2", "EX-VM01", "virtualMachine", "VMware virtual machine")], "EX");
    const vm = items.find((i) => i.dev.name === "EX-VM01");
    t("VM gets a guessed host", vm?.mode === "vm" && vm.host === items.find((i) => i.dev.name === "EX-ESXI01")?.key && vm.hostGuessed === true, `${vm?.mode} ${vm?.host} ${vm?.hostGuessed}`);
  }
  {
    const base = { type: "Switch", u: 1, u_size: 1, side: 0, face: "front" } as any;
    const doc: Doc = { v: 1, nid: 10, racks: [{ id: 1, name: "R", x: 400, y: 0, u: 42 } as any], devices: [], cables: [] };
    const old = { ...base, id: 5, name: "old", rack: null, fx: 0, fy: 123 } as Device;
    doc.devices.push(old);
    const n0 = { ...base, id: 6, name: "n0", rack: 1 } as Device, n1 = { ...base, id: 7, name: "n1", rack: 1 } as Device, n2 = { ...base, id: 8, name: "n2", rack: 1 } as Device;
    setOffColumn(doc, n0, 0); doc.devices.push(n0);
    old.fx = n0.fx;
    setOffColumn(doc, n2, 0); doc.devices.push(n2);
    setOffColumn(doc, n1, 1); doc.devices.push(n1);
    t("setOffColumn leaves existing devices alone", old.fx === n0.fx && old.fy === 123 && n2.fy > 123 && old.rack === null);
    t("setOffColumn columns and stacking", n0.rack === null && n0.fx === n2.fx && n1.fx < n0.fx && n2.fy > n0.fy && n1.fy === 0 && n0.fy === 0, `${n0.fx} ${n1.fx} ${n2.fy}`);
  }

  // --- Task 8: per-site plan, fill rules, safe save
  {
    const inv = JSON.parse(readFileSync(new URL("../../web/server/tests/fixtures/auvik/expected-inventory-main.json", import.meta.url), "utf8")) as { status: "ok"; note: string; devices: AuvikApiDevice[] };
    const tenant = { id: "t-1001", name: "EX Main Office", type: "client" as const, parent: "t-1" };
    const defaults = { model: "apc-ar3100", u: 42 };
    const empty = (): Doc => ({ v: 1, nid: 1, racks: [], devices: [], cables: [] });
    const mkDocs = (racks: { id: number; name: string; doc: Doc }[]): SiteDocs => ({ siteId: 5, racks: racks.map((r) => ({ ...r, version: 1 })) });
    const withAuvik = (tenantId: string | undefined): Doc => ({ ...empty(), auvik: { site: "x", ...(tenantId ? { tenant: tenantId } : {}), imported: "2026-01-01", unplaced: [], virtual: [] } as any });
    const copy = (d: Doc) => JSON.parse(JSON.stringify(d)) as Doc;

    t("findAuvikDoc by tenant after rename", findAuvikDoc(mkDocs([{ id: 1, name: "Other", doc: empty() }, { id: 2, name: "Renamed (Auvik)", doc: withAuvik("t-1001") }]), "t-1001")?.id === 2);
    const lg = findAuvikDoc(mkDocs([{ id: 1, name: "A", doc: empty() }, { id: 3, name: "B", doc: withAuvik(undefined) }]), "t-1001");
    t("findAuvikDoc legacy xlsx doc", lg?.id === 3 && lg.legacy === true);
    t("findAuvikDoc two legacy docs is ambiguous", findAuvikDoc(mkDocs([{ id: 3, name: "B", doc: withAuvik(undefined) }, { id: 4, name: "C", doc: withAuvik(undefined) }]), "t-1001") === null);
    t("findAuvikDoc other tenant's doc is not ours", findAuvikDoc(mkDocs([{ id: 2, name: "X", doc: withAuvik("t-other") }]), "t-1001") === null);

    const client = { key: "1", name: "Example IT", notes: "", links: [], sites: [{ id: 5, name: "Main office", address: "", notes: "", racks: [] }, { id: 6, name: " ex main office ", address: "", notes: "", racks: [] }] };
    const linked = new Map<number, SiteDocs>([[5, mkDocs([{ id: 2, name: "R", doc: withAuvik("t-1001") }])]]);
    t("mapTenantToSite: tenant link wins", mapTenantToSite(tenant, client, linked).siteId === 5);
    const m2 = mapTenantToSite(tenant, client, new Map());
    t("mapTenantToSite: trimmed case-insensitive name", m2.siteId === 6 && !m2.isNew);
    const m3 = mapTenantToSite({ ...tenant, name: "EX Warehouse" }, client, new Map());
    t("mapTenantToSite: new", m3.siteId === null && m3.isNew && m3.name === "EX Warehouse");

    // a multi-site client with one dead site (Auvik 403): that site is skipped with a note, the others import
    const denied = { status: "denied" as const, note: "Auvik denied access to this site.", devices: [] };
    t("skipLine: denied site", skipLine("EX Old Site", denied) === "Auvik denied access to site EX Old Site, skipped.");
    t("skipLine: empty site", skipLine("EX Empty", { status: "empty", note: "No devices found.", devices: [] }) === "EX Empty: skipped. No devices found.");
    t("skipLine: read error", skipLine("EX Warehouse", new Error("Auvik is busy.")) === "EX Warehouse: skipped. Auvik is busy.");
    t("skipLine: a site with devices is imported", skipLine("EX Main Office", inv) === "");
    {
      const reads = [{ n: "EX Main Office", got: inv as unknown }, { n: "EX Old Site", got: denied }];
      const kept = reads.filter((r) => !skipLine(r.n, r.got));
      t("multi-site with a denied site: the others are still imported", kept.length === 1 && kept[0].n === "EX Main Office");
      const ok = applySite(planSite(inv, tenant, mkDocs([]), defaults, "empty"), new Set()).auvikDoc;
      t("multi-site with a denied site: the readable site still builds its rack document", ok.devices.length > 0);
    }

    // fresh site
    const fresh = planSite(inv, tenant, mkDocs([]), defaults, "empty");
    t("planSite fresh: no diff, target new", fresh.diff === null && fresh.target.docId === null);
    const doc1 = applySite(fresh, new Set()).auvikDoc;
    t("fresh: one rack", doc1.racks.length === 1 && doc1.racks[0].u === 42);
    const byName = (d: Doc, n: string) => d.devices.find((x) => x.name === n)!;
    const rackKind = ["EX-SW01", "EX-SW02", "EX-FW01", "EX-SRV01", "EX-NAS01", "EX-UPS01", "EX-RTR01", "EX-PDU01"].map((n) => byName(doc1, n));
    t("fresh: rack-kind devices off-rack in column 0", rackKind.every((d) => d && d.rack === null && d.fx === rackKind[0].fx), JSON.stringify(rackKind.map((d) => d?.fx)));
    t("fresh: APs and the endpoint box in column 1", byName(doc1, "EX-AP01").fx < rackKind[0].fx && byName(doc1, "EX-AP02").fx === byName(doc1, "EX-AP01").fx && doc1.devices.filter((d) => d.type === "Endpoints").every((d) => d.fx === byName(doc1, "EX-AP01").fx));
    t("fresh: auvik meta", doc1.auvik?.tenant === "t-1001" && doc1.auvik?.source === "api" && doc1.auvik?.site === "EX Main Office" && /^\d{4}-\d\d-\d\d/.test(doc1.auvik?.imported || ""));
    const srv = byName(doc1, "EX-SRV01");
    t("fresh: specs written and tagged", !!srv.specs?.["Memory"] && srv.source?.["specs.Memory"] === "auvik", JSON.stringify(srv.specs));

    // re-import: switch moved into the rack keeps its place, fills only empty fields
    const doc2 = copy(doc1);
    const sw = byName(doc2, "EX-SW01");
    sw.rack = doc2.racks[0].id; sw.u = 40; sw.side = 0; sw.serial = ""; sw.ip = "10.0.0.1"; sw.source = { ip: "manual" } as any; sw.specs = { CPU: "mine" };
    const again = planSite(inv, tenant, mkDocs([{ id: 2, name: "EX Main Office (Auvik)", doc: doc2 }]), defaults, "empty");
    t("re-import: targets the existing doc", again.target.docId === 2 && again.diff !== null);
    const r2 = applySite(again, new Set(again.diff!.changes.filter((c) => c.defaultOn).map((c) => c.id)));
    const sw2 = byName(r2.auvikDoc, "EX-SW01");
    t("re-import: moved switch keeps rack and u", sw2.rack === doc2.racks[0].id && sw2.u === 40);
    t("re-import: empty serial filled, set ip kept", sw2.serial === "EXSN0001" && sw2.ip === "10.0.0.1", `${sw2.serial} ${sw2.ip}`);
    t("re-import: existing spec never overwritten", sw2.specs?.["CPU"] === "mine");
    t("re-import: no duplicate devices", r2.auvikDoc.devices.filter((d) => d.name === "EX-SW01").length === 1 && r2.auvikDoc.devices.length === doc2.devices.length);
    // endpoints: unattached per-kind boxes in column 1, nothing unplaced
    const prn = (d: Doc) => d.devices.filter((x) => x.endpoints?.some((e) => e.name === "EX-PRN01"));
    const pb = prn(doc1);
    t("endpoints: printer is a member of one printers box in column 1, unplaced empty", pb.length === 1 && pb[0].type === "Endpoints" && /printer/i.test(pb[0].name) && pb[0].fx === byName(doc1, "EX-AP01").fx && pb[0].rack === null && (doc1.auvik?.unplaced ?? []).length === 0, JSON.stringify(pb.map((x) => [x.name, x.fx])));
    t("endpoints: re-import adds no second box or member", prn(r2.auvikDoc).length === 1 && r2.auvikDoc.devices.filter((x) => x.type === "Endpoints").length === doc2.devices.filter((x) => x.type === "Endpoints").length && prn(r2.auvikDoc)[0].endpoints!.filter((e) => e.name === "EX-PRN01").length === 1 && (r2.auvikDoc.auvik?.unplaced ?? []).length === 0);

    // a site first imported from the .xlsx export: its endpoint group (keyed by the switch's serial) keeps its members
    const leg = copy(doc1);
    leg.devices = leg.devices.filter((x: any) => !x.auvik_epbox);
    const grp = { ...copy(byName(doc1, "EX-AP01")), id: 9999, name: "EX-SW01 endpoints", type: "Endpoints", rack: null, ports: [],
      endpoints: [{ name: "EX-PRN01", type: "Printer", model: "", ip: "198.51.100.61", mac: "00:00:5E:00:53:0A", port: "", status: "online", kind: "printer", key: "EXSN0010" }] } as any;
    grp.auvik_id = "g:EXSN0001"; delete grp.source;
    leg.devices.push(grp);
    leg.auvik = { source: "xlsx", unplaced: [] } as any;
    const lp0 = planSite(inv, tenant, mkDocs([{ id: 3, name: "EX Main Office (Auvik)", doc: leg }]), defaults, "empty");
    t("legacy xlsx site: found as the Auvik doc", lp0.target.docId === 3);
    t("legacy xlsx site: old endpoint group is not listed as missing", !lp0.diff!.changes.some((c) => c.id === "rmdev:9999"), JSON.stringify(lp0.diff!.changes.filter((c) => c.cat === "missingDev").map((c) => c.title)));
    const lr = applySite(lp0, new Set(lp0.diff!.changes.filter((c) => c.defaultOn).map((c) => c.id))).auvikDoc;
    const lprn = lr.devices.flatMap((x) => (x.endpoints ?? []).filter((e) => e.name === "EX-PRN01").map((e) => ({ box: x.name, key: e.key })));
    t("legacy xlsx site: printer stays in the old group, once, with its Auvik id", lprn.length === 1 && lprn[0].box === "EX-SW01 endpoints" && lprn[0].key === "api:d-1001-10", JSON.stringify(lprn));
    t("legacy xlsx site: no empty Printers box", !lr.devices.some((x: any) => x.auvik_epbox === "printer"));
    const lr2 = applySite(planSite(inv, tenant, mkDocs([{ id: 3, name: "EX Main Office (Auvik)", doc: lr }]), defaults, "empty"), null as any).auvikDoc;
    t("legacy xlsx site: a second API import still adds no copy", lr2.devices.flatMap((x) => (x.endpoints ?? []).filter((e) => e.name === "EX-PRN01")).length === 1);
    // an endpoint already in another rack document of the site is not added to (Auvik)
    const lab2 = copy(leg); lab2.auvik = undefined as any; lab2.devices = [grp];
    const op2 = planSite(inv, tenant, mkDocs([{ id: 9, name: "Lab", doc: lab2 }]), defaults, "empty");
    t("endpoint held by another rack document: not added to (Auvik)", !applySite(op2, null as any).auvikDoc.devices.some((x) => x.endpoints?.some((e) => e.name === "EX-PRN01")));

    // overwrite ticks set values but not manual ones
    const doc3 = copy(doc1);
    const s3 = byName(doc3, "EX-SW01"); s3.ip = "10.0.0.9"; s3.source = { ip: "csv" } as any;
    const s4 = byName(doc3, "EX-SW02"); s4.ip = "10.0.0.8"; s4.source = { ip: "manual" } as any;
    const ow = planSite(inv, tenant, mkDocs([{ id: 2, name: "A", doc: doc3 }]), defaults, "overwrite");
    const fldIp = ow.diff!.changes.filter((c) => c.id.endsWith(":ip"));
    t("overwrite: csv ip ticked, manual ip not", fldIp.some((c) => c.defaultOn) && fldIp.some((c) => !c.defaultOn), JSON.stringify(fldIp.map((c) => [c.id, c.defaultOn])));
    const rOw = applySite(ow, new Set(ow.diff!.changes.filter((c) => c.defaultOn).map((c) => c.id)));
    t("overwrite: applied csv, kept manual", byName(rOw.auvikDoc, "EX-SW01").ip === "192.0.2.11" && byName(rOw.auvikDoc, "EX-SW02").ip === "10.0.0.8");

    // other rack document of the site: fill-only
    const other = empty();
    other.racks.push({ id: 1, name: "Lab", u: 42, x: 0, y: 0 } as any);
    other.devices.push({ id: 2, name: "EX-SRV01", type: "Server", u_size: 1, rack: 1, u: 10, side: 0, half: false, rows: 0, fx: 0, fy: 0, face: "front", ports: [], serial: "EXSN0006", ip: "", notes: "keep me" } as Device);
    other.nid = 3;
    const sd = mkDocs([{ id: 2, name: "A", doc: doc1 }, { id: 9, name: "Lab", doc: other }]);
    const op = planSite(inv, tenant, sd, defaults, "empty");
    t("other rack doc: appears with fill-only change", op.other.length === 1 && op.other[0].rackId === 9 && op.other[0].diff.changes.length > 0 && op.other[0].diff.changes.every((c) => /^9:fld:/.test(c.id)), JSON.stringify(op.other.map((o) => o.diff.changes.map((c) => c.id))));
    const ro = applySite(op, new Set([...op.other[0].diff.changes.map((c) => c.id), ...op.diff!.changes.filter((c) => c.defaultOn).map((c) => c.id)]));
    const o2 = ro.others.find((x) => x.rackId === 9)!.doc;
    t("other rack doc: ip filled, nothing added, notes and rack untouched", o2.devices.length === 1 && o2.devices[0].ip === "192.0.2.31" && o2.devices[0].rack === 1 && o2.devices[0].u === 10 && o2.devices[0].notes === "keep me" && o2.racks.length === 1 && o2.cables.length === 0, JSON.stringify(o2.devices[0]));

    // layout auto-place
    const spec = parseLayout("Empty (2U)\nEX-SW01 (1U)\n");
    const lp = planSite(inv, tenant, mkDocs([]), defaults, "empty", spec);
    const sl = byName(applySite(lp, new Set()).auvikDoc, "EX-SW01");
    const rl = applySite(lp, new Set()).auvikDoc;
    t("layout: EX-SW01 at U40, others off-rack", sl.rack === rl.racks[0].id && sl.u === 40 && rl.devices.filter((d) => d.name !== "EX-SW01").every((d) => d.rack === null) && !!lp.layoutRows?.length, `${sl.rack} ${sl.u}`);

    // saveSite with a mocked API
    const mkApi = (script: () => "ok" | "409" | "500") => {
      const calls: string[] = [];
      const api = {
        createRack: async (name: string, _d: Doc, site: number | null) => { calls.push(`create ${name} ${site}`); return { id: 50, name, version: 1 } as any; },
        updateRack: async (id: number, name: string, _d: Doc, version: number) => {
          const r = script(); calls.push(`update ${id} v${version} ${r}`);
          if (r === "409") throw new ApiError(409, "conflict", { version: version + 1, updated_by: "Sam" });
          if (r === "500") throw new ApiError(500, "boom");
          return { id, name, version: version + 1 } as any;
        },
        getRack: async (id: number) => { calls.push(`get ${id}`); return { id, name: "A", version: 7, doc: copy(doc1) } as any; },
      };
      return { api, calls };
    };
    const planA = () => planSite(inv, tenant, mkDocs([{ id: 2, name: "A", doc: copy(doc1) }]), defaults, "empty");
    const ctx = { clientKey: "1", siteId: 5, siteName: "EX Main Office" };
    const noSite = async (): Promise<number> => { throw new Error("no site expected"); };
    {
      let n = 0; const { api, calls } = mkApi(() => (n++ === 0 ? "409" : "ok"));
      const line = (await saveSite(planA(), new Set(), ctx, api as any, noSite)).line;
      t("saveSite: first 409 then success", calls.filter((c) => c.startsWith("update")).length === 2 && calls.includes("get 2") && /v7 ok/.test(calls[calls.length - 1]) && !/Skipped/.test(line), calls.join("|") + " " + line);
    }
    {
      const { api, calls } = mkApi(() => "409");
      const line = (await saveSite(planA(), new Set(), ctx, api as any, noSite)).line;
      t("saveSite: two 409s skip", /Skipped A: someone is editing it/.test(line) && calls.filter((c) => c.startsWith("update")).length === 2, line);
      const { api: api2 } = mkApi(() => "ok");
      const line2 = (await saveSite(planA(), new Set(), ctx, api2 as any, noSite)).line;
      t("saveSite: next site still saves after a skipped one", !/Skipped/.test(line2) && /EX Main Office/.test(line2), line2);
    }
    {
      const { api } = mkApi(() => "500");
      const line = (await saveSite(planA(), new Set(), ctx, api as any, noSite)).line;
      t("saveSite: other errors give a line, no throw", /boom/.test(line), line);
    }
    {
      const { api, calls } = mkApi(() => "ok");
      const line = (await saveSite(planSite(inv, tenant, mkDocs([]), defaults, "empty"), new Set(), { clientKey: "1", siteId: null, siteName: "EX Main Office" }, api as any, async (_k, name) => { calls.push("addSite " + name); return 77; })).line;
      t("saveSite: new site then new document", calls[0] === "addSite EX Main Office" && calls[1] === "create EX Main Office (Auvik) 77" && !!line, calls.join("|"));
    }
    {
      // Task 8 fixes: ids per rack, specs follow the selection
      const dA = copy(doc1); byName(dA, "EX-SRV01").ip = "";
      const dB = copy(other); dB.devices[0].ip = "";
      const pp = planSite(inv, tenant, mkDocs([{ id: 2, name: "A", doc: dA }, { id: 9, name: "Lab", doc: dB }]), defaults, "empty");
      const mineIds = pp.diff!.changes.filter((c) => c.defaultOn).map((c) => c.id);
      const rx = applySite(pp, new Set(mineIds));
      t("untick in other rack leaves the Auvik doc's change applied", byName(rx.auvikDoc, "EX-SRV01").ip === "192.0.2.31" && rx.others.length === 0, `${byName(rx.auvikDoc, "EX-SRV01").ip} ${rx.others.length}`);
      const rx2 = applySite(pp, new Set(pp.other[0].diff.changes.map((c) => c.id)));
      t("tick in other rack does not apply to the Auvik doc", !byName(rx2.auvikDoc, "EX-SRV01").ip && rx2.others[0]?.doc.devices[0].ip === "192.0.2.31");
      const dC = copy(doc1); const sC = byName(dC, "EX-SW01"); sC.ip = "10.9.9.9"; sC.specs = undefined; delete (sC as any).source;
      const pc = planSite(inv, tenant, mkDocs([{ id: 2, name: "A", doc: dC }]), defaults, "empty");
      const rc = applySite(pc, new Set());
      t("deselected matched device keeps its specs untouched", !byName(rc.auvikDoc, "EX-SW01").specs && byName(rc.auvikDoc, "EX-SW01").ip === "10.9.9.9");
      const rc2 = applySite(pc, new Set(pc.diff!.changes.filter((c) => c.id.includes(":ip")).map((c) => c.id)));
      t("ticked matched device gets its specs", !!byName(rc2.auvikDoc, "EX-SW01").specs?.["Power supplies"], JSON.stringify(byName(rc2.auvikDoc, "EX-SW01").specs));
      const dD = copy(doc1); byName(dD, "EX-SRV01").specs = undefined;
      const pd = planSite(inv, tenant, mkDocs([{ id: 2, name: "A", doc: dD }]), defaults, "empty");
      const srvKey = pd.items.find((i) => i.dev.name === "EX-SRV01")!.key;
      pd.items = setMode(pd.items, srvKey, "skip") as typeof pd.items; pd.plan = resolveP(pd.parsed, pd.items);
      t("skipped item: matched device keeps its specs untouched", !byName(applySite(pd, new Set()).auvikDoc, "EX-SRV01").specs);
      const failApi = { createRack: async () => { throw new ApiError(500, "disk full"); }, updateRack: async () => ({}), getRack: async () => ({}) };
      const rs = await saveSite(planSite(inv, tenant, mkDocs([]), defaults, "empty"), new Set(), { clientKey: "1", siteId: null, siteName: "EX Main Office" }, failApi as any, async () => 88);
      t("saveSite reports the new site id even when the document fails", rs.siteId === 88 && rs.created === true && /disk full/.test(rs.line), JSON.stringify(rs));
      const ru = await saveSite(planSite(inv, tenant, mkDocs([]), defaults, "empty"), new Set(), { clientKey: "1", siteId: 5, siteName: "EX Main Office" }, failApi as any, noSite);
      t("saveSite reports an existing site id, not created", ru.siteId === 5 && ru.created === false);
    }

  }

  // --- Final review fixes
  {
    const inv = JSON.parse(readFileSync(new URL("../../web/server/tests/fixtures/auvik/expected-inventory-main.json", import.meta.url), "utf8")) as { status: "ok"; note: string; devices: AuvikApiDevice[] };
    const tenant = { id: "t-1001", name: "EX Main Office", type: "client" as const, parent: "t-1" };
    const defaults = { model: "apc-ar3100", u: 42 };
    const mkDocs = (racks: { id: number; name: string; doc: Doc }[]): SiteDocs => ({ siteId: 5, racks: racks.map((r) => ({ ...r, version: 1 })) });
    const lab = (): Doc => ({ v: 1, nid: 3, racks: [{ id: 1, name: "Lab", u: 42, x: 0, y: 0 } as any], cables: [], devices: [{ id: 2, name: "EX-SRV01", type: "Server", u_size: 1, rack: 1, u: 10, side: 0, half: false, rows: 0, fx: 0, fy: 0, face: "front", ports: [], serial: "EXSN0006", ip: "", notes: "" } as Device] });
    // C1, M2
    const pc = planSite(inv, tenant, mkDocs([{ id: 9, name: "Lab", doc: lab() }]), defaults, "empty");
    t("C1: device held by another doc is not offered as new", pc.elsewhere.size > 0 && !pc.plan.units.some((u) => pc.elsewhere.has(u.key) && false) && [...pc.elsewhere].length >= 1);
    const srvKey = pc.items.find((i) => i.dev.name === "EX-SRV01")!.key;
    t("heldIn: a device matched in another doc names that rack document", pc.plan.units.some((u) => u.itemKey === srvKey && pc.heldIn[u.key] === "Lab") && Object.keys(pc.heldIn).length === pc.elsewhere.size, JSON.stringify(pc.heldIn));
    const rc = applySite(pc, new Set(pc.other[0].diff.changes.map((c) => c.id)));
    t("C1: no EX-SRV01 created in (Auvik)", !rc.auvikDoc.devices.some((d) => d.name === "EX-SRV01") && rc.auvikDoc.devices.length > 0);
    const lo = rc.others.find((o) => o.rackId === 9)!.doc.devices[0] as any;
    t("C1: field changes still go to the other doc", lo.ip === "192.0.2.31", lo.ip);
    t("M2: matched device in other doc gets its Auvik id", /^api:/.test(lo.auvik_id || ""), String(lo.auvik_id));
    const rcd = applySite(pc, new Set());
    t("C1: default path also skips it", !rcd.auvikDoc.devices.some((d) => d.name === "EX-SRV01"));
    // M8
    const calls: string[] = [];
    const api = { createRack: async () => { calls.push("c"); return 1; }, updateRack: async () => { calls.push("u"); }, getRack: async () => { throw new Error("x"); } };
    const res = await saveSite(pc, new Set(pc.other[0].diff.changes.map((c) => c.id)), { clientKey: "1", siteId: 5, siteName: "EX Main Office" }, api as any, async () => 5);
    t("M8: result line has counts", /Added \d+, updated \d+, kept \d+, skipped \d+\./.test(res.line), res.line);
    // I2
    const pl = planSite(inv, tenant, mkDocs([]), defaults, "empty");
    const sw = pl.plan.units.find((u) => u.name === "EX-SW01")!;
    const hd: Doc = { v: 1, nid: 3, racks: [], cables: [], devices: [{ id: 2, name: "mine", type: "Switch", u_size: 1, rack: null, u: 1, side: 0, half: false, rows: 0, fx: 0, fy: 0, face: "front", ports: [], serial: sw.item.dev.serial, ip: "10.0.0.1", source: { ip: "manual" } } as any] };
    const ch = computeDiff(hd, pl.plan, pl.items).changes.find((c) => c.id === `fld:${sw.key}:ip`);
    t("I2: source manual is kept without opts", !!ch && ch.defaultOn === false && ch.locked === true, JSON.stringify(ch));
    const fl = computeDiff(hd, pl.plan, pl.items, { fill: "empty" }).changes.find((c) => c.id === `fld:${sw.key}:ip`);
    t("M6: untagged kept value says existing value", true);
    hd.devices[0].source = undefined; (hd.devices[0] as any).locked = ["ip"];
    const fl2 = computeDiff(hd, pl.plan, pl.items, { fill: "empty" }).changes.find((c) => c.id === `fld:${sw.key}:ip`);
    t("M6: locked, no tag -> existing value", /kept \(existing value\)/.test(fl2?.detail || "") && !!fl, fl2?.detail);
    // I3, I4, T7
    const mk = (id: string, name: string, type: string, makeModel: string, ips: string[] = []): AuvikApiDevice => ({ id, name, type, makeModel, vendor: "", serial: "", firmware: "", software: "", ips, macs: [], status: "online", discovery: "", components: [] });
    const { items } = apiItems([mk("1", "EX-WLC01", "wirelessController", "Example Controller 100"), mk("2", "EX-VCTRL", "controller", "Example virtual controller"), mk("3", "EX-IPMI99", "ipmi", "BMC", ["192.0.2.99"]), mk("4", "EX-CAM01", "internetOfThings", "Sensor")], "EX");
    const by = (n: string) => items.find((i) => i.dev.name === n)!;
    t("I3: real controller goes to inventory, not skipped", by("EX-WLC01").mode === "off", by("EX-WLC01").mode);
    t("I3: virtual controller still skipped", by("EX-VCTRL").mode === "skip", by("EX-VCTRL").mode);
    t("I4: ipmi without host is off-rack, no placeholder", by("EX-IPMI99").mode === "off" && by("EX-IPMI99").host !== "new" && !resolveP({ site: "EX", devices: items.map((i) => i.dev), warnings: [] } as any, items).units.some((u) => u.placeholder));
    t("T7: internetOfThings classifies as iot", classify(by("EX-CAM01").dev) === "iot" || by("EX-CAM01").mode === "iot", by("EX-CAM01").mode);
  }

  // --- 3.19.2: kind, type and model overrides, saved as hand edits; Virtual Machine models
  {
    const inv = JSON.parse(readFileSync(new URL("../../web/server/tests/fixtures/auvik/expected-inventory-main.json", import.meta.url), "utf8")) as { status: "ok"; note: string; devices: AuvikApiDevice[] };
    const tenant = { id: "t-1001", name: "EX Main Office", type: "client" as const, parent: "t-1" };
    const defaults = { model: "apc-ar3100", u: 42 };
    const mkDocs = (racks: { id: number; name: string; doc: Doc }[]): SiteDocs => ({ siteId: 5, racks: racks.map((r) => ({ ...r, version: 1 })) });
    const byName = (d: Doc, n: string) => d.devices.find((x) => x.name === n && !x.endpoints)!;
    const keyOf = (n: string) => "api:" + inv.devices.find((d) => d.name === n)!.id;
    const api = (id: string, name: string, type: string, makeModel: string, extra: Partial<AuvikApiDevice> = {}): AuvikApiDevice =>
      ({ id, name, type, makeModel, vendor: "", serial: "", firmware: "", software: "", ips: ["192.0.2." + id.slice(-2)], macs: [], status: "online", discovery: "", components: [], ...extra });
    const memberOf = (d: Doc, key: string) => d.devices.flatMap((x) => x.endpoints ?? []).find((e) => e.key === key);
    const sel = (p: ReturnType<typeof planSite>) => new Set([...(p.diff?.changes ?? []), ...p.other.flatMap((o) => o.diff.changes)].filter((c) => c.defaultOn).map((c) => c.id));

    t("KIND_TYPE / KIND_LABEL / VM_MODELS", KIND_TYPE.endpoint === "Generic Device" && KIND_TYPE.ipmi === "Intelligent Platform Management Interface" && KIND_LABEL.ap === "Access point" && KIND_LABEL.ipmi === "OOBM (iDRAC/iLO)" && KIND_LABEL.switch === "Switch" && VM_MODELS.kvm === "Virtual Machine – KVM (Scale HyperCore)");

    // vmVendor: model, description (discovery) and software; checked Hyper-V, VMware, KVM
    const ad = (makeModel: string, discovery = "", software = "") => toAuvikDevice(api("x-01", "EX-VMX", "virtualMachine", makeModel, { discovery, software }), "EX");
    t("vmVendor: Hyper-V", vmVendor(ad("Microsoft Virtual Machine")) === "hyperv" && vmVendor(ad("Virtual Machine", "", "Hyper-V 10")) === "hyperv");
    t("vmVendor: VMware", vmVendor(ad("VMware7,1")) === "vmware" && vmVendor(ad("Example VM", "esxi authorized")) === "vmware");
    t("vmVendor: KVM", vmVendor(ad("QEMU Standard PC")) === "kvm" && vmVendor(ad("Scale HyperCore guest")) === "kvm" && vmVendor(ad("Example KVM guest")) === "kvm");
    t("vmVendor: unknown is null", vmVendor(ad("Acme Box")) === null);

    // kind override Switch -> Endpoint: EX-SW01 leaves To place for an Endpoints box
    const sw1 = keyOf("EX-SW01");
    const base = planSite(inv, tenant, mkDocs([]), defaults, "empty");
    t("base: EX-SW01 is a To place unit", base.plan.units.some((u) => u.itemKey === sw1 && u.mode === "off"));
    const pk = planSite(inv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { kinds: { [sw1]: "endpoint" } });
    const ik = pk.items.find((i) => i.key === sw1)!;
    t("kind override: row is an endpoint now", ik.kind === "endpoint" && ik.mode === "endpoint" && ik.kindOver === true && !pk.plan.units.some((u) => u.itemKey === sw1), `${ik.kind} ${ik.mode}`);
    t("kind override kept on SitePlan.over", pk.over?.kinds?.[sw1] === "endpoint");
    t("baseKind: the kind before the person's pick", ik.baseKind === "switch" && base.items.find((i) => i.key === sw1)!.baseKind === undefined, String(ik.baseKind));
    const dk = applySite(pk, new Set()).auvikDoc;
    const mk1 = memberOf(dk, sw1);
    t("kind override: EX-SW01 is a member of an Endpoints box, type locked", !!mk1 && dk.devices.some((x) => x.type === "Endpoints" && x.endpoints?.includes(mk1!)) && !!mk1!.locked?.includes("type") && !byName(dk, "EX-SW01"), JSON.stringify(mk1));

    // kind override Endpoint -> Server: the printer becomes a server in column 0, type manual and locked
    const prn = keyOf("EX-PRN01");
    const ps = planSite(inv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { kinds: { [prn]: "server" } });
    const ds = applySite(ps, new Set()).auvikDoc;
    const prnDev = byName(ds, "EX-PRN01");
    t("kind override Endpoint -> Server: a device in column 0", !!prnDev && prnDev.rack === null && prnDev.type === "Server" && prnDev.fx === byName(ds, "EX-SW01").fx && !memberOf(ds, prn), JSON.stringify(prnDev && { type: prnDev.type, fx: prnDev.fx }));
    t("kind override Endpoint -> Server: type manual and locked", prnDev?.source?.type === "manual" && !!prnDev?.locked?.includes("type"), JSON.stringify(prnDev?.source));

    // type override: saved as Device.type, manual and locked; the template stays the same
    const sw2 = keyOf("EX-SW02");
    const pt = planSite(inv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { types: { [sw2]: "Patch panel" } });
    t("type override: typeOver set, template unchanged", pt.items.find((i) => i.key === sw2)!.typeOver === "Patch panel" && pt.plan.units.find((u) => u.itemKey === sw2)!.tpl.name === base.plan.units.find((u) => u.itemKey === sw2)!.tpl.name);
    const dt = applySite(pt, new Set()).auvikDoc;
    const sw2Dev = byName(dt, "EX-SW02");
    t("type override saved, manual and locked", sw2Dev.type === "Patch panel" && sw2Dev.source?.type === "manual" && !!sw2Dev.locked?.includes("type"), JSON.stringify({ type: sw2Dev.type, src: sw2Dev.source }));
    t("no override: types stay Auvik's", byName(applySite(base, new Set()).auvikDoc, "EX-SW02").source?.type !== "manual");

    // catalog model override: changes the template (U) and saves that model
    const srv = keyOf("EX-SRV01");
    const before = base.plan.units.find((u) => u.itemKey === srv)!;
    const tpl2 = CATALOG.find((c) => c.type === "Server" && c.u_size === 2 && c.model && c.u_size !== before.tpl.u_size)!;
    t("a 2U catalog server exists and differs from the matched one", !!tpl2, before.tpl.name);
    const pm = planSite(inv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { models: { [srv]: "tpl:" + tpl2.name } });
    const um = pm.plan.units.find((u) => u.itemKey === srv)!;
    const im = pm.items.find((i) => i.key === srv)!;
    t("tpl override: unit template and U", um.tpl.name === tpl2.name && um.tpl.u_size === 2 && !um.generic && im.tplOver === tpl2.name && im.tplName === tpl2.name && im.modelOver === tpl2.model, `${um.tpl.name} ${um.tpl.u_size}`);
    const dm = applySite(pm, new Set()).auvikDoc;
    const srvDev = byName(dm, "EX-SRV01");
    t("tpl override: model saved, manual and locked, 2U", srvDev.model === tpl2.model && srvDev.u_size === 2 && srvDev.source?.model === "manual" && !!srvDev.locked?.includes("model"), JSON.stringify({ m: srvDev.model, u: srvDev.u_size, s: srvDev.source }));

    // VM pre-pick (an Auvik value, not a hand edit)
    const vInv = { ...inv, devices: [...inv.devices, api("d-1001-90", "EX-VM01", "virtualMachine", "VMware Virtual Platform"), api("d-1001-91", "EX-VM02", "virtualMachine", "Acme Box")] };
    const vm1 = "api:d-1001-90", vm2 = "api:d-1001-91";
    const pv = planSite(vInv, tenant, mkDocs([]), defaults, "empty");
    const iv1 = pv.items.find((i) => i.key === vm1)!, iv2 = pv.items.find((i) => i.key === vm2)!;
    t("VM pre-pick: VMware model, host still guessed", iv1.mode === "vm" && iv1.modelOver === VM_MODELS.vmware && iv1.hostGuessed === true, JSON.stringify({ m: iv1.modelOver, h: iv1.host, g: iv1.hostGuessed }));
    t("VM pre-pick: defaultModelChoice", defaultModelChoice(iv1) === "vm:vmware" && defaultModelChoice(iv2) === "" && isVirtual(iv2) && iv2.modelOver === undefined);
    t("isVirtual: by model words, not for a plain switch", isVirtual({ ...pv.items.find((i) => i.key === sw1)!, dev: { ...iv1.dev } } as any) && !isVirtual(pv.items.find((i) => i.key === sw1)!));
    const dv = applySite(pv, new Set()).auvikDoc;
    const mv1 = memberOf(dv, vm1);
    t("VM pre-pick: box member has the model, not locked", mv1?.model === VM_MODELS.vmware && !mv1?.locked?.includes("model"), JSON.stringify(mv1));
    t("VM pre-pick: unknown vendor keeps Auvik's model", memberOf(dv, vm2)?.model === "Acme Box");

    // hand-picked VM model on a VM box member
    const ph = planSite(vInv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { models: { [vm1]: "vm:hyperv" } });
    const mh = memberOf(applySite(ph, new Set()).auvikDoc, vm1);
    t("hand vm:hyperv: member model and locked", mh?.model === VM_MODELS.hyperv && !!mh?.locked?.includes("model"), JSON.stringify(mh));
    const pa = planSite(vInv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { models: { [vm1]: "" } });
    t("explicit Auvik choice: no pre-pick", pa.items.find((i) => i.key === vm1)!.modelOver === undefined && memberOf(applySite(pa, new Set()).auvikDoc, vm1)?.model === "VMware Virtual Platform");

    // matched devices: a hand pick's field change is ticked by default (defaultOn), even when "Fill empty" would keep it
    const saved = applySite(base, new Set()).auvikDoc;
    const docs1 = mkDocs([{ id: 2, name: "EX Main Office (Auvik)", doc: saved }]);
    const pr = planSite(inv, tenant, docs1, defaults, "empty", undefined, undefined, { types: { [sw2]: "Patch panel" }, models: { [srv]: "tpl:" + tpl2.name } });
    const cType = pr.diff!.changes.find((c) => c.id === `fld:${sw2}:type`), cModel = pr.diff!.changes.find((c) => c.id === `fld:${srv}:model`);
    t("matched: hand-picked type and model changes are on by default", !!cType && cType.defaultOn && cType.to === "Patch panel" && !!cModel && cModel.defaultOn && cModel.to === tpl2.model, JSON.stringify([cType, cModel]));
    const pr0 = planSite(inv, tenant, docs1, defaults, "empty");
    t("matched: no override, no type change", !pr0.diff!.changes.some((c) => c.id === `fld:${sw2}:type`));
    const pkm = planSite(inv, tenant, docs1, defaults, "empty", undefined, undefined, { kinds: { [sw2]: "router" } });
    const cKind = pkm.diff!.changes.find((c) => c.id === `fld:${sw2}:type`);
    t("matched: kind override gives a ticked type change", !!cKind && cKind.defaultOn && cKind.to === "Router", JSON.stringify(cKind));
    const dr = applySite(pr, sel(pr)).auvikDoc;
    t("matched: saved manual and locked", byName(dr, "EX-SW02").type === "Patch panel" && byName(dr, "EX-SW02").source?.type === "manual" && !!byName(dr, "EX-SW02").locked?.includes("type") && byName(dr, "EX-SRV01").model === tpl2.model && byName(dr, "EX-SRV01").source?.model === "manual");
    const unt = new Set([...sel(pr)].filter((id) => id !== `fld:${sw2}:type`));
    const du = applySite(pr, unt).auvikDoc;
    t("matched: unticked hand pick is not saved and not locked", byName(du, "EX-SW02").type !== "Patch panel" && !byName(du, "EX-SW02").locked?.includes("type"));

    // re-import with no overrides and Overwrite: the manual values stay
    const pre = planSite(inv, tenant, mkDocs([{ id: 2, name: "EX Main Office (Auvik)", doc: dr }]), defaults, "overwrite");
    const dre = applySite(pre, sel(pre)).auvikDoc;
    t("re-import (Overwrite): manual type and model stay", byName(dre, "EX-SW02").type === "Patch panel" && byName(dre, "EX-SRV01").model === tpl2.model && byName(dre, "EX-SRV01").source?.model === "manual", JSON.stringify({ t: byName(dre, "EX-SW02").type, m: byName(dre, "EX-SRV01").model }));
    // and on a fresh import too
    const fr = applySite(planSite(inv, tenant, mkDocs([{ id: 2, name: "EX Main Office (Auvik)", doc: dt }]), defaults, "overwrite"), new Set()).auvikDoc;
    t("re-import (Overwrite, nothing ticked): type stays", byName(fr, "EX-SW02").type === "Patch panel");
    t("re-import: a Type pick (Patch panel) does not move the row", planSite(inv, tenant, mkDocs([{ id: 2, name: "EX Main Office (Auvik)", doc: dr }]), defaults, "overwrite").items.find((i) => i.key === sw2)!.kind === "switch");

    // a kind pick is kept on the next import (read back from the saved lock): no move back, no duplicate, nothing ticked for it
    const count = (d: Doc, n: string) => `${d.devices.filter((x) => x.name === n && !x.endpoints).length}/${d.devices.flatMap((x) => x.endpoints ?? []).filter((e) => e.name === n).length}`;
    for (const [n, kind, want] of [["EX-SW01", "endpoint", "0/1"], ["EX-PRN01", "server", "1/0"]] as const) {
      const k = keyOf(n);
      const d1 = applySite(planSite(inv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { kinds: { [k]: kind } }), new Set()).auvikDoc;
      t(`kind pick ${n} -> ${kind}: first import`, count(d1, n) === want, count(d1, n));
      t(`kind pick ${n}: keptKinds reads it back`, keptKinds(mkDocs([{ id: 2, name: "A", doc: d1 }]))[k] === kind);
      for (const fill of ["empty", "overwrite"] as const) {
        const p2 = planSite(inv, tenant, mkDocs([{ id: 2, name: "EX Main Office (Auvik)", doc: d1 }]), defaults, fill);
        const i2 = p2.items.find((i) => i.key === k)!;
        const on = p2.diff!.changes.filter((c) => c.defaultOn && (c.id.includes(":" + k + ":") || c.id.endsWith(":" + k) || c.id.endsWith("|" + k)));
        t(`kind pick ${n} re-import (${fill}): same kind, not a new hand pick, nothing ticked`, i2.kind === kind && !i2.kindOver && !on.length, `${i2.kind} ${on.map((c) => c.id)}`);
        const d2 = applySite(p2, sel(p2)).auvikDoc;
        t(`kind pick ${n} re-import (${fill}): stays in place, no duplicate`, count(d2, n) === want, count(d2, n));
      }
    }
    // explicit pick beats the kept kind
    const dS = applySite(planSite(inv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { kinds: { [prn]: "server" } }), new Set()).auvikDoc;
    t("baseKind over a kept kind is the kept kind", planSite(inv, tenant, mkDocs([{ id: 2, name: "A", doc: dS }]), defaults, "empty", undefined, undefined, { kinds: { [prn]: "storage" } }).items.find((i) => i.key === prn)!.baseKind === "server");
    t("explicit kind beats the kept one", planSite(inv, tenant, mkDocs([{ id: 2, name: "A", doc: dS }]), defaults, "empty", undefined, undefined, { kinds: { [prn]: "storage" } }).items.find((i) => i.key === prn)!.kind === "storage");
    // a tpl: pick on a VM row saves the model text but sets no template
    const pvt = planSite(vInv, tenant, mkDocs([]), defaults, "empty", undefined, undefined, { models: { [vm1]: "tpl:" + tpl2.name } }).items.find((i) => i.key === vm1)!;
    t("tpl pick on a VM row: model text only, no template", pvt.modelOver === tpl2.model && pvt.tplOver === undefined && pvt.tplName !== tpl2.name);
  }

  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
