// Tests for hand editing of endpoints, ports and the cable display options. Synthetic data only.
import type { Device, Doc } from "../src/types";
import { addMember, addPort, deletePort, freePorts, groupOfSwitch, groupSwitch, moveMember, placeUnplaced, removeMember, setMember } from "../src/endpointEdit";
import { DENSE_PORTS, DEFAULT_OPTS, layoutStubs, stubText, visibleCables, dotCables } from "../src/cableView";
import { newCable } from "../src/edit";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const doc: Doc = { v: 1, nid: 1, racks: [{ id: 900, name: "R1", u: 42, x: 0, y: 0 }], devices: [], cables: [] };
const id = () => doc.nid++;
const mk = (name: string, type: string, nports: number, extra: Partial<Device> = {}): Device => {
  const d = { id: id(), name, type, u_size: 1, rack: 900, u: 1, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front",
    ports: Array.from({ length: nports }, (_, i) => ({ id: id(), name: String(i + 1), type: "RJ45", label: "" })), ...extra } as Device;
  doc.devices.push(d); return d;
};
const swA = mk("swA", "Switch", 8, { auvik_id: "sA" }), swB = mk("swB", "Switch", 8);
const gA = mk("Endpoints on swA", "Endpoints", 0, { rack: null, endpoints: [] });
const gB = mk("Endpoints on swB", "Endpoints", 0, { rack: null, endpoints: [] });
const vmb = mk("VMs", "Virtual machines", 0, { rack: null, endpoints: [] });

// add member with a port and a cable
const m1 = addMember(doc, gA.id, { name: "alice-pc", kind: "pc" }, swA.ports[2].id)!;
t("add: manual flag", m1.manual === true);
t("add: port created with member name", gA.ports.length === 1 && gA.ports[0].name === "alice-pc");
t("add: cable made", doc.cables.length === 1 && groupSwitch(doc, gA)?.id === swA.id);
t("add: switch port no longer free", !freePorts(doc, swA).some((p) => p.id === swA.ports[2].id));
const long = addMember(doc, gA.id, { name: "x".repeat(40) }, null)!;
t("add: port name truncated to 28", gA.ports[1].name.length === 28 && !!long);
t("add: no cable without a switch port", doc.cables.length === 1);
addMember(doc, gA.id, { name: "busy" }, swA.ports[2].id);
t("add to a busy port does not cable", doc.cables.length === 1);
removeMember(doc, gA.id, 2); removeMember(doc, gA.id, 1);
t("remove: uncabled members leave no ports", gA.ports.length === 1 && gA.endpoints!.length === 1);

// edit locks fields and keeps the port in step
setMember(doc, gA.id, 0, { name: "alice-laptop", port: "Gi1/0/3", ip: "10.1.1.5" });
t("set: locked lists changed fields", JSON.stringify([...m1.locked!].sort()) === JSON.stringify(["ip", "name", "port"]));
t("set: port renamed and relabelled", gA.ports[0].name === "alice-laptop" && gA.ports[0].label === "Gi1/0/3");
setMember(doc, gA.id, 0, { ip: "10.1.1.5" });
t("set: unchanged value does not add a lock", m1.locked!.length === 3);

// move
const ok = moveMember(doc, gA.id, 0, gB.id, swB.ports[0].id);
t("move: succeeds", ok);
t("move: gone from source with port and cable", gA.endpoints!.length === 0 && gA.ports.length === 0);
const moved = gB.endpoints![0];
t("move: keeps locks and fields", moved.name === "alice-laptop" && moved.ip === "10.1.1.5" && moved.locked!.includes("name"));
t("move: new switch cabled", groupSwitch(doc, gB)?.id === swB.id && doc.cables.length === 1);
t("move: refuses a different kind of box", !moveMember(doc, gB.id, 0, vmb.id, null));

// remove
removeMember(doc, gB.id, 0);
t("remove: member, port and cable gone", gB.endpoints!.length === 0 && gB.ports.length === 0 && doc.cables.length === 0);

// VM box
const v = addMember(doc, vmb.id, { name: "vm1" })!;
t("vm: no port, kind vm", vmb.ports.length === 0 && v.kind === "vm");

// unplaced
doc.auvik = { site: "S", imported: "2026-01-01", virtual: [], unplaced: [
  { name: "cam1", type: "IP camera", model: "", ip: "10.0.0.9", mac: "aa", status: "Up", reason: "" },
  { name: "ph1", type: "VoIP phone", model: "", ip: "", mac: "", status: "Up", reason: "" }] };
const gid = placeUnplaced(doc, 0, swB.id, swB.ports[1].id);
const ng = doc.devices.find((d) => d.id === gid)!;
t("place: group created off-rack, named", !!ng && ng.rack == null && ng.name === "Endpoints on swB" && ng.type === "Endpoints");
t("place: member added and removed from unplaced", ng.endpoints![0].name === "cam1" && !!ng.endpoints![0].manual && doc.auvik!.unplaced.length === 1);
t("place: cabled and found by switch", groupOfSwitch(doc, swB.id)?.id === ng.id);
const gid2 = placeUnplaced(doc, 0, swB.id, null);
t("place: second one joins the same group", gid2 === ng.id && ng.endpoints!.length === 2 && ng.endpoints![1].kind === "phone");
t("place: bad index returns 0", placeUnplaced(doc, 5, swA.id) === 0);
const sa = mk("fresh", "Switch", 2, { auvik_id: "sF" });
doc.auvik!.unplaced.push({ name: "pr", type: "Printer", model: "", ip: "", mac: "", status: "Up", reason: "" });
const gnId = placeUnplaced(doc, 0, sa.id), gn = doc.devices.find((d) => d.id === gnId)!;
t("place: group id derives from switch auvik id", gn.auvik_id === "g:sF");

// ports
const p = addPort(doc, swA.id, "SFP+")!;
newCable(doc, p.id, swA.ports[5].id);
const before = doc.cables.length;
deletePort(doc, swA.id, p.id);
t("ports: add and delete (cable goes too)", !swA.ports.some((x) => x.id === p.id) && doc.cables.length === before - 1);

// cable visibility
const doc2: Doc = { v: 1, nid: 100, racks: [], cables: [], devices: [] };
const mk2 = (id0: number, name: string, type: string, rack: number | null): Device =>
  ({ id: id0, name, type, u_size: 1, rack, u: 1, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front", ports: [{ id: id0 * 10, name: "1", type: "RJ45", label: "" }, { id: id0 * 10 + 1, name: "2", type: "RJ45", label: "" }] } as Device);
doc2.devices.push(mk2(1, "a", "Switch", 1), mk2(2, "b", "Switch", 1), mk2(3, "c", "Server", 1), mk2(4, "grp", "Endpoints", null), mk2(5, "vm", "Virtual machines", null));
doc2.cables.push({ id: 1, a: 10, b: 20, color: "#fff" }, { id: 2, a: 11, b: 30, color: "#fff" }, { id: 3, a: 21, b: 40, color: "#fff" }, { id: 4, a: 31, b: 50, color: "#fff" });
const vc = (o: Partial<typeof DEFAULT_OPTS>, sel: any = null, hov: number | null = null) => [...visibleCables(doc2, { ...DEFAULT_OPTS, ...o }, sel, hov)].sort().join(",");
t("vis: all", vc({}) === "1,2,3,4");
t("vis: none", vc({ show: "none" }) === "");
t("vis: selected without selection", vc({ show: "selected" }) === "");
t("vis: selected device", vc({ show: "selected" }, { kind: "dev", id: 3 }) === "2,4");
t("vis: selected cable", vc({ show: "selected" }, { kind: "cable", id: 1 }) === "1");
t("vis: selected plus hover", vc({ show: "selected" }, { kind: "cable", id: 1 }, 2) === "1,3");
t("vis: hide endpoint cables", vc({ hideEndpoints: true }) === "1,2");
t("vis: hide endpoints combines with selected", vc({ hideEndpoints: true, show: "selected" }, { kind: "dev", id: 2 }) === "1");
t("dots: only when show is none", dotCables(doc2, DEFAULT_OPTS).size === 0 && dotCables(doc2, { ...DEFAULT_OPTS, show: "none" }).size === 4 && dotCables(doc2, { show: "none", style: "routed", hideEndpoints: true }).size === 2);

// stubs
const st = stubText({ dev: "core-switch-01", port: "Gi1/0/12" });
t("stub text", st.full === "→ core-switch-01 :Gi1/0/12" && st.short.length < 26);
const ends = (n: number, dir = 1) => Array.from({ length: n }, (_, i) => ({ cable: i + 1, dev: 1, pt: [10 + i * 12, 50] as [number, number], dir, far: { dev: "x", port: String(i) } }));
const s = layoutStubs(ends(6));
t("stubs: alternate lengths", s[0].y2 - s[0].y === 18 && s[1].y2 - s[1].y === 30 && s[2].y2 - s[2].y === 18);
t("stubs: not dense shows labels", s.every((x) => x.labelOn));
const up = layoutStubs(ends(2, -1));
t("stubs: dir up goes up", up[0].y2 < up[0].y);
t("stubs: dense hides labels", layoutStubs(ends(DENSE_PORTS + 1)).every((x) => !x.labelOn));

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
