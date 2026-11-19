// npx tsx scripts/migration.test.ts — migration plan defaults and reading (synthetic data only)
import { DEFAULT_RULES, newPlan, readPlan } from "../src/migration/types";
import { fitPlan, resultText, failoverText, parseSize, pctText, fmtNum } from "../src/migration/fit";
import { applyFill } from "../src/migration/sources";
import { NODE_PRESETS } from "../src/migration/presets";
import type { SiteVm } from "../src/migration/vms";
import { siteVms, defaultInclude, isIncluded, orphanKeys, unreadableRacks } from "../src/migration/vms";

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

const doc4: any = { v: 1, nid: 9, racks: [], cables: [], devices: [
  dev({ id: 1, name: "EX-SOLO1", type: "Server", model: "Virtual Machine – VMware", auvik_id: "d9" }),
  dev({ id: 2, name: "EX-SOLO2", type: "Server", model: "Virtual Machine – VMware" }),
  dev({ id: 3, name: "EX-SOLO3", type: "Server", model: "Virtual Machine – VMware", endpoints: [] }),
] };
const v4 = siteVms([{ key: "r4", name: "R4" }], { r4: doc4 });
const b4 = (n: string) => v4.find(v => v.name === n)!;
eq("c names", v4.map(v => v.name), ["EX-SOLO1", "EX-SOLO2", "EX-SOLO3"]);
eq("c auvik key", [b4("EX-SOLO1").key, b4("EX-SOLO1").platform, b4("EX-SOLO1").host], ["auvik:d9", "vmware", ""]);
eq("c fallback key", b4("EX-SOLO2").key, "r4#2#EX-SOLO2");

// --- fitPlan
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const mk = (key: string, infra = false): SiteVm => ({ key, name: key, host: "", platform: "vmware", rackKey: "r", rackName: "R", deviceId: 1, ip: "", infra });
const fp = (entries: Record<string, any>, vmList: SiteVm[], tweak?: (p: any) => void) => {
  const pl: any = newPlan("Example HQ");
  pl.cluster = { name: "c", nodes: 3, cores: 24, ramGb: 384, rawTb: 7.7 };
  pl.vms = entries; tweak?.(pl);
  return fitPlan(pl, vmList);
};
const one = { vcpu: 8, ramGb: 64, diskGb: 500, usedGb: 310 };
const f1 = fp({ a: one }, [mk("a")]);
eq("fit cpu avail", f1.cpu.available, 192);
eq("fit ram avail", f1.ram.available, 752);
eq("fit disk avail", near(f1.disk.available, 6.16), true);
eq("fit usedTb", near(f1.usedTb, 0.31), true);
eq("fit overall", f1.overall, "fits");
eq("fit failover text", failoverText(f1), "One node down (N+1)");
const f2 = fp({ a: one }, [mk("a")], p => { p.rules.nPlus1 = false; });
eq("no n+1", [f2.counted, f2.cpu.available, f2.failover, failoverText(f2)], [3, 288, "off", "No failover headroom"]);
const f3 = fp({ a: { ...one, vcpu: 30 } }, [mk("a")]);
eq("big vcpu", [f3.problems, f3.overall], [[{ key: "a", reason: "Needs more vCPUs than one node has cores (24)" }], "over"]);
eq("big vcpu text", resultText(f3), "Doesn't fit (1 VM too big for a node)");
const f4 = fp({ a: { ...one, ramGb: 380 } }, [mk("a")]);
eq("big ram", f4.problems[0].reason, "Needs more RAM than one node has (376 GB)");
const f5 = fp({ a: { ...one, ramGb: 350 }, b: { ...one, ramGb: 350 } }, [mk("a"), mk("b")]);
eq("tight ram", [f5.ram.level, resultText(f5)], ["tight", "Tight (RAM 93%)"]);
const f6 = fp({ a: { vcpu: 1, ramGb: 1 } }, [mk("a")]);
eq("incomplete", [f6.overall, resultText(f6), f6.missing], ["incomplete", "Incomplete — 1 VM has no size", ["a"]]);
eq("incomplete plural", resultText(fp({}, [mk("a"), mk("b"), mk("c")])), "Incomplete — 3 VMs have no size");
eq("no used ok", fp({ a: { vcpu: 1, ramGb: 1, diskGb: 1 } }, [mk("a")]).overall, "fits");
const f7 = fp({ a: one, i: { vcpu: 100, ramGb: 100, diskGb: 100 } }, [mk("a"), mk("i", true)]);
eq("excluded", [f7.cpu.needed, f7.included, f7.excluded], [8, 1, 1]);
const f8 = fp({ a: one }, [mk("a")], p => { p.cluster.cores = 0; });
eq("zero cluster", [f8.cpu.available, f8.cpu.level, f8.cpu.usedPct], [0, "over", Infinity]);
eq("zero cluster text", resultText(f8), "Doesn't fit (no CPU capacity)");
eq("zero cluster nan", [f8.cpu, f8.ram, f8.disk].some(r => [r.needed, r.available, r.usedPct, r.left].some(Number.isNaN)), false);
const r1 = fp({ a: { ...one, ramGb: 250 }, b: { ...one, ramGb: 250 }, c: { ...one, ramGb: 255.2 } }, [mk("a"), mk("b"), mk("c")]);
eq("over rounds up", resultText(r1), "Doesn't fit (RAM 101%)");
const r2 = fp({ a: { ...one, ramGb: 300 }, b: { ...one, ramGb: 303.1 } }, [mk("a"), mk("b")]);
eq("tight rounds up", resultText(r2), "Tight (RAM 81%)");
const f9 = fp({}, []);
eq("no vms", [f9.overall, f9.cpu.needed, f9.ram.needed, f9.disk.needed], ["fits", 0, 0, 0]);
const f10 = fp({ a: one }, [mk("a")], p => { p.cluster.nodes = 1; });
eq("one node", [f10.counted, f10.failover, failoverText(f10)], [1, "none", "No failover"]);
const f11 = fp({ a: one }, [mk("a")], p => { p.cluster.nodes = "3"; });
eq("string nodes no NaN", [f11.cpu, f11.ram, f11.disk].some(r => [r.needed, r.available, r.left].some(Number.isNaN)), false);
eq("parseSize", [parseSize(""), parseSize("abc"), parseSize("-1"), parseSize("7.6", true), parseSize("1.5", false), parseSize("0", true)], [undefined, null, null, 8, 1.5, 0]);
const pl2 = newPlan("X"); pl2.vms = { a: { vcpu: 4 } };
const filled = applyFill(pl2, { a: { vcpu: 8, ramGb: 16 } }, "asio", false);
eq("fill keep", [filled.vms.a.vcpu, filled.vms.a.ramGb, filled.vms.a.source], [4, 16, { ramGb: "asio" }]);
const filled2 = applyFill(pl2, { a: { vcpu: 8 } }, "asio", true);
eq("fill overwrite", [filled2.vms.a.vcpu, filled2.vms.a.source], [8, { vcpu: "asio" }]);
eq("preset ids", new Set(NODE_PRESETS.map(x => x.id)).size, NODE_PRESETS.length);
if (NODE_PRESETS.length) eq("presets positive", NODE_PRESETS.every(x => x.cores > 0 && x.ramGb > 0 && x.rawTb > 0), true);

// --- final review fixes
eq("unreadable racks", unreadableRacks([{ key: "r1", name: "EX-Rack1" }, { key: "r2", name: "EX-Rack2" }, { key: "r3", name: "EX-Rack3" }], { r1: doc1, r2: "load error" } as any), ["EX-Rack2", "EX-Rack3"]);
const fu = fitPlan((() => { const q = newPlan("Example HQ"); q.cluster = { ...q.cluster, cores: 24, ramGb: 384, rawTb: 7.7 }; q.vms = { a: one }; return q; })(), [mk("a")], { unreadable: ["EX-Rack2"] });
eq("unreadable incomplete", [fu.overall, resultText(fu)], ["incomplete", "Incomplete \u2014 could not read EX-Rack2"]);
eq("pctText over", pctText({ needed: 100.4, available: 100, usedPct: 100.4, left: 0, level: "over" }), "101%");
eq("pctText none", pctText({ needed: 1, available: 0, usedPct: Infinity, left: -1, level: "over" }), "\u2014");
eq("fmtNum", [fmtNum(1234.56, 0), fmtNum(7.7, 1)], ["1,235", "7.7"]);
const fk = fp({ a: one }, [mk("a")], p => { p.rules.keepFreePct = 150; });
eq("keepFree clamp", fk.disk.available >= 0, true);
const fz = fp({ a: one }, [mk("a")], p => { p.cluster.cores = 0; p.cluster.ramGb = 0; });
eq("zero cluster no per-VM problem", fz.problems, []);
eq("readPlan cluster name default", readPlan({ cluster: { nodes: 3 } })!.cluster.name, "");

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
