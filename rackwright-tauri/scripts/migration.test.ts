// npx tsx scripts/migration.test.ts — migration plan defaults and reading (synthetic data only)
import { DEFAULT_RULES, newPlan, readPlan } from "../src/migration/types";
import { siteVms, defaultInclude, isIncluded, orphanKeys } from "../src/migration/vms";

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

// --- siteVms
const dev = (o: any) => ({ u_size: 1, rack: 1, u: 1, side: 0, half: false, rows: 1, fx: 0, fy: 0, face: "", ports: [], ...o });
const row = (o: any) => ({ type: "", model: "", ip: "", mac: "", port: "", status: "", ...o });
const doc1: any = { v: 1, nid: 9, racks: [], cables: [], devices: [
  dev({ id: 1, name: "EX-HV01", type: "Server", model: "PowerEdge R650", os: "Windows Server 2022 Hyper-V" }),
  dev({ id: 2, name: "VMs", type: "Virtual machines", vm_host: 1, endpoints: [
    row({ name: "EX-SQL01", key: "a1", model: "Virtual Machine – Hyper-V" }),
    row({ name: "EX-VCSA", key: "a2", model: "Virtual Machine – VMware" }),
    row({ name: "EX-APP01", model: "" }) ] }),
  dev({ id: 3, name: "Endpoints", type: "Endpoints", endpoints: [row({ name: "EX-WEB01", kind: "vm", key: "a3" }), row({ name: "PC1", kind: "pc" })] }),
] };
const doc2: any = { v: 1, nid: 9, racks: [], cables: [], devices: [dev({ id: 1, name: "Endpoints", type: "Endpoints", endpoints: [row({ name: "EX-SQL01", kind: "vm", key: "a1" })] })] };
const vms = siteVms([{ key: "r1", name: "Rack 1" }, { key: "r2", name: "Rack 2" }], { r1: doc1, r2: doc2, bad: "load error" } as any);
eq("siteVms names", vms.map(v => v.name), ["EX-APP01", "EX-SQL01", "EX-VCSA", "EX-WEB01"]);
const by = (n: string) => vms.find(v => v.name === n)!;
eq("sql key", by("EX-SQL01").key, "auvik:a1");
eq("sql host", by("EX-SQL01").host, "EX-HV01");
eq("sql platform", by("EX-SQL01").platform, "hyperv");
eq("app key", by("EX-APP01").key, "r1#2#EX-APP01");
eq("app platform", by("EX-APP01").platform, "hyperv");
eq("web host", by("EX-WEB01").host, "Endpoints");
eq("vcsa default", defaultInclude(by("EX-VCSA")), { include: false, reason: "Infrastructure VM" });
eq("scale default", defaultInclude({ ...by("EX-APP01"), platform: "scale" }), { include: false, reason: "Already on Scale" });
eq("sql default", defaultInclude(by("EX-SQL01")), { include: true, reason: "" });
eq("isIncluded override", isIncluded(by("EX-VCSA"), { include: true }), true);
eq("isIncluded default", isIncluded(by("EX-VCSA")), false);
const doc3: any = { v: 1, nid: 9, racks: [], cables: [], devices: [dev({ id: 1, name: "EX-HV02", type: "Server" }), dev({ id: 2, name: "VMs", type: "Virtual machines", vm_host: 1, endpoints: [row({ name: "EX-K1", model: "Virtual Machine – KVM (Scale HyperCore)" })] })] };
eq("scale platform", siteVms([{ key: "r1", name: "R" }], { r1: doc3 })[0].platform, "scale");
const pl = newPlan("Example HQ"); pl.vms = { "auvik:a1": {}, "auvik:gone": {} };
eq("orphans", orphanKeys(pl, vms), ["auvik:gone"]);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
