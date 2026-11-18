// npx tsx scripts/visit.test.ts — site visit model (synthetic data only)
import { applyStep, finishVisit, posLabel, visitList } from "../src/visit/model";
import type { Device, Doc } from "../src/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`);
};
const mk = (id: number, name: string, u: number, extra: Partial<Device> = {}): Device => ({
  id, name, type: "Server", u_size: 1, rack: 1, u, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front", model: "", ports: [], ...extra,
});
const mkDoc = (devices: Device[]): Doc => ({
  v: 1, nid: 100, racks: [{ id: 1, name: "Example IT", u: 42, x: 0, y: 0 }, { id: 2, name: "Other", u: 42, x: 300, y: 0 }], devices, cables: [],
});
const dev = (doc: Doc, id: number) => doc.devices.find((d) => d.id === id)!;
const T = "2026-11-17";

const list = mkDoc([
  mk(1, "Low", 1), mk(2, "Top", 40, { u_size: 2 }),
  mk(3, "Right", 20, { half: true, side: 1 }), mk(4, "Left", 20, { half: true, side: 0 }),
  mk(5, "Fill", 30, { type: "Blank" }), mk(6, "Mgr", 31, { type: "Cable manager" }),
  mk(7, "Loose", 10, { rack: null }), mk(8, "Elsewhere", 41, { rack: 2 }),
]);
eq("order top first", visitList(list, 1), [2, 4, 3, 1]);
eq("other rack excluded", visitList(list, 1).includes(8), false);

const one = (extra: Partial<Device> = {}) => mkDoc([mk(1, "Example Box", 5, { serial: "S1", ...extra })]);
let doc = one();
eq("confirm unchanged", applyStep(doc, 1, "ok", { name: "Example Box", serial: " S1 " }, T), "confirmed");
eq("confirm stamps", dev(doc, 1).last_verified, T);
doc = one();
eq("correct serial", applyStep(doc, 1, "ok", { serial: "S2" }, T), "corrected");
eq("correct serial value", dev(doc, 1).serial, "S2");
doc = one({ asset_tag: "A1" });
eq("clear field", applyStep(doc, 1, "ok", { asset_tag: "" }, T), "corrected");
eq("clear field key", "asset_tag" in dev(doc, 1), false);
doc = one();
eq("empty name kept", applyStep(doc, 1, "ok", { name: "  " }, T), "confirmed");
eq("empty name value", dev(doc, 1).name, "Example Box");
doc = one({ status: "spare" });
eq("status active deletes", applyStep(doc, 1, "ok", { status: "active" }, T), "corrected");
eq("status key absent", "status" in dev(doc, 1), false);
doc = one();
eq("status active no-op", applyStep(doc, 1, "ok", { status: "active" }, T), "confirmed");

doc = one();
eq("missing", applyStep(doc, 1, "missing", {}, T), "missing");
eq("missing off rack", dev(doc, 1).rack, null);
eq("missing offline", dev(doc, 1).status, "offline");
eq("missing fx finite", Number.isFinite(dev(doc, 1).fx), true);
eq("missing no stamp", dev(doc, 1).last_verified, undefined);

doc = one();
const before = JSON.stringify(doc);
eq("gone", applyStep(doc, 99, "ok", {}, T), "gone");
eq("gone unchanged", JSON.stringify(doc), before);

doc = one();
applyStep(doc, 1, "missing", {}, T);
eq("matches after missing", applyStep(doc, 1, "ok", {}, T), "confirmed");
eq("stays off rack", dev(doc, 1).rack, null);
eq("stamped after missing", dev(doc, 1).last_verified, T);

doc = one();
eq("finish stamps", finishVisit(doc, 1, { confirmed: 1, corrected: 0, missing: 0 }, T), true);
eq("finish rack stamped", doc.racks[0].last_verified, T);
doc = one();
eq("finish none", finishVisit(doc, 1, { confirmed: 0, corrected: 0, missing: 0 }, T), false);
eq("finish none unstamped", doc.racks[0].last_verified, undefined);

eq("pos U12", posLabel(mk(1, "a", 12)), "U12");
eq("pos range", posLabel(mk(1, "a", 12, { u_size: 2 })), "U12–13");
eq("pos left", posLabel(mk(1, "a", 12, { half: true, side: 0 })), "U12 · left");
eq("pos middle", posLabel(mk(1, "a", 12, { half: true, cols: 3, side: 1 })), "U12 · middle");
eq("pos rear", posLabel(mk(1, "a", 12, { face: "rear" })), "U12 · rear");

if (fail) { console.log(`visit: ${fail} failed`); process.exit(1); }
console.log("visit: all passed");
