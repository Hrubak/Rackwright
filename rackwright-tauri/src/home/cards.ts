// Numbers and colours for the Clients dashboard cards (pure, so tests can load it under Node).
import type { Doc } from "../types";
import type { ClientItem } from "../clients/store";
import { Stats, addStats, docStats, zero } from "../clients/util";
import type { Token } from "../theme";
import { clientAlerts, countLevels, type Level } from "../attention/model";

export interface CardStats {
  stats: Stats;
  usedPct: number;
  /** Names of racks whose document could not be read; they are left out of the numbers. */
  failed: string[];
  sites: { id: number; name: string; racks: number }[];
  /** Alert counts for this client (info included; cards show critical and warning only). */
  alerts: Record<Level, number>;
}

export function cardStats(client: ClientItem, docs: Record<string, Doc | string>, today = new Date().toLocaleDateString("en-CA")): CardStats {
  let stats: Stats = zero;
  const failed: string[] = [];
  for (const s of client.sites) for (const r of s.racks) {
    const d = docs[r.key];
    if (typeof d === "string") failed.push(r.name);
    else if (d) stats = addStats(stats, docStats(d));
  }
  return {
    stats,
    usedPct: stats.totalU ? Math.round((stats.usedU / stats.totalU) * 100) : 0,
    failed,
    alerts: countLevels(clientAlerts(client, docs, today)),
    sites: client.sites.map((s) => ({ id: s.id, name: s.name, racks: s.racks.length })),
  };
}

const TOKENS: Token[] = ["accent", "ok", "warn", "danger", "focus", "link"];
/** Stable theme colour for a client: a hash of its key. */
export function clientToken(key: string): Token {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TOKENS[h % TOKENS.length];
}

export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
