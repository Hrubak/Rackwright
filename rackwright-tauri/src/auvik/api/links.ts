// Auvik API cables -> neighbours on the plan devices, so the existing plan (buildLinks) draws them. Pure; no backend.ts import.
import type { AuvikDevice, ParsedAuvik } from "../parse";
import type { AuvikInventory, AuvikLink, AuvikLinks } from "../../api";
import { isEndpointMode, meaningful, portKey, type PlanItem } from "../plan";

/** The preview's one note about connections that were left out: links to devices the inventory does not list, plus the ones the server dropped
 *  (wireless, VLAN). "" when there are none. */
export function leftOutNote(inv: AuvikInventory, links: AuvikLinks | undefined | null): string {
  if (!links) return "";
  const ids = new Set(inv.devices.map((d) => d.id));
  const n = links.dropped + links.links.filter((l) => !ids.has(l.device) || !ids.has(l.peerDevice)).length;
  return n ? `${n} connection${n === 1 ? " was" : "s were"} left out (wireless, VLAN or devices Auvik doesn't list).` : "";
}

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
 *  switch neighbour. `sw` and `port` are the link the plan will use (an active switch, a known port first); the port is ""
 *  when the link has no port data. `attach` is false when ANY switch port the endpoint is wired to is an uplink (a switch,
 *  router or firewall is on it too) or is shared (another device lists it). That is decided from Auvik's raw neighbours,
 *  whatever the person skipped or made a VM: a skipped switch is still on the wire. Such an endpoint is not moved onto a switch. */
export function endpointPorts(parsed: ParsedAuvik, items: PlanItem[]): Map<string, { sw: string; port: string; attach: boolean }> {
  const byName = new Map<string, AuvikDevice>();
  for (const d of parsed.devices) if (!byName.has(d.rawName.toLowerCase())) byName.set(d.rawName.toLowerCase(), d);
  const itemOf = new Map<AuvikDevice, PlanItem>(items.map((i) => [i.dev, i]));
  const INFRA = ["switch", "router", "firewall"];
  const switchOf = (name: string): PlanItem | null => {   // any mode: a skipped switch is still a switch on the wire
    const o = byName.get(name.toLowerCase()), i = o && itemOf.get(o);
    return i && i.kind === "switch" ? i : null;
  };
  const slot = (sw: PlanItem, iface: string) => `${sw.key}|${portKey(iface)}`;
  /** The switch ports (known ones) this device is wired to. */
  const wired = (it: PlanItem) => it.dev.neighbors.flatMap((n) => { const sw = switchOf(n.name); return sw && sw !== it && meaningful("switch", n.iface) ? [{ sw, port: n.iface }] : []; });
  const uplink = new Set<string>(), users = new Map<string, number>();
  for (const it of items) {
    if (INFRA.includes(it.kind)) { for (const w of wired(it)) uplink.add(slot(w.sw, w.port)); continue; }
    for (const k of new Set(wired(it).map((w) => slot(w.sw, w.port)))) users.set(k, (users.get(k) ?? 0) + 1);
  }
  const out = new Map<string, { sw: string; port: string; attach: boolean }>();
  for (const it of items) {
    if (!isEndpointMode(it.mode)) continue;
    const cands = it.dev.neighbors.map((n) => ({ sw: switchOf(n.name), port: meaningful("switch", n.iface) ? n.iface : "" }))
      .filter((c): c is { sw: PlanItem; port: string } => !!c.sw && (c.sw.mode === "rack" || c.sw.mode === "off"));   // the plan places on an active switch only
    const best = cands.find((c) => c.port) ?? cands[0];
    if (!best) continue;
    const bad = wired(it).some((w) => uplink.has(slot(w.sw, w.port)) || (users.get(slot(w.sw, w.port)) ?? 0) > 1);
    out.set(it.key, { sw: best.sw.dev.name, port: best.port, attach: !bad });
  }
  return out;
}
