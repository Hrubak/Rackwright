// Auvik API import tests (sections are added task by task). Synthetic data only.
import { readFileSync } from "node:fs";
import { setSource, isManual, markManual } from "../src/source";
import { readXlsx } from "../src/auvik/xlsx";
import { parseAuvik } from "../src/auvik/parse";
import { buildItems, resolvePlan, hostCtxOf } from "../src/auvik/plan";
import { computeDiff } from "../src/auvik/diff";
import { applyInPlace } from "../src/auvik/apply";
import { makeXlsx, devices } from "./fixtures/auvikFixture";
import type { Device, Doc } from "../src/types";

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

  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
