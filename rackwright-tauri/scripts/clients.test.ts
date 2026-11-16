// npx tsx scripts/clients.test.ts — client file paths and site stats (synthetic data only)
import { absPath, relPath } from "../src/clients/util";
import { docStats } from "../src/clients/util";
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

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
