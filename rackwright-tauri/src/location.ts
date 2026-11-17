import type { ClientItem, RackItem } from "./clients/store";

export interface RackLocation { clientKey: string; client: string; siteId: number; site: string }

/** First site whose racks contain a match. */
export function findRackLocation(clients: ClientItem[], match: (r: RackItem) => boolean): RackLocation | null {
  for (const c of clients) for (const s of c.sites) {
    if (s.racks.some(match)) return { clientKey: c.key, client: c.name, siteId: s.id, site: s.name };
  }
  return null;
}

/** Desktop path compare: case-insensitive, `\` equals `/`. */
export function sameFile(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  return n(a) === n(b);
}
