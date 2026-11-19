// Capacity check of the included VMs against a HyperCore cluster. Pure: no Tauri or backend imports.
import type { MigrationPlan } from "./types";
import { isIncluded, type SiteVm } from "./vms";

export type Level = "fits" | "tight" | "over";
export type Overall = Level | "incomplete";
export interface ResourceFit { needed: number; available: number; usedPct: number; left: number; level: Level }
export interface FitResult {
  cpu: ResourceFit; ram: ResourceFit; disk: ResourceFit; // cpu in vCPU, ram in GB, disk in TB
  usedTb: number; counted: number; failover: "n+1" | "off" | "none";
  problems: { key: string; reason: string }[]; missing: string[];
  included: number; excluded: number; overall: Overall;
}

export const LEVEL_TEXT: Record<Overall, string> = { fits: "Fits", tight: "Tight", over: "Doesn't fit", incomplete: "Incomplete" };

const TIGHT_PCT = 80;
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const size = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

function resource(needed: number, available: number): ResourceFit {
  const usedPct = available > 0 ? (needed / available) * 100 : needed > 0 ? Infinity : 0;
  const level: Level = usedPct > 100 ? "over" : usedPct > TIGHT_PCT ? "tight" : "fits";
  return { needed, available, usedPct, left: available - needed, level };
}

const RANK: Record<Level, number> = { fits: 0, tight: 1, over: 2 };

export function fitPlan(plan: MigrationPlan, vms: SiteVm[]): FitResult {
  const c = plan.cluster ?? ({} as MigrationPlan["cluster"]);
  const r = plan.rules ?? ({} as MigrationPlan["rules"]);
  const nodes = num(c.nodes), cores = num(c.cores), ramGb = num(c.ramGb), rawTb = num(c.rawTb);
  const cpuRatio = num(r.cpuRatio), reserve = num(r.ramReserveGb), keepFree = num(r.keepFreePct);
  const nPlus1 = r.nPlus1 === true;

  const counted = nodes <= 1 ? Math.max(nodes, 0) : nPlus1 ? nodes - 1 : nodes;
  const failover: FitResult["failover"] = nodes <= 1 ? "none" : nPlus1 ? "n+1" : "off";
  const nodeRam = Math.max(0, ramGb - reserve);

  let vcpu = 0, ram = 0, diskGb = 0, usedGb = 0, included = 0, excluded = 0;
  const problems: FitResult["problems"] = [], missing: string[] = [];
  for (const vm of vms) {
    const e = plan.vms?.[vm.key];
    if (!isIncluded(vm, e)) { excluded++; continue; }
    included++;
    const v = size(e?.vcpu), m = size(e?.ramGb), d = size(e?.diskGb);
    vcpu += v ?? 0; ram += m ?? 0; diskGb += d ?? 0; usedGb += size(e?.usedGb) ?? 0;
    if (v === undefined || m === undefined || d === undefined) missing.push(vm.key);
    if ((m ?? 0) > nodeRam) problems.push({ key: vm.key, reason: `Needs more RAM than one node has (${nodeRam} GB)` });
    if ((v ?? 0) > cores) problems.push({ key: vm.key, reason: `Needs more vCPUs than one node has cores (${cores})` });
  }

  const cpu = resource(vcpu, cores * counted * cpuRatio);
  const ramFit = resource(ram, nodeRam * counted);
  const disk = resource(diskGb / 1000, (rawTb * counted / 2) * (1 - keepFree / 100));
  const worst = [cpu, ramFit, disk].reduce<Level>((w, x) => (RANK[x.level] > RANK[w] ? x.level : w), "fits");
  const overall: Overall = problems.length || worst === "over" ? "over" : missing.length ? "incomplete" : worst;
  return { cpu, ram: ramFit, disk, usedTb: usedGb / 1000, counted, failover, problems, missing, included, excluded, overall };
}

export function resultText(f: FitResult): string {
  const head = LEVEL_TEXT[f.overall];
  if (f.overall === "incomplete") return `${head} \u2014 ${f.missing.length} ${f.missing.length === 1 ? "VM has" : "VMs have"} no size`;
  if (f.overall === "fits") return head;
  const entries: [string, ResourceFit][] = [["CPU", f.cpu], ["RAM", f.ram], ["Disk", f.disk]];
  const top = entries.reduce((a, b) => (b[1].usedPct > a[1].usedPct ? b : a));
  if (f.overall === "over" && f.cpu.level !== "over" && f.ram.level !== "over" && f.disk.level !== "over") {
    const n = new Set(f.problems.map(p => p.key)).size;
    return `${head} (${n} ${n === 1 ? "VM" : "VMs"} too big for a node)`;
  }
  const pct = Number.isFinite(top[1].usedPct) ? `${Math.round(top[1].usedPct)}%` : "no capacity";
  return `${head} (${top[0]} ${pct})`;
}

export function failoverText(f: FitResult): string {
  return f.failover === "n+1" ? "One node down (N+1)" : f.failover === "off" ? "No failover headroom" : "No failover";
}

/** undefined = cleared, null = ignore the input. */
export function parseSize(text: string, whole: boolean): number | undefined | null {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return whole ? Math.round(n) : n;
}
