// npx tsx scripts/device.test.ts — device fields and helpers (synthetic data only)
import { statusOf, setField, connectedTo, powerPath, copyAsText, SPEC_FIELDS, STATUSES } from "../src/device/info";
import type { Doc } from "../src/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const mk = (id: number, name: string, type: string, ports: [number, string, string][], extra: object = {}) => ({
  id, name, type, u_size: 1, rack: 1, u: 1, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "both",
  ports: ports.map(([pid, pn, pt]) => ({ id: pid, name: pn, type: pt, label: "" })), ...extra,
});
const doc: Doc = {
  v: 1, nid: 100,
  racks: [{ id: 1, name: "Rack A", u: 42, x: 0, y: 0 }],
  devices: [
    mk(1, "Example server", "Server", [[11, "eth0", "RJ45"], [12, "eth1", "RJ45"], [13, "PSU1", "Power"]], { u: 12, model: "Example 1U", ip: "192.0.2.5", serial: "SN-1" }),
    mk(2, "SW-1", "Switch", [[21, "1", "RJ45"], [22, "2", "RJ45"]]),
    mk(3, "PDU-1", "PDU", [[31, "Out1", "Power"], [32, "In", "Power"]]),
    mk(4, "UPS-1", "UPS", [[41, "Out2", "Power"], [42, "In", "Power"]]),
  ],
  cables: [
    { id: 1, a: 11, b: 21, color: "#fff" }, { id: 2, a: 12, b: 22, color: "#fff" },
    { id: 3, a: 13, b: 31, color: "#000", type: "Power" },
    { id: 4, a: 32, b: 41, color: "#000", type: "Power" },
  ],
};
const d0: any = doc.devices[0];
eq("status default", statusOf(d0), "active");
eq("status set", statusOf({ ...d0, status: "spare" }), "spare");
eq("statuses", STATUSES.map((s) => s.label), ["Active", "Spare", "Offline", "Planned"]);

const before = JSON.stringify(d0);
setField(d0, "hostname", "host1"); eq("set", d0.hostname, "host1");
setField(d0, "hostname", ""); eq("clear", "hostname" in d0, false);
setField(d0, "power_w", NaN); eq("nan", "power_w" in d0, false);
setField(d0, "power_w", 120); eq("num", d0.power_w, 120); setField(d0, "power_w", undefined);
eq("untouched", JSON.stringify(d0), before);

eq("connected", connectedTo(doc, 1).map((c) => ({ n: c.dev.name, links: c.links })), [{ n: "SW-1", links: 2 }]);
eq("path", powerPath(doc, 1), [{ port: "PSU1", chain: [{ dev: "PDU-1", port: "Out1" }, { dev: "UPS-1", port: "Out2" }] }]);

// loop: UPS inlet feeds PDU, PDU inlet feeds UPS
const loop: Doc = JSON.parse(JSON.stringify(doc));
loop.cables.push({ id: 5, a: 42, b: 31, color: "#000", type: "Power" });
loop.cables = loop.cables.filter((c) => c.id !== 4);
loop.cables.push({ id: 6, a: 32, b: 41, color: "#000", type: "Power" });
const lp = powerPath(loop, 1);
eq("loop stops", lp.length === 1 && lp[0].chain.length <= 6, true);

const txt = copyAsText(doc, 1);
eq("text name", txt.includes("Example server — Server"), true);
eq("text U", txt.includes("U12"), true);
eq("text link", txt.includes("SW-1"), true);
eq("spec ups", SPEC_FIELDS.length, 13);
eq("spec order", SPEC_FIELDS.slice(0, 3).map((f) => f.label), ["Manufacturer", "Model", "Serial"]);

if (fail) { console.log(`${fail} failed`); process.exit(1); }
console.log("device tests passed");
