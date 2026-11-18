// npx tsx scripts/imports.test.ts — RackMap text and CSV readers (synthetic data only)
import { parseRackmapText } from "../src/imports/rackmap";
import { buildFromText } from "../src/edit";
import type { Doc } from "../src/types";
import { parseLayout, placeLayout, guessHeight } from "../src/imports/layout";
import { readImport } from "../src/imports/read";
import { csvToSpec, looksDelimited, parseDelimited } from "../src/imports/csv";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const rm = parseRackmapText("RACK EX-R1 42U\nU40 switch EX-SW01 ip=10.0.0.2 model=ICX7150\nU30-31 server EX-HV01\nLINK EX-SW01:1 -> EX-HV01:NIC1 cable=Cat6\nUNRACKED ap EX-AP01\n");
eq("rackmap rack line", { name: rm.racks[0].name, u: rm.racks[0].u }, { name: "EX-R1", u: 42 });
const sw = rm.devices[0];
eq("rackmap device", [sw.name, sw.type, sw.u, sw.rack, sw.fields.ip, sw.fields.model, sw.line], ["EX-SW01", "Switch", 40, "EX-R1", "10.0.0.2", "ICX7150", 2]);
eq("rackmap span", [rm.devices[1].u, rm.devices[1].height], [30, 2]);
eq("rackmap link", rm.links[0], { a: "EX-SW01", ap: "1", b: "EX-HV01", bp: "NIC1", type: "Cat6" });
eq("rackmap unracked", [rm.devices[2].rack, rm.devices[2].type], [null, "Other"]);
eq("rackmap kind", rm.kind, "rackmap");
const rr = parseRackmapText("RACK EX-R1 42U\nU1 server EX-A\nwhat is this\nand this\n");
eq("rackmap ratio", rr.ratio, 0.5);
eq("rackmap warnings", rr.warnings.map((w) => w.startsWith("Line ")), [true, true]);

const inv = csvToSpec("Name,Type,Rack,U,Model,IP\nEX-SW01,Switch,EX-R1,40,ICX7150,10.0.0.2\nEX-NAS01,NAS,EX-R1,10,DS920,10.0.0.9\n");
eq("csv inventory", [inv.kind, inv.devices.length, inv.racks.length], ["inventory", 2, 1]);
eq("csv inventory rows", [inv.devices[0].line, inv.devices[1].line, inv.devices[1].type, inv.devices[0].fields.ip], [2, 3, "Storage", "10.0.0.2"]);
const cab = csvToSpec("From,From Port,To,To Port\nEX-SW01,1,EX-HV01,NIC1\n");
eq("csv cabling", [cab.kind, cab.links.length], ["cabling", 1]);

const messy = "﻿Name;Rack;Notes\r\nEX-A;\"Rack, top\";\"say \"\"hi\"\"\"\r\n\r\nEX-B;R2;ok\r\n";
eq("csv quirks", parseDelimited(messy), [["Name", "Rack", "Notes"], ["EX-A", "Rack, top", 'say "hi"'], ["EX-B", "R2", "ok"]]);
const q = csvToSpec(messy);
eq("csv quirks lines", q.devices.map((d) => [d.name, d.rack, d.line]), [["EX-A", "Rack, top", 2], ["EX-B", "R2", 4]]);
eq("csv tab", parseDelimited("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);

eq("looksDelimited csv", looksDelimited("Name,Type,Rack,U,Model,IP\nEX-SW01,Switch,EX-R1,40,ICX7150,10.0.0.2\nEX-NAS01,NAS,EX-R1,10,DS920,10.0.0.9\n"), true);
eq("looksDelimited layout", looksDelimited("EX-SW01\nEX-HV01\n(empty)\nEX-NAS01\n"), false);


const hn = csvToSpec("Hostname,Model\nex-a,x\nex-b,y\n");
eq("csv hostname-only", hn.devices.map((d) => [d.name, d.fields.hostname, d.fields.model]), [["ex-a", "ex-a", "x"], ["ex-b", "ex-b", "y"]]);
const as = csvToSpec("Asset,Model\nex-a,x\n");
eq("csv asset-only", as.devices.map((d) => [d.name, d.fields.asset_tag]), [["ex-a", "ex-a"]]);
const ut = csvToSpec("Name,Type\nEX-A,Widget\n");
eq("csv unknown type", ut.devices.map((d) => [d.type, d.specs.type]), [[null, "Widget"]]);
const gt = csvToSpec("Name,Type,Model\nEX-A,Widget,ICX7150\n");
eq("csv unknown type guessed", [gt.devices[0].type, gt.devices[0].specs.type], ["Switch", "Widget"]);
const mq = csvToSpec('Name,Notes\nEX,19" rack\nEX2,x\n');
eq("csv mid-cell quote", [mq.devices.map((d) => [d.name, d.fields.notes]), mq.warnings], [[["EX", '19" rack'], ["EX2", "x"]], []]);
const uq = csvToSpec('Name,Notes\nEX,"open\nEX2,x\n');
eq("csv unterminated quote", uq.warnings, ["The file ends inside a quoted cell."]);

const layText = [
  "[Front of the rack full-width]", "HP ProLiant DL380 Gen10 (VM HOST) esxi.example.com", "[Back of Rack]", "1 U RACK EMPTY SPACE", "(EX-MDF-STACK)",
  "48Port Ruckus POE", "48Port Ruckus POE", "Carrier equipment connected via crossover cable from the router to the phone switch.", "KVM Switch",
  "EX-FW01 | Phone Switch (should be decommissioned)", "[Front of the Rack]", "APC Smart-UPS X 3000", "APC Battery Pack",
].join("\n");
const lay = parseLayout(layText);
const kinds = (k: string) => lay.devices.filter((d) => (d.kind || "device") === k);
eq("layout counts", [kinds("device").length, kinds("empty").length, kinds("note").length, lay.notes.length], [8, 1, 1, 0]);
eq("layout kind", lay.kind, "layout");
eq("layout dl380", [lay.devices[0].face, lay.devices[0].rack, lay.devices[0].height], ["both", undefined, 2]);
const emp = kinds("empty")[0], stack = lay.devices.filter((d) => d.name === "48Port Ruckus POE" && d.group === "EX-MDF-STACK");
eq("layout rear", [emp.face, emp.height, stack.map((d) => d.face)], ["rear", 1, ["rear", "rear"]]);
eq("layout group ends at note", lay.devices.filter((d) => d.group).map((d) => d.name), ["48Port Ruckus POE", "48Port Ruckus POE"]);
const ph = lay.devices.find((d) => d.name === "Phone Switch")!;
eq("layout phone switch", [ph.fields.notes, ph.cols, ph.side, ph.line === lay.devices.find((d) => d.name === "EX-FW01")!.line], ["should be decommissioned", 2, 1, true]);
const ups = lay.devices.find((d) => d.name === "APC Smart-UPS X 3000")!;
eq("layout ups", [ups.face, ups.type, ups.height], ["front", "UPS", 2]);
eq("guessHeight", [guessHeight("Mystery box").guessed, guessHeight("Mystery box").height], [true, 1]);
const used = placeLayout(lay, 42);
eq("layout place", [lay.devices[0].u! + lay.devices[0].height! - 1, used > 0], [42, true]);
eq("layout place note", kinds("note")[0].u, null);
const old = parseLayout("Rack1\n- Panel A - (2U)\n- Open - (12U)\n");
placeLayout(old, 14);
eq("old list syntax", [old.racks[0].name, old.devices.map((d) => [d.kind, d.name, d.u, d.height])], ["Rack1", [["device", "Panel A", 13, 2], ["empty", "Empty", 1, 12]]]);

const nm1 = (s: string) => { const d = parseLayout(s).devices[0]; return [d.kind || "device", d.name, d.height]; };
eq("height leading", nm1("1U Patch Panel"), ["device", "Patch Panel", 1]);
eq("height paren mid", nm1("Switch (2U) uplink"), ["device", "Switch uplink", 2]);
eq("height old", nm1("- Panel A - (2U)"), ["device", "Panel A", 2]);
eq("height keeps host", nm1("Dell R740 2U esxi.example.com"), ["device", "Dell R740 esxi.example.com", 2]);
eq("height paren first", nm1("(2U) Switch"), ["device", "Switch", 2]);
const old2 = parseLayout("Rack1\n- Panel A - (2U)\n- Open - (12U)\nRack2\n- Switch B - (2U)\n- Open - (12U)\n");
placeLayout(old2, 14);
const bd: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
buildFromText(bd, "Rack1\n- Panel A - (2U)\n- Open - (12U)\nRack2\n- Switch B - (2U)\n- Open - (12U)\n");
const want = bd.devices.map((d) => [d.name, bd.racks.find((r) => r.id === d.rack)!.name, d.u]);
eq("old two racks", old2.devices.filter((d) => d.kind === "device").map((d) => [d.name, d.rack, d.u]), want);
eq("empty strict", ["Spare UPS battery", "Open vSwitch host", "1U Switch (free ports on 5-8)", "Free space above is reserved for the new firewall."].map((s) => nm1(s)[0]), ["device", "device", "device", "note"]);
eq("empty yes", ["1 U RACK EMPTY SPACE", "Empty (3U)", "Open"].map((s) => nm1(s).slice(0, 1).concat(parseLayout(s).devices[0].height as number)), [["empty", 1], ["empty", 3], ["empty", 1]]);
eq("unknown synology guessed", [guessHeight("Synology RS9999").guessed], [true]);
const rmText = "RACK EX-R1 42U\nU40 switch EX-SW01 ip=10.0.0.2 model=ICX7150\nU30-31 server EX-HV01\nLINK EX-SW01:1 -> EX-HV01:NIC1 cable=Cat6\nUNRACKED ap EX-AP01\n";
eq("auto csv", readImport("Name,Type,Rack,U,Model,IP\nEX-SW01,Switch,EX-R1,40,ICX7150,10.0.0.2\nEX-NAS01,NAS,EX-R1,10,DS920,10.0.0.9\n", "auto").kind, "inventory");
eq("auto rackmap", readImport(rmText, "auto").kind, "rackmap");
eq("auto layout", readImport(layText, "auto").kind, "layout");
const frw = readImport(layText, "rackmap").warnings;
eq("forced rackmap on layout", [frw.slice(0, -1).every((w) => /^Line \d+ not understood: /.test(w)), frw.filter((w) => !w.startsWith("Line ")), frw.length], [true, ["Nothing in the RackMap text format was found."], layText.split(/\r?\n/).filter((l) => l.trim()).length + 1]);
eq("forced layout on empty", readImport("", "layout").warnings, ["No devices were found in the list."]);
eq("forced csv keeps warnings", readImport("Foo,Bar\n1,2\n", "csv").warnings, ["Couldn't find a Name, Device or Hostname column."]);
eq("forced csv no usable rows", readImport("Name,Model\n,x\n,y\n", "csv").warnings, ["No rows could be read."]);

import { planImport } from "../src/imports/plan";
const mk = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, type: "Server", u_size: 1, rack: 1, u: 5, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "front", ports: [], ...extra }) as unknown as Doc["devices"][number];
const pdoc = (): Doc => ({ v: 1, nid: 20, racks: [{ id: 1, name: "EX-R1", u: 42, x: 0, y: 0 }], cables: [], devices: [
  mk(1, "EX-NAS01", { serial: "S1", u: 10 }), mk(2, "esxi.example.com", { u: 20 }), mk(3, "EX-MDF-STK01 Member 1", { type: "Switch", u: 30 }), mk(4, "EX-MDF-STK01 Member 2", { type: "Switch", u: 31 }),
  mk(5, "Device@192.0.2.5", { type: "UPS", model: "APC", u: 1 }), mk(6, "EX-OLD", { u: 40 }), mk(7, "EX-DUP", { u: 41 }), mk(8, "EX-DUP", { u: 42 }) ] });
const popts = { rackId: 1, newRackName: "New", newRackU: 42, growRack: false };
const pl = planImport(pdoc(), parseLayout("Synology EX-NAS01\n(EX-MDF-STACK)\nStack switch A\nStack switch B\nAPC Smart-UPS 1500\nEX-DUP thing\n"), popts);
eq("match by name inside line", [pl.rows[0].match?.name, pl.rows[0].action], ["EX-NAS01", "move"]);
eq("match group members", [pl.rows[1].match?.name, pl.rows[2].match?.name], ["EX-MDF-STK01 Member 1", "EX-MDF-STK01 Member 2"]);
eq("possible ups match", [pl.rows[3].match?.id, pl.rows[3].on, pl.rows[3].reason], [5, false, "Possible match — check before importing"]);
eq("conflict", [pl.rows[4].on, pl.rows[4].reason?.startsWith("Matches more than one device")], [false, true]);
eq("not in import", pl.notInImport.map((d) => d.name).includes("EX-OLD"), true);
const ld = pdoc(); ld.devices[0].locked = ["ip"]; ld.devices[0].ip = "10.0.0.5";
const lk = planImport(ld, csvToSpec("Name,Rack,U,IP\nEX-NAS01,EX-R1,10,10.0.0.9\n"), popts);
eq("locked kept", [lk.rows[0].diffs, lk.rows[0].action], [[{ field: "ip", from: "10.0.0.5", to: "10.0.0.9", kept: true }], "same"]);

const gdoc = pdoc(); gdoc.devices.push(mk(9, "EX-MDF-STK01 Member 3", { type: "Switch", u: 32 }));
const gp = planImport(gdoc, parseLayout("(EX-MDF-STACK)\nEX-MDF-STK01 Member 1\nStack B\nStack C\n"), popts);
eq("group index counts named rows", gp.rows.map((r) => r.match?.name), ["EX-MDF-STK01 Member 1", "EX-MDF-STK01 Member 2", "EX-MDF-STK01 Member 3"]);
const dd = planImport(pdoc(), parseLayout("EX-NAS01\nEX-NAS01 (spare)\n"), popts);
eq("same device twice", [dd.rows[0].on, dd.rows[1].match, dd.rows[1].on, dd.rows[1].reason], [true, null, false, "Same device as line 1"]);
for (const grow of [false, true]) {
  const sp = parseLayout("EX-NAS01\nSwitch\nEmpty (4U)\n");
  const before = JSON.stringify(sp);
  planImport(pdoc(), sp, { ...popts, newRackU: 2, rackId: null, growRack: grow });
  eq("planImport leaves spec alone " + grow, JSON.stringify(sp), before);
}
import { applyImport } from "../src/imports/apply";
const adoc = (u = 42): Doc => ({ v: 1, nid: 100, racks: [{ id: 1, name: "EX-R1", u, x: 0, y: 0 }], cables: [], devices: [] });
const aopts = { rackId: 1, newRackName: "New", newRackU: 42, growRack: false };
{
  const d = adoc(), sp = parseLayout("HPE ProLiant DL380 Gen10\nEX-SW01 switch\n");
  const lg = applyImport(d, planImport(d, sp, aopts), aopts);
  const dl = d.devices.find((x) => x.name.includes("DL380"))!;
  eq("layout apply top", [lg.added, dl.rack, dl.u + dl.u_size - 1], [2, 1, 42]);
  const p2 = planImport(d, parseLayout("HPE ProLiant DL380 Gen10\nEX-SW01 switch\n"), aopts);
  eq("reimport is all same", p2.rows.map((r) => r.action), ["same", "same"]);
  const l2 = applyImport(d, p2, aopts);
  eq("reapply adds nothing", [l2.added, l2.moved, l2.changed, d.devices.length], [0, 0, 0, 2]);
}
{
  const d = adoc(); d.devices.push(mk(50, "EX-BLOCK", { u: 41, u_size: 2 }));
  const sp = parseLayout("EX-NAS01\n"); sp.devices[0].u = 41; sp.devices[0].height = 1;
  const pl2 = planImport(d, sp, aopts); pl2.rows[0].dev.u = 41;
  const lg = applyImport(d, pl2, aopts);
  const n = d.devices.find((x) => x.name === "EX-NAS01")!;
  eq("U taken", [lg.warnings, n.u], [[`EX-NAS01: U41 in EX-R1 is taken — placed at U40 instead.`], 40]);
}
for (const grow of [true, false]) {
  const d = adoc(2), o = { ...aopts, growRack: grow }, sp = parseLayout("EX-A\nEX-B\nEX-C\n");
  const lg = applyImport(d, planImport(d, sp, o), o);
  eq("layout taller than rack " + grow, [d.racks[0].u, d.devices.filter((x) => x.rack == null).length, lg.warnings.length], grow ? [3, 0, 0] : [2, 1, 1]);
  if (!grow) eq("overflow warning", lg.warnings[0], "EX-C: no free space in EX-R1 — placed off-rack.");
}
{
  const d = adoc(), o = { rackId: null, newRackName: "New", newRackU: 42, growRack: false };
  const sp = parseRackmapText("RACK EX-R2 24U\nU10 switch EX-SW01\nU5 server EX-HV01\nLINK EX-SW01:1 -> EX-HV01:NIC1 cable=Cat6\n");
  const lg = applyImport(d, planImport(d, sp, o), o);
  eq("rackmap apply", [d.racks.map((r) => r.name), d.racks[1].u, lg.cables, d.cables.length, lg.racksAdded], [["EX-R1", "EX-R2"], 24, 1, 1, 1]);
  const l2 = applyImport(d, planImport(d, sp, o), o);
  eq("rackmap reapply", [l2.added, l2.cables, d.cables.length, d.devices.length], [0, 0, 1, 2]);
}

{
  const d = adoc(); d.devices.push(mk(60, "EX-PLATE", { u: 10, face: "both" }));
  const sp = parseRackmapText("RACK EX-R1 42U\nU20 server EX-PLATE\n");
  const lg = applyImport(d, planImport(d, sp, aopts), aopts);
  eq("faceplate keeps both when moved", [lg.moved, d.devices[0].u, d.devices[0].face], [1, 20, "both"]);
}
{
  const d = adoc(1); d.racks.push({ id: 2, name: "EX-R2", u: 42, x: 200, y: 0 }); d.devices.push(mk(61, "EX-FULL", { u: 1 }));
  const sp = csvToSpec("Name,Type\nEX-NEW,Switch\n");
  const lg = applyImport(d, planImport(d, sp, aopts), aopts);
  const n = d.devices.find((x) => x.name === "EX-NEW")!;
  eq("no U stays in target rack", [n.rack, lg.warnings], [null, ["EX-NEW: no free space in EX-R1 — placed off-rack."]]);
}
{
  const d = adoc(), sp = csvToSpec("Name,Type\nEX-HV01,Server\n");
  applyImport(d, planImport(d, sp, aopts), aopts);
  eq("csv height guessed", d.devices[0].u_size, 2);
}
{
  const d = adoc(), sp = csvToSpec("Name,Type,Power\nEX-HV01,Server,abc\nEX-HV02,Server,350\n");
  applyImport(d, planImport(d, sp, aopts), aopts);
  eq("power_w skips NaN", [d.devices[0].power_w, d.devices[1].power_w], [undefined, 350]);
}
console.log(`${fail} failed`);
process.exit(fail ? 1 : 0);
