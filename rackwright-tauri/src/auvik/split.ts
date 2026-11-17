// Split one Auvik export into several, by the network each device sits on. Pure; no backend imports.
import type { ParsedAuvik } from "./parse";

const netsOf = (s: string) => (s || "").split(/[,;\r\n]+/).map((x) => x.trim()).filter(Boolean);

/** Every network named in the export with the number of devices on it, biggest first. */
export function networksOf(p: ParsedAuvik): { name: string; devices: number }[] {
  const c = new Map<string, number>();
  for (const d of p.devices) for (const n of new Set(netsOf(d.networks))) c.set(n, (c.get(n) || 0) + 1);
  return [...c.entries()].map(([name, devices]) => ({ name, devices })).sort((a, b) => b.devices - a.devices || a.name.localeCompare(b.name));
}

/** A device goes to the site of the first of its networks that has an assignment, otherwise to `fallback`.
 *  Links to devices in another site stay unresolved in that site's plan, which the planner already tolerates. */
export function splitBySite(p: ParsedAuvik, assign: Record<string, string>, fallback: string): Record<string, ParsedAuvik> {
  const out: Record<string, ParsedAuvik> = {};
  for (const d of p.devices) {
    const n = netsOf(d.networks).find((x) => Object.prototype.hasOwnProperty.call(assign, x) && assign[x]);
    const k = n ? assign[n] : fallback;
    (out[k] ??= { site: p.site, warnings: p.warnings, devices: [] }).devices.push(d);
  }
  return out;
}
