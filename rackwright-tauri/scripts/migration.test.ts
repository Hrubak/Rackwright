// npx tsx scripts/migration.test.ts — migration plan defaults and reading (synthetic data only)
import { DEFAULT_RULES, newPlan, readPlan } from "../src/migration/types";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

eq("readPlan empty", readPlan({}), undefined);
eq("readPlan null", readPlan(null), undefined);
const p = newPlan("Example HQ");
eq("newPlan name", p.cluster.name, "Example HQ cluster");
eq("newPlan rules", p.rules, { cpuRatio: 4, ramReserveGb: 8, keepFreePct: 20, nPlus1: true });
eq("readPlan fills rules", readPlan({ v: 1, cluster: p.cluster, vms: {} })!.rules, DEFAULT_RULES);
eq("readPlan keeps unknown", (readPlan({ ...p, waves: [1] }) as any).waves, [1]);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
