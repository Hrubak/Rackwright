// Pure helpers for the attention lists: tag alerts with their client and merge several clients, critical first.
import type { ClientItem } from "../clients/store";
import type { Doc } from "../types";
import { Alert, Level, clientAlerts } from "./model";

export type TaggedAlert = Alert & { clientKey?: string; clientName?: string };
const ORDER: Record<Level, number> = { critical: 0, warning: 1, info: 2 };

export function allClientAlerts(clients: ClientItem[], docs: Record<string, Doc | string>, today: string): TaggedAlert[] {
  const out: TaggedAlert[] = [];
  for (const c of clients) for (const a of clientAlerts(c, docs, today)) out.push({ ...a, clientKey: c.key, clientName: c.name });
  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
/** True while any rack document of these clients has not finished loading. */
export const stillLoading = (clients: ClientItem[], docs: Record<string, Doc | string>): boolean =>
  clients.some((c) => c.sites.some((s) => s.racks.some((r) => docs[r.key] === undefined)));
