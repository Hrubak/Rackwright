// npx tsx scripts/attention-lists.test.ts — merged client alerts (synthetic data only)
import { allClientAlerts, stillLoading } from "../src/attention/lists";
let fail = 0;
const eq = (n: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${n}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); } };
const rack = (key: string) => ({ key, name: key, path: key, id: 1 });
const mk = (key: string, name: string, rk: string) => ({ key, name, notes: "", sites: [{ id: 1, name: "HQ", racks: [rack(rk)] }] }) as never;
const doc = (w: string) => ({ racks: [{ id: 1, name: "R1", last_verified: "2026-11-01" }], devices: [{ id: 1, rack: 1, name: "SW", warranty_exp: w }] }) as never;
const clients = [mk("a", "Example IT", "ra"), mk("b", "Example Client", "rb")];
const docs = { ra: doc("2026-12-01"), rb: doc("2026-01-01") } as never;
const r = allClientAlerts(clients, docs, "2026-11-17");
eq("order", r.map((a) => [a.level, a.clientName]), [["critical", "Example Client"], ["warning", "Example IT"]]);
eq("loading", stillLoading(clients, { ra: docs["ra"] } as never), true);
eq("loaded", stillLoading(clients, docs), false);
if (fail) process.exit(1); console.log("attention-lists ok");
