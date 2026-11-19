// VM migration plan stored on a site. Unknown keys survive a load and save.

export type SizeField = "vcpu" | "ramGb" | "diskGb" | "usedGb";
export type SizeSourceId = "manual" | "asio";

export interface ClusterSpec { name: string; nodes: number; cores: number; ramGb: number; rawTb: number; preset?: string }
export interface FitRules { cpuRatio: number; ramReserveGb: number; keepFreePct: number; nPlus1: boolean }
export interface VmEntry {
  vcpu?: number; ramGb?: number; diskGb?: number; usedGb?: number;
  include?: boolean; notes?: string;
  source?: Partial<Record<SizeField, SizeSourceId>>;
}
export interface MigrationPlan {
  v: 1;
  cluster: ClusterSpec;
  rules: FitRules;
  vms: Record<string, VmEntry>;
  [k: string]: unknown;
}

export const DEFAULT_RULES: FitRules = { cpuRatio: 4, ramReserveGb: 8, keepFreePct: 20, nPlus1: true };

export function newPlan(siteName: string): MigrationPlan {
  return {
    v: 1,
    cluster: { name: `${siteName} cluster`, nodes: 3, cores: 0, ramGb: 0, rawTb: 0 },
    rules: { ...DEFAULT_RULES },
    vms: {},
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The stored plan, or undefined when the site has none (null, not an object, or no cluster). */
export function readPlan(x: unknown): MigrationPlan | undefined {
  if (!isObj(x) || !isObj(x.cluster)) return undefined;
  return {
    ...x,
    v: 1,
    cluster: x.cluster as unknown as ClusterSpec,
    rules: { ...DEFAULT_RULES, ...(isObj(x.rules) ? x.rules : {}) },
    vms: isObj(x.vms) ? (x.vms as Record<string, VmEntry>) : {},
  };
}
