// Cables between different racks of the same document (pure; tests load this under Node).
import type { Doc } from "../types";
import { cableKind } from "../cableKind";
import { spotId } from "./model";
import type { Room } from "./types";

export interface FloorLink { a: string; b: string; data: number; power: number }

export function floorLinks(room: Room, docs: Record<string, Doc | string>): FloorLink[] {
  const here = new Set(room.racks.map(spotId));
  const out = new Map<string, FloorLink>();
  const keys = new Set(room.racks.map((s) => s.key));
  for (const key of keys) {
    const doc = docs[key];
    if (!doc || typeof doc === "string") continue;
    const portDev = new Map<number, number | null>();
    for (const d of doc.devices) for (const p of d.ports) portDev.set(p.id, d.rack);
    for (const c of doc.cables) {
      const ra = portDev.get(c.a), rb = portDev.get(c.b);
      if (ra == null || rb == null || ra === rb) continue;
      const lo = Math.min(ra, rb), hi = Math.max(ra, rb);
      const a = `${key}#${lo}`, b = `${key}#${hi}`;
      if (!here.has(a) || !here.has(b)) continue;
      const k = `${a}|${b}`;
      const l = out.get(k) ?? { a, b, data: 0, power: 0 };
      if (cableKind(c.type) === "power") l.power++; else l.data++;
      out.set(k, l);
    }
  }
  return [...out.values()];
}
