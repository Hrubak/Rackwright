// Pure helpers for clients (no backend imports, so tests can load them under Node).
import type { Doc } from "../types";
import { cableKind } from "../cableKind";
import type { ClientItem } from "./store";

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


// ---------------------------------------------------------------- inventory (3.2.0)

/** One line of a client's inventory: a device, or an endpoint seen on a device's port (Auvik). */
export interface InvRow {
  siteId: number; site: string; rackKey: string; rackFile: string;
  devId: number; kind: "device" | "endpoint";
  name: string; type: string; model: string; ip: string; mac: string; serial: string;
  /** Where it is: "MDF U12", "off-rack", or "on SW1 port 7" for endpoints. */
  where: string;
  notes: string;
}

export function inventoryRows(siteId: number, site: string, rackKey: string, rackFile: string, doc: Doc, endpoints = false): InvRow[] {
  const rackName = new Map(doc.racks.map((r) => [r.id, r.name]));
  const out: InvRow[] = [];
  for (const d of doc.devices) {
    const where = d.rack != null && rackName.has(d.rack) ? `${rackName.get(d.rack)} U${d.u}${d.u_size > 1 ? `-${d.u + d.u_size - 1}` : ""}` : "off-rack";
    out.push({
      siteId, site, rackKey, rackFile, devId: d.id, kind: "device",
      name: d.name || "", type: d.type || "", model: d.model || d.auvik_model || "", ip: d.ip || "", mac: d.mac || (d.auvik_macs ?? []).join(", "),
      serial: d.serial || "", where, notes: d.notes || "",
    });
    if (endpoints) for (const e of d.endpoints ?? []) {
      out.push({
        siteId, site, rackKey, rackFile, devId: d.id, kind: "endpoint",
        name: e.name || "", type: e.type || e.kind || "", model: e.model || "", ip: e.ip || "", mac: e.mac || "", serial: "",
        where: `on ${d.name || "device"}${e.port ? ` port ${e.port}` : ""}`, notes: e.status || "",
      });
    }
  }
  return out;
}

const normMac = (s: string) => s.toLowerCase().replace(/[^0-9a-f]/g, "");
/** Every word of the query must appear somewhere in the row. MACs match with or without separators. */
export function matchRow(r: InvRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.name, r.type, r.model, r.ip, r.mac, r.serial, r.where, r.site, r.rackFile, r.notes].join(" ").toLowerCase();
  const macs = normMac(r.mac);
  return words.every((w) => hay.includes(w) || (normMac(w).length >= 4 && macs.includes(normMac(w))));
}

/** Count of rows per type, most common first. */
export function typeTotals(rows: InvRow[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.type || "Other", (m.get(r.type || "Other") || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s);
export function inventoryCsv(rows: InvRow[]): string {
  const head = ["Site", "Rack file", "Kind", "Name", "Type", "Model", "IP", "MAC", "Serial", "Location", "Notes"];
  const lines = [head, ...rows.map((r) => [r.site, r.rackFile, r.kind, r.name, r.type, r.model, r.ip, r.mac, r.serial, r.where, r.notes])];
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- site-to-site links

export const LINK_KINDS = ["VPN", "MPLS", "Fiber", "Internet", "Wireless", "SD-WAN", "Other"] as const;
export const LINK_COLORS: Record<string, string> = {
  VPN: "#58a6ff", MPLS: "#d29922", Fiber: "#3fb950", Internet: "#a371f7", Wireless: "#f778ba", "SD-WAN": "#39c5cf", Other: "#8b949e", // theme-ok
};
export const linkColor = (kind: string) => LINK_COLORS[kind] ?? LINK_COLORS.Other;
/** Short text for a link, e.g. "VPN · 500 Mbps". */
export const linkLabel = (l: { kind: string; bandwidth?: string }) => [l.kind || "Other", (l.bandwidth || "").trim()].filter(Boolean).join(" · ");

export interface Pt { x: number; y: number }
/** Centres for the site boxes (by site id) and the Internet cloud (null when no link goes to the Internet). */
export function layoutSites(siteIds: number[], hasInternet: boolean, w: number, h: number): { sites: Record<number, Pt>; internet: Pt | null } {
  const sites: Record<number, Pt> = {};
  const n = siteIds.length;
  const top = hasInternet ? 0.22 : 0;
  const cy = h * (top + (1 - top) / 2);
  if (n === 1) sites[siteIds[0]] = { x: w / 2, y: cy };
  else if (n === 2) { sites[siteIds[0]] = { x: w * 0.25, y: cy }; sites[siteIds[1]] = { x: w * 0.75, y: cy }; }
  else {
    const rx = w * 0.36, ry = (1 - top) * h * 0.36;
    siteIds.forEach((id, i) => {
      const a = Math.PI / 2 + (2 * Math.PI * i) / n;
      sites[id] = { x: w / 2 + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });
  }
  return { sites, internet: hasInternet ? { x: w / 2, y: h * 0.11 } : null };
}

// ---------------------------------------------------------------- cabling (3.11.0)

export interface CableRow {
  site: string; rack: string; rackKey: string; cableId: number;
  from: string; fromPort: string; to: string; toPort: string;
  kind: string; label: string; colour: string; length: string;
}

/** Every cable in a client's racks, one row each. Racks that could not be read (error text) are skipped. */
export function cablingRows(client: ClientItem, docs: Record<string, Doc | string>): CableRow[] {
  const out: CableRow[] = [];
  for (const s of client.sites) for (const r of s.racks) {
    const doc = docs[r.key];
    if (!doc || typeof doc === "string") continue;
    const at = new Map<number, { dev: string; port: string }>();
    for (const d of doc.devices) for (const p of d.ports) at.set(p.id, { dev: d.name || "", port: p.name || "" });
    for (const c of doc.cables) {
      const a = at.get(c.a), b = at.get(c.b);
      out.push({
        site: s.name, rack: r.name, rackKey: r.key, cableId: c.id,
        from: a?.dev ?? "", fromPort: a?.port ?? "", to: b?.dev ?? "", toPort: b?.port ?? "",
        kind: cableKind(c.type), label: c.label || "", colour: c.color || "",
        length: c.length ? `${c.length} ${c.unit || ""}`.trim() : "",
      });
    }
  }
  const k = (r: CableRow) => [r.site, r.rack, r.from].map((x) => x.toLowerCase());
  return out.sort((x, y) => { const a = k(x), b = k(y); for (let i = 0; i < 3; i++) { const d = a[i].localeCompare(b[i]); if (d) return d; } return 0; });
}

export function cablingCsv(rows: CableRow[]): string {
  const head = ["Site", "Rack", "From", "From port", "To", "To port", "Kind", "Label", "Colour", "Length"];
  const lines = [head, ...rows.map((r) => [r.site, r.rack, r.from, r.fromPort, r.to, r.toPort, r.kind, r.label, r.colour, r.length])];
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
