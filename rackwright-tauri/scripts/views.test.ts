// Tests for the pure parts of the views and live drag. Synthetic data only.
import type { Device, Doc } from "../src/types";
import { infraLayout, infraEdges, layerOf, isPowerCable } from "../src/views/infra";
import { switchPorts, portGroups, cmpNames } from "../src/views/switchPorts";
import { flattenEndpoints, filterEndpoints, sortEndpoints, endpointsCsv } from "../src/views/endpoints";
import { kindOf, kindCounts } from "../src/views/kinds";
import { LiveRouter, provisionalDoc, targetKey } from "../src/liveRoute";
import { resolveTarget } from "../src/edit";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

let nid = 1;
const doc: Doc = { v: 1, nid: 1000, racks: [{ id: 900, name: "R1", u: 42, x: 0, y: 0 }], devices: [], cables: [] };
function dev(name: string, type: string, ports: [string, string][], extra: Partial<Device> = {}): Device {
  const d = { id: nid++, name, type, u_size: 1, rack: 900, u: nid, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front",
    ports: ports.map(([n, ty]) => ({ id: nid++, name: n, type: ty, label: "" })), ...extra } as Device;
  doc.devices.push(d); return d;
}
let cid = 5000;
const cable = (a: number, b: number, type = "Cat6") => { doc.cables.push({ id: cid++, a, b, color: "#fff", type }); };
const P = (d: Device, n: string) => d.ports.find((p) => p.name === n)!.id;
const rj = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [String(i + 1), "RJ45"]);

const fw = dev("fw", "Firewall", rj(4), { ip: "10.0.0.1" });
const core = dev("core", "Switch", [...rj(24), ["25", "SFP+"], ["26", "SFP+"], ["psu", "Power"]], { ip: "10.0.0.2", auvik_macs: ["aa:bb:cc:00:00:01"] });
const acc = dev("access", "Switch", rj(8));
const srv = dev("srv1", "Server", [["eth0", "RJ45"], ["psu", "Power"]], { ip: "10.0.1.5" });
const pdu = dev("pdu", "PDU", [["out1", "Power"]]);
const grp = dev("EP core", "Endpoints", [["alice-pc", "RJ45"], ["desk-7", "RJ45"], ["lobby-printer", "RJ45"]], {
  endpoints: [
    { name: "alice-pc", type: "Computer", model: "", ip: "10.0.5.2", mac: "11:22", port: "Gi1/0/3", status: "Up", kind: "pc" },
    { name: "desk-7", type: "IP Phone", model: "Yealink T46", ip: "10.0.5.3", mac: "11:23", port: "Gi1/0/4", status: "Up" },
    { name: "lobby-printer", type: "Printer", model: "", ip: "10.0.5.4", mac: "11:24", port: "Gi1/0/5", status: "Down", kind: "printer" },
  ],
});
const vms = dev("VMs on srv1", "Virtual machines", [], { vm_host: srv.id, endpoints: [
  { name: "web", type: "VM", model: "", ip: "10.0.1.10", mac: "", port: "", status: "Up", kind: "vm" }, { name: "db", type: "VM", model: "", ip: "10.0.1.11", mac: "", port: "", status: "Up", kind: "vm" }] });
doc.auvik = { site: "x", imported: "", virtual: [], unplaced: [{ name: "old-nas", type: "NAS", model: "", ip: "10.0.9.9", mac: "9", status: "Up", reason: "" }] };
cable(P(fw, "1"), P(core, "25"), "DAC");
cable(P(fw, "2"), P(core, "26"), "DAC");
cable(P(core, "1"), P(acc, "8"));
cable(P(core, "2"), P(srv, "eth0"));
cable(P(pdu, "out1"), P(srv, "psu"), "C13 Power");
cable(P(core, "3"), P(grp, "alice-pc"));
cable(P(core, "4"), P(grp, "desk-7"));
cable(P(acc, "1"), P(grp, "lobby-printer"));

// ---- infra
const edges = infraEdges(doc);
t("edges merge by pair (2 fw-core cables = 1 edge, count 2)", edges.filter((e) => e.a === fw.id && e.b === core.id).length === 1 && edges.find((e) => e.a === fw.id)!.count === 2);
t("power cable detected and kept separate", isPowerCable(doc, doc.cables.find((c) => c.type === "C13 Power")!) && edges.some((e) => e.power));
t("endpoint groups are not infra edges", !edges.some((e) => e.a === grp.id || e.b === grp.id));
const layers = layerOf(doc, edges);
t("layers: fw 0, core 1, access 2, server/pdu 3", layers.get(fw.id) === 0 && layers.get(core.id) === 1 && layers.get(acc.id) === 2 && layers.get(srv.id) === 3 && layers.get(pdu.id) === 3);
const lay = infraLayout(doc);
const ny = (d: Device) => lay.nodes.find((n) => n.id === d.id)!.y;
t("rows go top to bottom", ny(fw) < ny(core) && ny(core) < ny(acc) && ny(acc) < ny(srv));
t("endpoint chip sits under its switch", (() => { const c = lay.extras.find((e) => e.kind === "endpoints")!; const n = lay.nodes.find((x) => x.id === core.id)!; return c.host === core.id && c.y > n.y + n.h && c.x === n.x; })());
t("chip text counts kinds", lay.extras.find((e) => e.kind === "endpoints")!.title === "3 endpoints" && lay.extras.find((e) => e.kind === "endpoints")!.sub.includes("1 phone"), lay.extras[0]?.sub);
t("VM box hangs under its host", (() => { const v = lay.extras.find((e) => e.kind === "vm")!; return v.host === srv.id && v.title === "VMs on srv1: 2"; })());
t("no overlapping boxes", (() => {
  const b = [...lay.nodes, ...lay.extras];
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const p = b[i], q = b[j];
    if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) return false;
  }
  return true;
})());
t("layout is deterministic", JSON.stringify(infraLayout(doc)) === JSON.stringify(infraLayout(JSON.parse(JSON.stringify(doc)))));

// ---- switch ports
const infos = switchPorts(doc, core);
t("power port left out of the grid", !infos.some((i) => i.port.type === "Power") && infos.length === 26);
t("numeric port order (2 before 10)", cmpNames("2", "10") < 0 && infos[1].port.name === "2" && infos[9].port.name === "10");
t("RJ45 first, SFP+ after", infos[23].port.type === "RJ45" && infos[24].port.type === "SFP+");
const byName = (n: string) => infos.find((i) => i.port.name === n)!;
t("infra port shows far device", byName("1").kind === "infra" && byName("1").far === "access" && byName("2").far === "srv1" && byName("2").ip === "10.0.1.5");
t("uplink to firewall", byName("25").far === "fw" && byName("25").ip === "10.0.0.1");
t("endpoint-group port shows member", byName("3").far === "alice-pc" && byName("3").kind === "pc" && byName("3").mac === "11:22" && byName("3").farPort === "Gi1/0/3");
t("kind falls back to type text", byName("4").kind === "phone");
t("empty port", byName("10").kind === "empty" && byName("10").far === "");
const groups = portGroups(infos);
t("groups: two-row copper + uplinks", groups.length === 2 && groups[0].rows.length === 2 && groups[0].rows[0][0].port.name === "1" && groups[0].rows[1][0].port.name === "2" && groups[1].label === "Uplinks");
t("small switch is one row", portGroups(switchPorts(doc, acc))[0].rows.length === 1);

// ---- endpoints
const rows = flattenEndpoints(doc);
t("flatten: 3 group + 2 vm + 1 unplaced", rows.length === 6 && rows.filter((r) => r.source === "unplaced").length === 1);
t("switch and port from the cable", rows.find((r) => r.name === "alice-pc")!.switch === "core" && rows.find((r) => r.name === "alice-pc")!.port === "3");
t("member on another switch", rows.find((r) => r.name === "lobby-printer")!.switch === "access");
t("vm host as switch", rows.find((r) => r.name === "web")!.switch === "srv1" && rows.find((r) => r.name === "web")!.kind === "vm");
t("unplaced kind guessed", kindOf({ type: "NAS" }) === "other" && kindOf({ type: "Laptop" }) === "pc");
t("filter by kind and text", filterEndpoints(rows, new Set(["pc", "phone"]), "").length === 2 && filterEndpoints(rows, new Set(), "10.0.1").length === 2 && filterEndpoints(rows, new Set(), "core alice").length === 1);
t("sort by ip numeric, empties last", sortEndpoints(rows, "ip", 1)[0].ip === "10.0.1.10" && sortEndpoints(rows, "mac", 1).at(-1)!.mac === "");
t("csv quotes", endpointsCsv([{ ...rows[0], name: 'a,"b"' }]).split("\n")[1].startsWith('"a,""b""",'));
t("kindCounts", kindCounts([{ kind: "phone" }, { kind: "phone" }, { kind: "pc" }, { kind: "iot" }, { kind: "printer" }]) === "2 phones, 1 PC, 1 IoT device…");

// ---- live drag
const target = resolveTarget(doc, srv, 100, 100, { ox: 0, oy: 0 });
t("provisional doc moves only the dragged device", (() => {
  const pd = provisionalDoc(doc, srv.id, { kind: "float", fx: 700.4, fy: 20 })!;
  return pd.devices.find((d) => d.id === srv.id)!.rack === null && pd.devices.find((d) => d.id === srv.id)!.fx === 700 && doc.devices.find((d) => d.id === srv.id)!.rack === 900 && pd.cables === doc.cables;
})());
t("invalid rack target gives no provisional doc", provisionalDoc(doc, srv.id, { kind: "rack", r: doc.racks[0], u: 1, side: 0, p: { ok: false, why: "x" } }) === null);
t("target keys differ per slot", targetKey(1, { kind: "float", fx: 1, fy: 2 }) !== targetKey(1, { kind: "float", fx: 1, fy: 3 }) && target.kind !== "none");

async function liveTest() {
  let clock = 0, inflight = 0, maxInflight = 0;
  const calls: number[] = [], got: number[] = [];
  const pend: (() => void)[] = [];
  const mk = (n: number): Doc => ({ ...doc, nid: n });
  const lr = new LiveRouter(
    (d) => { inflight++; maxInflight = Math.max(maxInflight, inflight); calls.push(d.nid); return new Promise((res) => pend.push(() => { inflight--; res({ routes: { routes: [], hints: [] }, ports: [] }); })); },
    (d) => got.push(d.nid), () => {}, 30, () => clock);
  lr.request(mk(1), "front"); lr.request(mk(2), "front"); lr.request(mk(3), "front");
  t("live: one request in flight, latest kept", calls.length === 1 && calls[0] === 1 && maxInflight === 1);
  pend.shift()!(); await new Promise((r) => setTimeout(r, 0));
  t("live: result for first delivered", got.join() === "1");
  clock = 10; await new Promise((r) => setTimeout(r, 60)); // min gap uses the injected clock, so this waits on the timer
  clock = 100; await new Promise((r) => setTimeout(r, 60));
  t("live: next request is the newest (3), 2 skipped", calls.join() === "1,3", calls.join());
  lr.cancel(); pend.shift()!(); await new Promise((r) => setTimeout(r, 0));
  t("live: cancelled answer is dropped", got.join() === "1");
}
liveTest().then(() => { console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0); });
