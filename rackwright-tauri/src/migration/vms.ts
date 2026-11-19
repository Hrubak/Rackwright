// The VMs of a site, collected from its racks. Pure: no Tauri or backend imports.
import type { Doc, Device } from "../types";
import { INFRA_VM } from "../auvik/plan";
import type { MigrationPlan, VmEntry } from "./types";

export type Platform = "vmware" | "hyperv" | "scale" | "unknown";
export const PLATFORM_LABEL: Record<Platform, string> = { vmware: "VMware", hyperv: "Hyper-V", scale: "Scale HyperCore", unknown: "Unknown" };

export interface SiteVm { key: string; name: string; host: string; platform: Platform; rackKey: string; rackName: string; deviceId: number; ip: string; infra: boolean }

function platformOf(...texts: (string | undefined)[]): Platform {
  for (const t of texts) {
    if (!t) continue;
    if (/hyper-?v/i.test(t)) return "hyperv";
    if (/vmware|esxi/i.test(t)) return "vmware";
    if (/kvm|scale|hypercore/i.test(t)) return "scale";
  }
  return "unknown";
}

export function siteVms(racks: { key: string; name: string }[], docs: Record<string, Doc | string>): SiteVm[] {
  const out = new Map<string, SiteVm>();
  for (const r of racks) {
    const doc = docs[r.key];
    if (!doc || typeof doc === "string") continue;
    const add = (id: number, name: string, model: string, ip: string, rowKey: string | undefined, hostDev: Device | undefined, host: string) => {
      const key = rowKey ? `auvik:${rowKey}` : `${r.key}#${id}#${name}`;
      if (out.has(key)) return;
      const platform = platformOf(model, hostDev?.model, hostDev?.os, hostDev?.name);
      const infra = INFRA_VM.test(`${name} ${model}`) || /\bvcls\b/i.test(name);
      out.set(key, { key, name, host, platform, rackKey: r.key, rackName: r.name, deviceId: id, ip, infra });
    };
    for (const d of doc.devices) {
      if (d.type === "Virtual machines") {
        const h = d.vm_host != null ? doc.devices.find(x => x.id === d.vm_host) : undefined;
        for (const e of d.endpoints ?? []) add(d.id, e.name, e.model, e.ip, e.key, h, h?.name ?? "");
      } else {
        for (const e of d.endpoints ?? []) if (e.kind === "vm") add(d.id, e.name, e.model, e.ip, e.key, d, d.name);
        if (d.type !== "Endpoints" && (d.model ?? "").startsWith("Virtual Machine")) add(d.id, d.name, d.model ?? "", d.ip ?? "", d.auvik_id, undefined, "");
      }
    }
  }
  return [...out.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Names of racks whose file could not be read (error text) or is not loaded. */
export function unreadableRacks(racks: { key: string; name: string }[], docs: Record<string, Doc | string>): string[] {
  return racks.filter((r) => { const d = docs[r.key]; return !d || typeof d === "string"; }).map((r) => r.name);
}

export function defaultInclude(vm: SiteVm): { include: boolean; reason: string } {
  if (vm.infra) return { include: false, reason: "Infrastructure VM" };
  if (vm.platform === "scale") return { include: false, reason: "Already on Scale" };
  return { include: true, reason: "" };
}

export function isIncluded(vm: SiteVm, e?: VmEntry): boolean {
  return e?.include ?? defaultInclude(vm).include;
}

export function orphanKeys(plan: MigrationPlan, vms: SiteVm[]): string[] {
  const have = new Set(vms.map(v => v.key));
  return Object.keys(plan.vms).filter(k => !have.has(k)).sort();
}
