// Power model: watts per device, load per UPS/PDU feed, rack and circuit totals. Pure, no UI.
import { CATALOG, isOutlet, portOf } from "../edit";
import type { Tpl } from "../edit";
import type { Device, Doc } from "../types";

const MAX_DEPTH = 6;

export interface Feed { devId: number; kind: "ups" | "pdu"; loadW: number; unknown: number; ratedW: number | null; pct: number | null }
export interface RackPower { rackId: number; w: number; unknown: number; circuit: string; volts: 120 | 208; amps: number }
export interface CircuitPower { name: string; volts: 120 | 208; w: number; unknown: number; amps: number; racks: string[] }
export interface PowerBudget { feeds: Feed[]; racks: RackPower[]; circuits: CircuitPower[]; w: number; unknown: number }

export function catalogFor(d: Device): Tpl | null {
  const m = d.model || "";
  if (m) {
    const byModel = CATALOG.find((t) => t.model && t.model === m);
    if (byModel) return byModel;
    const byName = CATALOG.find((t) => t.name === m);
    if (byName) return byName;
  }
  return null;
}

export function devWatts(d: Device): number | null {
  if (d.power_w != null) return d.power_w;
  return catalogFor(d)?.power_w ?? null;
}
export function ratedW(d: Device): number | null {
  if (d.rated_w != null) return d.rated_w;
  return catalogFor(d)?.rated_w ?? null;
}
const BATTERY = /battery pack|EBM|battery module/i;
export const isUps = (d: Device): boolean => d.type === "UPS" && !BATTERY.test(d.model || "") && !BATTERY.test(d.name || "");
export const isPdu = (d: Device): boolean => d.type === "PDU";
const isFeedDev = (d: Device) => isUps(d) || isPdu(d);

const round1 = (n: number) => Math.round(n * 10) / 10;
export const btu = (w: number): number => Math.round(w * 3.412);
export function fmtW(w: number, unknown: number): string {
  const n = `${Math.round(w).toLocaleString("en-US")} W`;
  if (unknown > 0 && w === 0) return "Power unknown";
  if (unknown > 0) return `at least ${n}, ${unknown} ${unknown === 1 ? "device" : "devices"} unknown`;
  return n;
}
export const feedFor = (b: { feeds: Feed[] }, devId: number): Feed | undefined => b.feeds.find((f) => f.devId === devId);

// Far end of a cable from port id, or null.
function farPort(doc: Doc, pid: number): number | null {
  for (const c of doc.cables) { if (c.a === pid) return c.b; if (c.b === pid) return c.a; }
  return null;
}
const connectedInlets = (doc: Doc, d: Device) =>
  d.ports.filter((p) => p.type === "Power" && !isOutlet(p) && farPort(doc, p.id) != null).length;

function computeFeed(doc: Doc, root: Device): Feed {
  const reached = new Map<number, number>(); // device id -> inlets reached from this feed
  const nested: Device[] = [];
  const visited = new Set<number>([root.id]);
  const walk = (feed: Device, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const p of feed.ports) {
      if (!isOutlet(p)) continue;
      const far = farPort(doc, p.id);
      if (far == null) continue;
      const t = portOf(doc, far);
      if (!t || isOutlet(t.p) || t.d.id === root.id) continue;
      if (isFeedDev(t.d)) {
        if (visited.has(t.d.id)) continue;
        visited.add(t.d.id); nested.push(t.d);
        walk(t.d, depth + 1);
      } else reached.set(t.d.id, (reached.get(t.d.id) || 0) + 1);
    }
  };
  walk(root, 1);
  let loadW = 0, unknown = 0;
  for (const [id, n] of reached) {
    const d = doc.devices.find((x) => x.id === id)!;
    const w = devWatts(d);
    if (w == null) { unknown++; continue; }
    loadW += (w * n) / Math.max(1, connectedInlets(doc, d));
  }
  for (const d of nested) if (d.power_w != null) loadW += d.power_w;
  const rated = ratedW(root);
  return {
    devId: root.id, kind: isUps(root) ? "ups" : "pdu", loadW, unknown, ratedW: rated,
    pct: rated && !(loadW === 0 && unknown > 0) ? Math.round((loadW / rated) * 100) : null,
  };
}

export function powerBudget(doc: Doc): PowerBudget {
  const feeds = doc.devices.filter(isFeedDev).map((d) => computeFeed(doc, d));

  const counts = (d: Device): { w: number; unknown: number } => {
    if (isFeedDev(d)) return { w: d.power_w ?? 0, unknown: 0 };
    const w = devWatts(d);
    return w == null ? { w: 0, unknown: 1 } : { w, unknown: 0 };
  };
  const racks: RackPower[] = doc.racks.map((r) => {
    let w = 0, unknown = 0;
    for (const d of doc.devices) if (d.rack === r.id) { const c = counts(d); w += c.w; unknown += c.unknown; }
    const volts: 120 | 208 = r.volts === 208 ? 208 : 120;
    return { rackId: r.id, w, unknown, circuit: r.circuit || "", volts, amps: round1(w / volts) };
  });

  const circuits: CircuitPower[] = [];
  for (const rp of racks) {
    if (!rp.circuit) continue;
    let c = circuits.find((x) => x.name === rp.circuit);
    if (!c) circuits.push(c = { name: rp.circuit, volts: rp.volts, w: 0, unknown: 0, amps: 0, racks: [] });
    c.w += rp.w; c.unknown += rp.unknown;
    c.racks.push(doc.racks.find((r) => r.id === rp.rackId)!.name);
  }
  for (const c of circuits) c.amps = round1(c.w / c.volts);

  const rackIds = new Set(doc.racks.map((r) => r.id));
  let w = racks.reduce((s, r) => s + r.w, 0), unknown = racks.reduce((s, r) => s + r.unknown, 0);
  for (const d of doc.devices) if (d.rack == null || !rackIds.has(d.rack)) { const c = counts(d); w += c.w; unknown += c.unknown; }
  return { feeds, racks, circuits, w, unknown };
}
