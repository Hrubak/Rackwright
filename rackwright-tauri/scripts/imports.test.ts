// npx tsx scripts/imports.test.ts — RackMap text and CSV readers (synthetic data only)
import { parseRackmapText } from "../src/imports/rackmap";
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

console.log(`${fail} failed`);
process.exit(fail ? 1 : 0);
