// Regression snapshot: .xlsx import and re-import must stay identical while the matching code changes.
// Synthetic data only. Record with UPDATE_SNAPSHOT=1; otherwise compare against the stored snapshot.
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAuvik } from "../src/auvik/parse";
import { buildItems, resolvePlan, hostCtxOf } from "../src/auvik/plan";
import { computeDiff, defaultSelection, Diff } from "../src/auvik/diff";
import { applyInPlace, applyPlan } from "../src/auvik/apply";
import { Doc } from "../src/types";
import { fixtureSheets } from "./fixtures/auvikFixture";

const FILE = new URL("./fixtures/auvik-xlsx-snapshot.json", import.meta.url);

// Strip fields that name the import source or change per run (source, tenant, imported date), keep the rest.
function snapshotOf(doc: Doc, diff: Diff): object {
  const d: any = JSON.parse(JSON.stringify(doc));
  for (const dev of d.devices || []) { delete dev.source; for (const ep of dev.endpoints || []) delete ep.source; }
  if (d.auvik) { delete d.auvik.source; delete d.auvik.tenant; delete d.auvik.imported; }
  const changes = diff.changes.map((c) => [c.id, c.cat, c.defaultOn]).sort((a: any, b: any) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { doc: d, changes };
}

const plansFor = (doc: Doc, sheets: ReturnType<typeof fixtureSheets>) => {
  const p = parseAuvik(sheets);
  const items = buildItems(p, hostCtxOf(doc));
  const plan = resolvePlan(p, items);
  return { plan, items, diff: computeDiff(doc, plan, items) };
};

const empty = (): Doc => ({ v: 1, nid: 1, racks: [], devices: [], cables: [] });

// Scenario A: first import into an empty document
const a0 = plansFor(empty(), fixtureSheets());
const { doc: docA } = applyPlan(empty(), a0.plan, { target: "new" }, a0.items);
const snapA = snapshotOf(docA, computeDiff(empty(), a0.plan, a0.items));

// Scenario B: re-import with a new device, a dropped device and a changed IP; EX-CORE ip is hand-locked
const docB: Doc = JSON.parse(JSON.stringify(docA));
const core = docB.devices.find((d) => d.name === "EX-CORE")!;
core.locked = [...(core.locked || []), "ip"];
const b = plansFor(docB, fixtureSheets([{ name: "EX-NEW", type: "Switch", model: "HP 2530-24G-PoE+", serial: "NEWser" }], ["EX-SW-02"], { "EX-CORE": "10.99.1.99" }));
applyInPlace(docB, b.plan, { target: "new" }, b.items, defaultSelection(b.diff));
const snapB = snapshotOf(docB, b.diff);

const got = { A: snapA, B: snapB };
if (process.env.UPDATE_SNAPSHOT) {
  fs.writeFileSync(FILE, JSON.stringify(got, null, 1) + "\n");
  console.log("snapshot written");
} else {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), JSON.parse(fs.readFileSync(FILE, "utf8")));
  console.log("PASS xlsx import/re-import matches snapshot");
}
