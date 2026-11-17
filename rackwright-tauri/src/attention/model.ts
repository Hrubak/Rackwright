// Attention model: what needs a look (warranty, UPS battery, load, stale racks, duplicate IPs). Pure, no UI.
import { feedFor, isPdu, isUps, powerBudget } from "../power/model";
import type { ClientItem } from "../clients/store";
import type { Device, Doc } from "../types";

export type Level = "critical" | "warning" | "info";
export interface Alert {
  level: Level; kind: "warranty" | "battery" | "load" | "stale" | "ip"; msg: string;
  rackKey?: string; rackId?: number; rackName?: string; devId?: number; devName?: string; ip?: string;
}
export interface IpEntry { rackKey: string; devId: number; name: string; ip: string }

const DAY = 86400000;
const parse = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : t;
};
export function daysUntil(date: string | undefined, today: string): number | null {
  const a = date ? parse(date) : null, b = parse(today);
  return a == null || b == null ? null : Math.round((a - b) / DAY);
}
export function addYears(date: string, n: number): string {
  const t = parse(date);
  if (t == null) return date;
  const d = new Date(t);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function validIp(s: string): boolean {
  const m = IPV4.exec(s);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  if (s === "0.0.0.0" || o[0] === 127 || o[3] === 255) return false;
  return true;
}
export function ipsOf(d: Device): string[] {
  const raw = [...(d.ip || "").split(/[,;\s]+/), ...(d.oobm?.ip || "").split(/[,;\s]+/)];
  const out: string[] = [];
  for (const s of raw) if (validIp(s) && !out.includes(s)) out.push(s);
  return out;
}

export function ipEntries(rackKey: string, doc: Doc): IpEntry[] {
  const out: IpEntry[] = [];
  for (const d of doc.devices) {
    if (d.status === "planned") continue;
    for (const ip of ipsOf(d)) out.push({ rackKey, devId: d.id, name: d.name, ip });
  }
  return out;
}
export function ipClashes(entries: IpEntry[]): Map<string, IpEntry[]> {
  const byIp = new Map<string, IpEntry[]>();
  for (const e of entries) { const l = byIp.get(e.ip); if (l) l.push(e); else byIp.set(e.ip, [e]); }
  const out = new Map<string, IpEntry[]>();
  for (const e of entries) {
    const key = `${e.rackKey}:${e.devId}`;
    for (const o of byIp.get(e.ip)!) {
      if (o.rackKey === e.rackKey && o.devId === e.devId) continue;
      const l = out.get(key); if (l) l.push(o); else out.set(key, [o]);
    }
  }
  return out;
}

export function deviceAlerts(doc: Doc, dev: Device, today: string, others: IpEntry[] = []): Alert[] {
  if (dev.status === "planned") return [];
  const out: Alert[] = [];
  const base = { devId: dev.id, devName: dev.name };
  const wd = daysUntil(dev.warranty_exp, today);
  if (wd != null) {
    if (wd < 0) out.push({ ...base, level: "critical", kind: "warranty", msg: `Warranty ended ${dev.warranty_exp}` });
    else if (wd <= 60) out.push({ ...base, level: "warning", kind: "warranty", msg: `Warranty ends in ${wd} days` });
  }
  if (isUps(dev) && dev.battery_date) {
    const due = addYears(dev.battery_date, 3);
    const bd = daysUntil(due, today);
    if (bd != null) {
      if (bd < 0) out.push({ ...base, level: "critical", kind: "battery", msg: `UPS battery replacement overdue (due ${due})` });
      else if (bd <= 60) out.push({ ...base, level: "warning", kind: "battery", msg: `UPS battery due in ${bd} days` });
    }
  }
  if (isUps(dev) || isPdu(dev)) {
    const f = feedFor(powerBudget(doc), dev.id);
    if (f && f.ratedW && f.loadW > 0) {
      const ratio = f.loadW / f.ratedW;
      if (ratio > 0.8) {
        const msg = `Load ${f.unknown > 0 ? "at least " : ""}${Math.round(f.loadW).toLocaleString("en-US")} W is ${Math.round(ratio * 100)}% of ${f.ratedW.toLocaleString("en-US")} W`;
        out.push({ ...base, level: ratio > 1 ? "critical" : "warning", kind: "load", msg });
      }
    }
  }
  const ips = new Set(others.map((o) => o.ip));
  for (const ip of ips) {
    const names = others.filter((o) => o.ip === ip).map((o) => o.name).join(", ");
    out.push({ ...base, level: "warning", kind: "ip", ip, msg: `IP ${ip} is also used by ${names}` });
  }
  return out;
}

export function docAlerts(rackKey: string, doc: Doc, today: string, clashes: Map<string, IpEntry[]>): Alert[] {
  const out: Alert[] = [];
  for (const d of doc.devices) {
    const rack = doc.racks.find((r) => r.id === d.rack);
    for (const a of deviceAlerts(doc, d, today, clashes.get(`${rackKey}:${d.id}`) || []))
      out.push({ ...a, rackKey, ...(rack ? { rackName: rack.name } : {}) });
  }
  for (const r of doc.racks) {
    if (!doc.devices.some((d) => d.rack === r.id)) continue;
    const base = { level: "info" as Level, kind: "stale" as const, rackKey, rackId: r.id, rackName: r.name };
    if (!r.last_verified) out.push({ ...base, msg: "Never checked on site" });
    else {
      const n = daysUntil(r.last_verified, today);
      if (n != null && n < -90) out.push({ ...base, msg: `Not checked on site since ${r.last_verified}` });
    }
  }
  return out;
}

const ORDER: Record<Level, number> = { critical: 0, warning: 1, info: 2 };
export function clientAlerts(client: ClientItem, docs: Record<string, Doc | string>, today: string): Alert[] {
  const loaded: { key: string; doc: Doc }[] = [];
  for (const s of client.sites) for (const r of s.racks) {
    const d = docs[r.key];
    if (d && typeof d !== "string") loaded.push({ key: r.key, doc: d });
  }
  const clashes = ipClashes(loaded.flatMap((l) => ipEntries(l.key, l.doc)));
  const all = loaded.flatMap((l) => docAlerts(l.key, l.doc, today, clashes));
  return all.sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.msg.localeCompare(b.msg));
}

export function countLevels(alerts: Alert[]): Record<Level, number> {
  const c: Record<Level, number> = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) c[a.level]++;
  return c;
}
export function groupInfo(alerts: Alert[]): { shown: Alert[]; staleRacks: number } {
  const stale = alerts.filter((a) => a.level === "info" && a.kind === "stale");
  return { shown: alerts.filter((a) => !(a.level === "info" && a.kind === "stale")), staleRacks: stale.length };
}
