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
import { apiItems, specsOf, toAuvikDevice, TO_PLACE_KINDS, type AuvikApiDevice } from "../src/auvik/api/map";
import { classify } from "../src/auvik/plan";
import { setOffColumn } from "../src/edit";

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

  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
