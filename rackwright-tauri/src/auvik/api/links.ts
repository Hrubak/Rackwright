// Auvik API cables -> neighbours on the plan devices, so the existing plan (buildLinks) draws them. Pure; no backend.ts import.
import type { AuvikDevice } from "../parse";
import type { AuvikLink } from "../../api";

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
