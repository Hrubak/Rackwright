// npx tsx scripts/dashboard.test.ts — dashboard card numbers (synthetic data only)
import { cardStats, clientToken, initials } from "../src/home/cards";
import type { Doc } from "../src/types";
import type { ClientItem } from "../src/clients/store";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const dev = (id: number, u: number, u_size: number) => ({ id, name: `d${id}`, type: "Switch", u_size, rack: 1, u, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "both", ports: [] });
const mk = (devs: ReturnType<typeof dev>[]): Doc => ({ v: 1, nid: 50, racks: [{ id: 1, name: "R1", u: 42 }], devices: devs, cables: [] } as unknown as Doc);
const client: ClientItem = {
  key: "k1", name: "Example Client", notes: "", links: [],
  sites: [
    { id: 1, name: "Head Office", address: "", notes: "", racks: [{ key: "a", name: "Rack A" }] },
    { id: 2, name: "Branch", address: "", notes: "", racks: [{ key: "b", name: "Rack B" }] },
  ],
};
const docs: Record<string, Doc | string> = { a: mk([dev(1, 1, 10)]), b: mk([dev(2, 1, 11)]) };
const s = cardStats(client, docs);
eq("usedPct", s.usedPct, 25);
eq("racks", s.stats.racks, 2);
eq("devices", s.stats.devices, 2);
eq("sites", s.sites, [{ id: 1, name: "Head Office", racks: 1 }, { id: 2, name: "Branch", racks: 1 }]);
eq("no failed", s.failed, []);

const bad = cardStats(client, { a: docs.a, b: "Could not read" });
eq("failed listed", bad.failed, ["Rack B"]);
eq("failed left out", bad.stats.racks, 1);
eq("failed pct", bad.usedPct, 24);

const none = cardStats({ ...client, sites: [] }, {});
eq("empty zero", none.stats.devices + none.stats.racks + none.stats.cables, 0);
eq("empty pct", none.usedPct, 0);
eq("empty sites", none.sites, []);

eq("token stable", clientToken("k1"), clientToken("k1"));
eq("initials", initials("Example Client"), "EC");
eq("initials one", initials("Example"), "EX");
eq("initials blank", initials("  "), "?");

if (fail) { console.log(`${fail} failed`); process.exit(1); }
console.log("dashboard tests ok");
