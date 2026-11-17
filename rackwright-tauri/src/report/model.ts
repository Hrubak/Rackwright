// Pure report model: no React, no fetch, no DOM.
import type { Doc } from "../types";
import type { ClientItem } from "../clients/store";
import type { ReportOptions } from "./types";
import { addStats, docStats, inventoryRows, typeTotals, zero } from "../clients/util";
import type { InvRow } from "../clients/util";
import { clientAlerts, todayIso } from "../attention/model";
import type { Alert } from "../attention/model";
import { powerBudget } from "../power/model";
import { switchPorts, switchesOf } from "../views/switchPorts";

export interface SwitchMap { name: string; ports: { name: string; used: boolean; to: string; type: string; ip: string }[] }
export interface SiteSection {
  id: number; name: string; address: string;
  racks: { key: string; name: string; doc?: Doc; error?: string }[];
  devices: InvRow[]; switches: SwitchMap[];
}
export interface LinkRow { kind: string; from: string; to: string; provider: string; circuit: string; bandwidth: string }
export interface ReportModel {
  title: string; date: string; preparedFor: string; preparedBy: string; level: ReportOptions["level"];
  summary: string; recommendations: string;
  totals: { sites: number; racks: number; usedU: number; totalU: number; devices: number; byType: [string, number][] };
  attention: Alert[];
  power: { siteId: number; site: string; rack: string; w: number; unknown: number; circuit: string; amps: number }[];
  sites: SiteSection[]; links: LinkRow[]; inventory: InvRow[];
  /** Chosen sites only, and the links touching them; for the links diagram. */
  client: ClientItem; docs: Record<string, Doc | string>;
}

export function buildReportModel(input: { client: ClientItem; docs: Record<string, Doc | string>; options: ReportOptions; company: string }): ReportModel {
  const { client, docs, options, company } = input;
  const chosen = client.sites.filter((s) => options.sites === "all" || options.sites.includes(s.id));
  const inventory: InvRow[] = [];
  let st = zero;
  const sites: SiteSection[] = chosen.map((s) => {
    const racks: SiteSection["racks"] = [];
    const devices: InvRow[] = [];
    const switches: SwitchMap[] = [];
    for (const r of s.racks) {
      const d = docs[r.key];
      if (d === undefined) { racks.push({ key: r.key, name: r.name, error: "Rack file not loaded." }); continue; }
      if (typeof d === "string") { racks.push({ key: r.key, name: r.name, error: d }); continue; }
      racks.push({ key: r.key, name: r.name, doc: d });
      st = addStats(st, docStats(d));
      devices.push(...inventoryRows(s.id, s.name, r.key, r.name, d));
      for (const sw of switchesOf(d)) {
        switches.push({
          name: sw.name,
          ports: switchPorts(d, sw).map((i) => ({
            name: i.port.name, used: i.kind !== "empty",
            to: i.far ? i.far + (i.farPort ? ` (${i.farPort})` : "") : "",
            type: i.type, ip: i.ip,
          })),
        });
      }
    }
    inventory.push(...devices);
    return { id: s.id, name: s.name, address: s.address, racks, devices, switches };
  });
  const nameOf = new Map(client.sites.map((s) => [s.id, s.name]));
  const ids = new Set(chosen.map((s) => s.id));
  const touching = client.links.filter((l) => ids.has(l.site_a) || (l.site_b != null && ids.has(l.site_b)));
  const keep = new Set(chosen.flatMap((s) => s.racks.map((r) => r.key)));
  const usedDocs: Record<string, Doc | string> = {};
  for (const k of Object.keys(docs)) if (keep.has(k)) usedDocs[k] = docs[k];
  const links: LinkRow[] = touching
    .map((l) => ({
      kind: l.kind, from: nameOf.get(l.site_a) ?? "Unknown site",
      to: l.site_b == null ? "Internet" : nameOf.get(l.site_b) ?? "Unknown site",
      provider: l.provider, circuit: l.circuit, bandwidth: l.bandwidth,
    }));
  const today = options.date || todayIso();
  // Run on the whole client so IP clashes with other sites still show, then keep the chosen sites; "not checked on site" waits for Site visit.
  const attention = clientAlerts(client, docs, today).filter((a) => a.kind !== "stale" && a.rackKey != null && keep.has(a.rackKey));
  const power: ReportModel["power"] = [];
  for (const sec of sites) for (const r of sec.racks) {
    if (!r.doc) continue;
    for (const p of powerBudget(r.doc).racks) {
      power.push({ siteId: sec.id, site: sec.name, rack: r.doc.racks.find((x) => x.id === p.rackId)?.name || r.name, w: p.w, unknown: p.unknown, circuit: p.circuit, amps: p.amps });
    }
  }
  return {
    title: `Network review — ${client.name}`, date: options.date, preparedFor: options.prepared_for, preparedBy: company,
    level: options.level, summary: options.summary, recommendations: options.recommendations,
    totals: { sites: sites.length, racks: st.racks, usedU: st.usedU, totalU: st.totalU, devices: st.devices, byType: typeTotals(inventory) },
    attention, power, sites, links, inventory,
    client: { ...client, sites: chosen, links: touching }, docs: usedDocs,
  };
}
