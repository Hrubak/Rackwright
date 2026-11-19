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
  included: number; excluded: number; overall: Overall; unreadable: string[];
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

export function fitPlan(plan: MigrationPlan, vms: SiteVm[], opts?: { unreadable?: string[] }): FitResult {
  const c = plan.cluster ?? ({} as MigrationPlan["cluster"]);
  const r = plan.rules ?? ({} as MigrationPlan["rules"]);
  const nodes = Math.max(0, Math.floor(num(c.nodes))), cores = Math.max(0, num(c.cores)), ramGb = Math.max(0, num(c.ramGb)), rawTb = Math.max(0, num(c.rawTb));
  const cpuRatio = Math.min(10, Math.max(1, num(r.cpuRatio))), reserve = Math.max(0, num(r.ramReserveGb)), keepFree = Math.min(95, Math.max(0, num(r.keepFreePct)));
  const unreadable = opts?.unreadable ?? [];
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
    if (nodeRam > 0 && (m ?? 0) > nodeRam) problems.push({ key: vm.key, reason: `Needs more RAM than one node has (${nodeRam} GB)` });
    if (cores > 0 && (v ?? 0) > cores) problems.push({ key: vm.key, reason: `Needs more vCPUs than one node has cores (${cores})` });
  }

  const cpu = resource(vcpu, cores * counted * cpuRatio);
  const ramFit = resource(ram, nodeRam * counted);
  const disk = resource(diskGb / 1000, (rawTb * counted / 2) * (1 - keepFree / 100));
  const worst = [cpu, ramFit, disk].reduce<Level>((w, x) => (RANK[x.level] > RANK[w] ? x.level : w), "fits");
  const overall: Overall = problems.length || worst === "over" ? "over" : missing.length || unreadable.length ? "incomplete" : worst;
  return { cpu, ram: ramFit, disk, usedTb: usedGb / 1000, counted, failover, problems, missing, included, excluded, overall, unreadable };
}

/** One percent text for the tab, the report and the result line; rounds up so a level never reads as the one below. */
export function pctText(r: ResourceFit): string {
  if (!(r.available > 0)) return "—";
  let pct = Math.round(r.usedPct);
  if (r.level === "over" && pct <= 100) pct = 101;
  if (r.level === "tight" && pct <= TIGHT_PCT) pct = TIGHT_PCT + 1;
  return `${pct}%`;
}

export function fmtNum(n: number, decimals: 0 | 1): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function resultText(f: FitResult): string {
  const head = LEVEL_TEXT[f.overall];
  if (f.overall === "incomplete" && f.unreadable.length) return `${head} — could not read ${f.unreadable.join(", ")}`;
  if (f.overall === "incomplete") return `${head} \u2014 ${f.missing.length} ${f.missing.length === 1 ? "VM has" : "VMs have"} no size`;
  if (f.overall === "fits") return head;
  const entries: [string, ResourceFit][] = [["CPU", f.cpu], ["RAM", f.ram], ["disk", f.disk]];
  const top = entries.reduce((a, b) => (b[1].usedPct > a[1].usedPct ? b : a));
  if (f.overall === "over" && f.cpu.level !== "over" && f.ram.level !== "over" && f.disk.level !== "over") {
    const n = new Set(f.problems.map(p => p.key)).size;
    return `${head} (${n} ${n === 1 ? "VM" : "VMs"} too big for a node)`;
  }
  if (!Number.isFinite(top[1].usedPct)) return `${head} (no ${top[0]} capacity)`;
  return `${head} (${top[0]} ${pctText(top[1])})`;
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
