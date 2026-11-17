// npx tsx scripts/power.test.ts — power model (synthetic data only)
import { btu, catalogFor, feedFor, fmtW, isPdu, isUps, powerBudget } from "../src/power/model";
import { CATALOG } from "../src/edit";
import type { Device, Doc } from "../src/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

let pid = 100;
const mk = (id: number, name: string, type: string, extra: Partial<Device> = {}, ports: string[] = []): Device => ({
  id, name, type, u_size: 1, rack: 1, u: id, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front", model: "",
  ports: ports.map((n) => ({ id: pid++, name: n, type: "Power", label: "" })), ...extra,
});
const pidOf = (d: Device, n: string) => d.ports.find((p) => p.name === n)!.id;
let cid = 1;
const cable = (doc: Doc, a: number, b: number) => doc.cables.push({ id: cid++, a, b, color: "#000", type: "Power" });
const outs = (n: number) => Array.from({ length: n }, (_, i) => `Out${i + 1}`);

function build(watts = true) {
  pid = 100; cid = 1;
  const ups = mk(1, "UPS", "UPS", { model: "APC Smart-UPS SMT1500RM2U" }, ["Input", ...outs(6)]);
  const pdu = mk(2, "PDU", "PDU", {}, ["Input", ...outs(8)]);
  const srv = mk(3, "Server A", "Server", watts ? { power_w: 400 } : {}, ["PSU1", "PSU2"].map((s) => s));
  srv.ports.forEach((p) => (p.name = p.name === "PSU1" ? "Inlet 1" : "Inlet 2"));
  const sw = mk(4, "Switch", "Switch", watts ? { power_w: 100 } : {}, ["Inlet"]);
  const nas = mk(5, "NAS", "NAS", {}, ["Inlet"]);
  const doc: Doc = { v: 1, nid: 10, racks: [{ id: 1, name: "Rack A", u: 12, x: 0, y: 0 }], devices: [ups, pdu, srv, sw, nas], cables: [] };
  cable(doc, pidOf(ups, "Out1"), pidOf(pdu, "Input"));
  cable(doc, pidOf(pdu, "Out1"), pidOf(srv, "Inlet 1"));
  cable(doc, pidOf(pdu, "Out2"), pidOf(srv, "Inlet 2"));
  cable(doc, pidOf(pdu, "Out3"), pidOf(sw, "Inlet"));
  cable(doc, pidOf(pdu, "Out4"), pidOf(nas, "Inlet"));
  return { doc, ups, pdu, srv, sw, nas };
}

// catalog
const { doc, ups, pdu } = build();
eq("catalog rated", catalogFor(ups)?.rated_w, 1000);
eq("catalog none", catalogFor(pdu), null);
eq("battery pack not ups", isUps(mk(9, "BP", "UPS", { model: "APC Battery pack SRT48RMBP" })), false);
eq("ups is ups", isUps(ups), true);
eq("pdu is pdu", isPdu(pdu), true);
eq("catalog ups rated count", CATALOG.filter((t) => t.type === "UPS" && t.rated_w).length, 16);

// all unknown
{
  const b = build(false);
  const r = powerBudget(b.doc);
  eq("unknown rack", [r.racks[0].w, r.racks[0].unknown], [0, 3]);
  eq("unknown no pct", r.feeds.some((f) => f.pct !== null), false);
  eq("fmt unknown", fmtW(0, 3), "Power unknown");
}

// totals and feeds
{
  const r = powerBudget(doc);
  eq("rack", [r.racks[0].w, r.racks[0].unknown], [500, 1]);
  const pf = feedFor(r, 2)!, uf = feedFor(r, 1)!;
  eq("pdu feed", [pf.kind, pf.loadW, pf.unknown], ["pdu", 500, 1]);
  eq("ups feed", [uf.kind, uf.loadW, uf.pct, uf.ratedW], ["ups", 500, 50, 1000]);
  eq("doc totals", [r.w, r.unknown], [500, 1]);
  eq("feedFor missing", feedFor(r, 99), undefined);
}

// dual inlet across two PDUs
{
  const b = build();
  const pdu2 = mk(6, "PDU 2", "PDU", {}, ["Input", ...outs(8)]);
  b.doc.devices.push(pdu2);
  // move server's second inlet to PDU2 Out1
  b.doc.cables = b.doc.cables.filter((c) => c.b !== pidOf(b.srv, "Inlet 2"));
  cable(b.doc, pidOf(pdu2, "Out1"), pidOf(b.srv, "Inlet 2"));
  const r = powerBudget(b.doc);
  eq("dual split", [feedFor(r, 2)!.loadW, feedFor(r, 6)!.loadW], [300, 200]);
  eq("dual rack counts once", r.racks[0].w, 500);
}
{
  const b = build();
  const pdu2 = mk(6, "PDU 2", "PDU", {}, ["Input", ...outs(8)]);
  b.doc.devices.push(pdu2);
  b.doc.cables = b.doc.cables.filter((c) => c.b !== pidOf(b.srv, "Inlet 2") && c.a !== pidOf(b.pdu, "Out2"));
  b.doc.cables = b.doc.cables.filter((c) => c.a !== pidOf(b.pdu, "Out2"));
  cable(b.doc, pidOf(pdu2, "Out1"), pidOf(b.srv, "Inlet 2"));
  // PDU1 Out1 and PDU2 Out1 each feed server A: 200 each, plus PDU1 has switch 100
  const r = powerBudget(b.doc);
  eq("dual each 200", feedFor(r, 6)!.loadW, 200);
}

// loop
{
  const b = build();
  cable(b.doc, pidOf(b.pdu, "Out5"), pidOf(b.pdu, "Input"));
  const r = powerBudget(b.doc);
  eq("loop ok", [r.racks[0].w, feedFor(r, 2)!.loadW], [500, 500]);
}

// circuits
{
  const b = build();
  b.doc.racks[0].circuit = "LP-2 CKT 14";
  b.doc.racks.push({ id: 2, name: "Rack B", u: 12, x: 1, y: 0, circuit: "LP-2 CKT 14" });
  b.doc.devices.push(mk(7, "Big", "Server", { rack: 2, power_w: 700 }));
  let r = powerBudget(b.doc);
  eq("circuit", r.circuits, [{ name: "LP-2 CKT 14", volts: 120, w: 1200, unknown: 1, amps: 10, racks: ["Rack A", "Rack B"] }]);
  b.doc.racks[0].volts = 208;
  r = powerBudget(b.doc);
  eq("circuit 208", [r.circuits[0].volts, r.circuits[0].amps], [208, 5.8]);
}

eq("fmt unknown some", fmtW(1200, 2), "at least 1,200 W, 2 devices unknown");
eq("fmt one", fmtW(1200, 1), "at least 1,200 W, 1 device unknown");
eq("fmt plain", fmtW(1200, 0), "1,200 W");
eq("btu", btu(1000), 3412);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
