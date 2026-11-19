// Auvik API cables -> neighbours on the plan devices, so the existing plan (buildLinks) draws them. Pure; no backend.ts import.
import type { AuvikDevice, ParsedAuvik } from "../parse";
import type { AuvikLink } from "../../api";
import { isEndpointMode, meaningful, portKey, type PlanItem } from "../plan";

/** What a port-less cable shows in place of a port. */
export const NO_PORT = "no port data";

/** Adds each link to both devices' neighbours, in response order ("A lists B through X" means X is B's port), so
 *  buildLinks pairs several cables between one pair in order. A link whose device is not in the list is counted in
 *  `unresolved`. Every port-less link adds a neighbour with no port to both ends; `portless` lists those pairs by name,
 *  so the caller can drop them once it knows which ends are endpoints. */
export function linksToNeighbors(devs: AuvikDevice[], links: AuvikLink[]): { unresolved: number; portless: { a: string; b: string }[] } {
  const byId = new Map<string, AuvikDevice>();
  for (const d of devs) if (d.apiId) byId.set(d.apiId, d);
  let unresolved = 0;
  const portless: { a: string; b: string }[] = [];
  for (const l of links) {
    const a = byId.get(l.device), b = byId.get(l.peerDevice);
    if (!a || !b) { unresolved++; continue; }
    if (a === b) continue;
    a.neighbors.push({ name: b.rawName, iface: l.peerIface });
    b.neighbors.push({ name: a.rawName, iface: l.iface });
    if (l.portless) portless.push({ a: a.name, b: b.name });
  }
  return { unresolved, portless };
}

/** The switch each endpoint hangs off, from the neighbours (call before the plan): key = item key of an endpoint with a
 *  switch neighbour. `port` is the switch's port, "" when the link has no port data. `attach` is false when that port also
 *  has a switch, router or firewall on it (an uplink), or when two or more endpoints list the same switch port: such an
 *  endpoint is not moved onto the switch. */
export function endpointPorts(parsed: ParsedAuvik, items: PlanItem[]): Map<string, { sw: string; port: string; attach: boolean }> {
  const byName = new Map<string, AuvikDevice>();
  for (const d of parsed.devices) if (!byName.has(d.rawName.toLowerCase())) byName.set(d.rawName.toLowerCase(), d);
  const itemOf = new Map<AuvikDevice, PlanItem>(items.map((i) => [i.dev, i]));
  const switchOf = (name: string): PlanItem | null => {
    const o = byName.get(name.toLowerCase()), i = o && itemOf.get(o);
    return i && i.kind === "switch" && i.mode !== "skip" ? i : null;
  };
  const found = new Map<string, { sw: PlanItem; port: string }>();
  for (const it of items) {
    if (!isEndpointMode(it.mode)) continue;
    const cands = it.dev.neighbors.map((n) => ({ sw: switchOf(n.name), port: n.iface })).filter((c): c is { sw: PlanItem; port: string } => !!c.sw)
      .map((c) => ({ sw: c.sw, port: meaningful("switch", c.port) ? c.port : "" }));
    const best = cands.find((c) => c.port) ?? cands[0];
    if (best) found.set(it.key, best);
  }
  const uplink = new Set<string>();   // "<switch key>|<port>" that a switch, router or firewall uses
  for (const it of items) {
    if (it.mode === "skip" || isEndpointMode(it.mode) || it.mode === "vm" || !["switch", "router", "firewall"].includes(it.kind)) continue;
    for (const n of it.dev.neighbors) { const sw = switchOf(n.name); if (sw && sw !== it && meaningful("switch", n.iface)) uplink.add(`${sw.key}|${portKey(n.iface)}`); }
  }
  const count = new Map<string, number>();
  const slot = (f: { sw: PlanItem; port: string }) => `${f.sw.key}|${portKey(f.port)}`;
  for (const f of found.values()) if (f.port) count.set(slot(f), (count.get(slot(f)) ?? 0) + 1);
  const out = new Map<string, { sw: string; port: string; attach: boolean }>();
  for (const [k, f] of found) out.set(k, { sw: f.sw.dev.name, port: f.port, attach: !f.port || (!uplink.has(slot(f)) && count.get(slot(f)) === 1) });
  return out;
}
