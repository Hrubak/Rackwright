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
eq("forced rackmap on layout", readImport(layText, "rackmap").warnings.slice(-1), ["Nothing in the RackMap text format was found."]);
eq("forced layout on empty", readImport("", "layout").warnings, ["No devices were found in the list."]);
eq("forced csv keeps warnings", readImport("Foo,Bar\n1,2\n", "csv").warnings.slice(-1), ["Couldn't find a Name, Device or Hostname column."]);
console.log(`${fail} failed`);
process.exit(fail ? 1 : 0);
