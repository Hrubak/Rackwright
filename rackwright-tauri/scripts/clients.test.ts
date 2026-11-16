// npx tsx scripts/clients.test.ts — client file paths and site stats (synthetic data only)
import { absPath, relPath } from "../src/clients/util";
import { docStats, inventoryCsv, inventoryRows, matchRow, typeTotals } from "../src/clients/util";
import type { Doc } from "../src/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const cw = "C:\\Clients\\Acme\\Acme.client.json";
eq("win inside", relPath(cw, "C:\\Clients\\Acme\\Main\\core.rack.json"), "Main\\core.rack.json");
eq("win case", relPath(cw, "c:\\clients\\acme\\idf.rack.json"), "idf.rack.json");
eq("win outside", relPath(cw, "D:\\Other\\x.rack.json"), "D:\\Other\\x.rack.json");
eq("win sibling prefix", relPath(cw, "C:\\Clients\\Acme2\\x.rack.json"), "C:\\Clients\\Acme2\\x.rack.json");
eq("win abs back", absPath(cw, "Main\\core.rack.json"), "C:\\Clients\\Acme\\Main\\core.rack.json");
eq("win abs slash", absPath(cw, "Main/core.rack.json"), "C:\\Clients\\Acme\\Main\\core.rack.json");
eq("win abs keep", absPath(cw, "D:\\Other\\x.rack.json"), "D:\\Other\\x.rack.json");
const cu = "/home/me/acme/acme.client.json";
eq("unix inside", relPath(cu, "/home/me/acme/site/a.rack.json"), "site/a.rack.json");
eq("unix abs", absPath(cu, "site/a.rack.json"), "/home/me/acme/site/a.rack.json");

const dev = (id: number, rack: number | null, u: number, u_size: number, ports = 0) => ({
  id, name: `d${id}`, type: "Switch", u_size, rack, u, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "both",
  ports: Array.from({ length: ports }, (_, i) => ({ id: id * 100 + i, name: `p${i}`, type: "RJ45", label: "" })),
});
const doc: Doc = {
  v: 1, nid: 10,
  racks: [{ id: 1, name: "A", u: 42, x: 0, y: 0 }, { id: 2, name: "B", u: 12, x: 0, y: 0 }],
  devices: [dev(3, 1, 1, 2, 4), dev(4, 1, 2, 1), dev(5, 2, 5, 1, 24), dev(6, null, 0, 1)],
  cables: [{ id: 7, a: 300, b: 500, color: "#fff" }],
};
eq("stats", docStats(doc), { racks: 2, devices: 4, cables: 1, ports: 28, usedU: 3, totalU: 54 });

// inventory
const inv: Doc = JSON.parse(JSON.stringify(doc));
Object.assign(inv.devices[0], { name: "core-sw", type: "Switch", model: "Example 48P", ip: "192.0.2.10", mac: "AA:BB:CC:00:11:22", serial: "SN-TEST-1" });
Object.assign(inv.devices[2], { name: "fw1", type: "Firewall", ip: "192.0.2.1", endpoints: [{ name: "front-desk-pc", type: "PC", model: "", ip: "192.0.2.50", mac: "aa-bb-cc-99-88-77", port: "7", status: "Up" }] });
const rows = inventoryRows(1, "Main Office", "r11", "Main MDF", inv);
eq("inv count", rows.length, 4);
eq("inv where", rows[0].where, "A U1-2");
eq("inv offrack", rows[3].where, "off-rack");
const withEp = inventoryRows(1, "Main Office", "r11", "Main MDF", inv, true);
eq("inv endpoints", withEp.length, 5);
eq("inv ep where", withEp.find((r) => r.kind === "endpoint")?.where, "on fw1 port 7");
eq("match ip", withEp.filter((r) => matchRow(r, "192.0.2.1")).map((r) => r.name), ["core-sw", "fw1"]);
eq("match words", withEp.filter((r) => matchRow(r, "main switch 48p")).map((r) => r.name), ["core-sw"]);
eq("match mac no sep", withEp.filter((r) => matchRow(r, "aabbcc0011")).map((r) => r.name), ["core-sw"]);
eq("match mac other sep", withEp.filter((r) => matchRow(r, "AA:BB:CC:99")).map((r) => r.name), ["front-desk-pc"]);
eq("match serial", withEp.filter((r) => matchRow(r, "sn-test")).map((r) => r.name), ["core-sw"]);
eq("totals", typeTotals(rows), [["Switch", 3], ["Firewall", 1]]);
const csv = inventoryCsv([{ ...rows[0], notes: 'says "hi", ok', name: "=cmd" }]);
eq("csv", csv.split("\r\n")[1], `Main Office,Main MDF,device,"'=cmd",Switch,Example 48P,192.0.2.10,AA:BB:CC:00:11:22,SN-TEST-1,A U1-2,"says ""hi"", ok"`);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
