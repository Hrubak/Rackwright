// Pure helpers for clients (no backend imports, so tests can load them under Node).
import type { Doc } from "../types";

const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");
const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")));
export const baseOf = (p: string) => p.slice(Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")) + 1);
const isAbs = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
/** Path stored in the client file: relative when the rack is inside the client file's folder. */
export function relPath(clientPath: string, rackPath: string): string {
  const d = dirOf(clientPath), s = sepOf(clientPath);
  const norm = (x: string) => x.replace(/[\\/]/g, "/").toLowerCase();
  if (d && norm(rackPath).startsWith(norm(d) + "/")) return rackPath.slice(d.length + 1).replace(/[\\/]/g, s);
  return rackPath;
}
export function absPath(clientPath: string, stored: string): string {
  return isAbs(stored) ? stored : dirOf(clientPath) + sepOf(clientPath) + stored.replace(/[\\/]/g, sepOf(clientPath));
}

export function docStats(doc: Doc) {
  const rackIds = new Set(doc.racks.map((r) => r.id));
  const usedU = new Set<string>();
  for (const d of doc.devices) if (d.rack != null && rackIds.has(d.rack)) for (let i = 0; i < d.u_size; i++) usedU.add(`${d.rack}:${d.u + i}`);
  return {
    racks: doc.racks.length,
    devices: doc.devices.length,
    cables: doc.cables.length,
    ports: doc.devices.reduce((n, d) => n + d.ports.length, 0),
    usedU: usedU.size,
    totalU: doc.racks.reduce((n, r) => n + r.u, 0),
  };
}
export type Stats = ReturnType<typeof docStats>;
export const addStats = (a: Stats, b: Stats): Stats => ({ racks: a.racks + b.racks, devices: a.devices + b.devices, cables: a.cables + b.cables, ports: a.ports + b.ports, usedU: a.usedU + b.usedU, totalU: a.totalU + b.totalU });
export const zero: Stats = { racks: 0, devices: 0, cables: 0, ports: 0, usedU: 0, totalU: 0 };
export const statText = (s: Stats) => `${s.racks} rack${s.racks === 1 ? "" : "s"}, ${s.usedU}/${s.totalU}U used, ${s.devices} devices, ${s.cables} cables`;

