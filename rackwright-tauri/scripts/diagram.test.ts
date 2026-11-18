// npx tsx scripts/diagram.test.ts — diagram models to an import spec (synthetic data only)
import { diagramToSpec } from "../src/imports/diagram";
import type { DiagramModel, DiagramNode } from "../src/imports/diagram";
import { planImport } from "../src/imports/plan";
import { applyImport } from "../src/imports/apply";
import type { Doc } from "../src/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const node = (id: string, title: string, label: string, x: number, y: number, w: number, h: number, data: Record<string, string> = {}): DiagramNode => ({ id, title, label, data, x, y, w, h });
const model = (nodes: DiagramNode[], links: DiagramModel["links"] = [], yUp = true, source = "test"): DiagramModel => ({ source, nodes, links, yUp });
const RACK = node("r", "Rack", "EX-RACK1\n42U", 0, 0, 20, 77);
const inRack = node("s", "Switch", "EX-SW01", 2, 1.75 * 9, 16, 1.75);
const outside = node("o", "Server", "EX-SRV01", 100, 0, 16, 1.75);
const E = { endUsers: false };

{
  const sp = diagramToSpec([model([RACK])], E);
  eq("rack shape becomes rack", [sp.kind, sp.racks[0]], ["diagram", { name: "EX-RACK1", u: 42 }]);
}
{
  const d = diagramToSpec([model([RACK, inRack])], E).devices[0];
  eq("device in rack gets U", [d.rack, d.u, d.height, d.type], ["EX-RACK1", 10, 1, "Switch"]);
}
{
  const d = diagramToSpec([model([outside])], E).devices[0];
  eq("device outside rack has no position", [d.rack === undefined, d.u], [true, null]);
}
{
  const d = diagramToSpec([model([node("a", "Server", "EX-LABEL", 0, 0, 5, 5, { "Network Name": "EX-SRV02" })])], E).devices[0];
  eq("name from shape data", d.name, "EX-SRV02");
}
{
  const d = diagramToSpec([model([node("a", "Switch", "EX-SW01\n10.0.0.2/24\nCore switch", 0, 0, 5, 5)])], E).devices[0];
  eq("ip from label", [d.name, d.fields.ip], ["EX-SW01", "10.0.0.2"]);
  eq("extra lines to role", d.fields.role, "Core switch");
}
{
  const cloud = node("c", "Cloud", "Internet", 0, 0, 5, 5);
  const pc = node("p", "Laptop", "EX-PC01", 10, 0, 5, 5);
  const sp = diagramToSpec([model([cloud, pc, outside])], E);
  eq("cloud skipped", sp.devices.map((d) => d.name), ["EX-SRV01"]);
  eq("end users skipped", sp.warnings, [
    "Left out 1 end-user device(s) (PCs, printers, phones…). Tick “Include end-user devices” to bring them in.",
    "Ignored 1 shape(s) that look like labels, titles, clouds or decoration.",
  ]);
  const kept = diagramToSpec([model([cloud, pc, outside])], { endUsers: true });
  eq("end users kept", kept.devices.map((d) => d.name), ["EX-PC01", "EX-SRV01"]);
  eq("end users kept warnings", kept.warnings.length, 1);
}
{
  const m1 = model([node("a", "Switch", "EX-SW01", 0, 0, 5, 5)]);
  const m2 = model([node("b", "Switch", "EX-SW01\n10.0.0.2", 0, 0, 5, 5)], [], false, "other");
  const sp = diagramToSpec([m1, m2], E);
  eq("duplicate names merge", [sp.devices.length, sp.devices[0].fields.ip], [1, "10.0.0.2"]);
}
const sw = node("a", "Switch", "EX-SW01", 0, 0, 5, 5), srv = node("b", "Server", "EX-SRV01", 20, 0, 5, 5);
{
  const sp = diagramToSpec([model([sw, srv], [{ a: "a", b: "b", text: "Gi1/0/1 - eth0" }]), model([sw, srv], [{ a: "a", b: "b", text: "" }], false, "svg")], E);
  eq("link with ports", sp.links, [{ a: "EX-SW01", ap: "Gi1/0/1", b: "EX-SRV01", bp: "eth0" }]);
}

{
  const sp = diagramToSpec([model([RACK, inRack, outside])], E);
  eq("flag set for outside device", sp.devices.filter((d) => d.offRackIfNew).length > 0 && sp.devices.filter((d) => d.rack !== undefined).every((d) => !d.offRackIfNew), true);
}
const adoc = (): Doc => ({ v: 1, nid: 100, racks: [{ id: 1, name: "EX-R1", u: 42, x: 0, y: 0 }], cables: [], devices: [] }) as unknown as Doc;
const opts = { rackId: 1, newRackName: "New", newRackU: 42, growRack: false };
{
  const d = adoc();
  const sp = diagramToSpec([model([RACK, inRack, outside, srv, sw].filter((n, i, a) => a.indexOf(n) === i), [{ a: "s", b: "o", text: "Gi1/0/1 - eth0" }])], E);
  const lg = applyImport(d, planImport(d, sp, opts), opts);
  const p2 = planImport(d, sp, opts);
  eq("diagram re-import is same", [lg.added > 0, p2.rows.map((r) => r.action).every((a) => a === "same"), p2.rows.some((r) => r.on)], [true, true, false]);
  eq("re-import cable once", d.cables.length, 1);
  const o = d.devices.find((x) => x.name === "EX-SRV01")!;
  eq("outside device off-rack, not in target", o.rack, null);
}
{
  const d = adoc();
  d.devices.push({ id: 5, name: "EX-SW01", type: "Switch", rack: 1, u: 20, u_size: 1, side: 0, face: "front", ports: [] } as unknown as Doc["devices"][number]);
  const sp = diagramToSpec([model([node("a", "Switch", "EX-SW01", 100, 0, 5, 5), node("n", "Server", "EX-NEW", 120, 0, 5, 5)])], E);
  const pl = planImport(d, sp, opts);
  eq("preview says off-rack", pl.rows.map((r) => r.offRack === true), [false, true]);
  applyImport(d, pl, opts);
  const a = d.devices.find((x) => x.name === "EX-SW01")!, n = d.devices.find((x) => x.name === "EX-NEW")!;
  eq("matched device not moved, new off-rack", [a.rack, a.u, n.rack], [1, 20, null]);
}

if (fail) { console.log(`diagram: ${fail} failed`); process.exit(1); }
console.log("diagram: all passed");
