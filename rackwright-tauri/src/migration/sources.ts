// Where VM sizes can come from. Only manual entry exists so far; a source whose available() is false shows no "Fill sizes" button.
import type { MigrationPlan, SizeField, SizeSourceId, VmEntry } from "./types";
import type { SiteVm } from "./vms";

type Fill = Record<string, Partial<Pick<VmEntry, SizeField>>>;
export interface SizeSource { id: SizeSourceId; label: string; available(): boolean; fill(siteId: number, vms: SiteVm[]): Promise<Fill> }

export const SIZE_SOURCES: SizeSource[] = [
  { id: "manual", label: "Manual", available: () => false, fill: async () => ({}) },
];

const FIELDS: SizeField[] = ["vcpu", "ramGb", "diskGb", "usedGb"];

export function applyFill(plan: MigrationPlan, fill: Fill, from: SizeSourceId, overwrite: boolean): MigrationPlan {
  const vms = { ...plan.vms };
  for (const [key, vals] of Object.entries(fill)) {
    const cur: VmEntry = { ...(vms[key] ?? {}) };
    let changed = false;
    for (const f of FIELDS) {
      const v = vals[f];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (cur[f] !== undefined && !overwrite) continue;
      cur[f] = v;
      cur.source = { ...(cur.source ?? {}), [f]: from };
      changed = true;
    }
    if (changed) vms[key] = cur;
  }
  return { ...plan, vms };
}
