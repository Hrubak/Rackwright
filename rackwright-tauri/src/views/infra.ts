// Auto layout for the Infrastructure view. Pure: takes a Doc, returns boxes and lines.
import type { Device, Doc } from "../types";
import { portOf } from "../edit";
import { kindCounts } from "./kinds";

export const HIDDEN_TYPES = new Set(["Endpoints", "Virtual machines", "Patch panel", "Cable manager", "Shelf", "Blank"]);
export const isInfra = (d: Device) => !HIDDEN_TYPES.has(d.type);
export const NODE_W = 150, NODE_H = 46, GAP_X = 30, ROW_GAP = 70, EX_H = 36, EX_GAP = 6, MAX_PER_ROW = 8;

export function isPowerCable(doc: Doc, c: { type?: string; a: number; b: number }): boolean {
  if (/power|c13|c14|iec|mains/i.test(c.type || "")) return true;
  const a = portOf(doc, c.a), b = portOf(doc, c.b);
  return a?.p.type === "Power" || b?.p.type === "Power";
}

const edgeType = (d: Device) => d.type === "Firewall" || d.type === "Router" || d.type === "Modem/ISP";
const catRank = (d: Device) => { const i = ["Server", "Storage", "Wireless", "UPS", "PDU"].indexOf(d.type); return i < 0 ? 5 : i; };

export interface EdgeCable { id: number; a: string; b: string; type: string }
export interface InfraEdge { key: string; a: number; b: number; power: boolean; count: number; cables: EdgeCable[] }
export interface InfraNode { id: number; dev: Device; layer: number; x: number; y: number; w: number; h: number }
export interface InfraExtra { key: string; kind: "endpoints" | "vm"; devId: number; host: number | null; x: number; y: number; w: number; h: number; title: string; sub: string }
export interface InfraLayout { nodes: InfraNode[]; edges: InfraEdge[]; extras: InfraExtra[]; width: number; height: number }

/** One line per device pair (and per power / data), counting the cables between them. */
export function infraEdges(doc: Doc): InfraEdge[] {
  const infra = new Set(doc.devices.filter(isInfra).map((d) => d.id));
  const m = new Map<string, InfraEdge>();
  for (const c of doc.cables) {
    const a = portOf(doc, c.a), b = portOf(doc, c.b);
    if (!a || !b || a.d.id === b.d.id || !infra.has(a.d.id) || !infra.has(b.d.id)) continue;
    const power = isPowerCable(doc, c);
    const [x, y, px, py] = a.d.id < b.d.id ? [a.d.id, b.d.id, a.p.name, b.p.name] : [b.d.id, a.d.id, b.p.name, a.p.name];
    const key = `${x}-${y}${power ? "p" : ""}`;
    let e = m.get(key); if (!e) m.set(key, e = { key, a: x, b: y, power, count: 0, cables: [] });
    e.count++; e.cables.push({ id: c.id, a: px, b: py, type: c.type || "" });
  }
  return [...m.values()].sort((p, q) => (p.key < q.key ? -1 : 1));
}

/** Row group of each infrastructure device: 0 edge (firewall, router, modem), 1 core switch, 2 access switch, 3 everything else. */
export function layerOf(doc: Doc, edges: InfraEdge[]): Map<number, number> {
  const devs = doc.devices.filter(isInfra);
  const byId = new Map(devs.map((d) => [d.id, d]));
  const adj = new Map<number, number[]>(devs.map((d) => [d.id, []]));
  for (const e of edges) if (!e.power) { adj.get(e.a)!.push(e.b); adj.get(e.b)!.push(e.a); }
  const walk = (id: number) => { const d = byId.get(id)!; return edgeType(d) || d.type === "Switch"; };
  const seeds = devs.filter(edgeType).map((d) => d.id);
  const hasEdge = seeds.length > 0;
  if (!hasEdge) { // no firewall: the best-connected switch acts as the top
    let best: Device | null = null, bn = -1;
    for (const d of devs.filter((x) => x.type === "Switch").sort((p, q) => p.name.localeCompare(q.name))) {
      const n = new Set(adj.get(d.id)!.filter((x) => byId.get(x)!.type === "Switch")).size;
      if (n > bn) { bn = n; best = d; }
    }
    if (best) seeds.push(best.id);
  }
  const dist = new Map<number, number>(seeds.map((s) => [s, 0]));
  const q = [...seeds];
  for (let i = 0; i < q.length; i++) {
    for (const n of adj.get(q[i])!) if (!dist.has(n) && walk(n)) { dist.set(n, dist.get(q[i])! + 1); q.push(n); }
  }
  const out = new Map<number, number>();
  for (const d of devs) {
    if (edgeType(d)) out.set(d.id, 0);
    else if (d.type === "Switch") { const k = dist.get(d.id); out.set(d.id, hasEdge ? (k === 1 ? 1 : 2) : (k === 0 ? 1 : 2)); }
    else out.set(d.id, 3);
  }
  return out;
}

export function infraLayout(doc: Doc, maxPerRow = MAX_PER_ROW): InfraLayout {
  const devs = doc.devices.filter(isInfra);
  const edges = infraEdges(doc);
  const layer = layerOf(doc, edges);
  const byId = new Map(doc.devices.map((d) => [d.id, d]));
  const nb = new Map<number, { id: number; power: boolean }[]>(devs.map((d) => [d.id, []]));
  for (const e of edges) { nb.get(e.a)!.push({ id: e.b, power: e.power }); nb.get(e.b)!.push({ id: e.a, power: e.power }); }

  // extras: endpoint chips under their switch, VM boxes under their host
  type Ex = Omit<InfraExtra, "x" | "y" | "w" | "h">;
  const exOf = new Map<number, Ex[]>(), loose: Ex[] = [];
  const attach = (host: number | null, ex: Ex) => {
    if (host != null && nb.has(host)) { if (!exOf.has(host)) exOf.set(host, []); exOf.get(host)!.push(ex); } else loose.push({ ...ex, host: null });
  };
  for (const d of doc.devices.slice().sort((a, b) => a.id - b.id)) {
    if (d.type === "Endpoints") {
      const cnt = new Map<number, number>();
      for (const p of d.ports) for (const c of doc.cables) {
        const o = c.a === p.id ? c.b : c.b === p.id ? c.a : 0; if (!o) continue;
        const f = portOf(doc, o); if (f && nb.has(f.d.id)) cnt.set(f.d.id, (cnt.get(f.d.id) || 0) + 1);
      }
      const host = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
      const eps = d.endpoints || [], n = eps.length || d.ports.length;
      attach(host, { key: `e${d.id}`, kind: "endpoints", devId: d.id, host, title: `${n} endpoint${n === 1 ? "" : "s"}`, sub: kindCounts(eps) });
    } else if (d.type === "Virtual machines") {
      const hd = d.vm_host != null ? byId.get(d.vm_host) : undefined, n = d.endpoints?.length ?? d.ports.length;
      attach(hd ? hd.id : null, { key: `v${d.id}`, kind: "vm", devId: d.id, host: hd ? hd.id : null, title: hd ? `VMs on ${hd.name}: ${n}` : d.name, sub: d.endpoints ? kindCounts(d.endpoints) || `${n} VMs` : `${n} VMs` });
    }
  }

  // rows: by category, then by the average x of what they connect to above
  const layers = [...new Set(layer.values())].sort((a, b) => a - b);
  const pos = new Map<number, number>();
  const rows: { layer: number; ids: number[] }[] = [];
  for (const L of layers) {
    const members = devs.filter((d) => layer.get(d.id) === L);
    const bary = (d: Device) => {
      const all = nb.get(d.id)!.filter((n) => pos.has(n.id));
      const data = all.filter((n) => !n.power);
      const ps = (data.length ? data : all).map((n) => pos.get(n.id)!);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
    };
    const keyed = members.map((d) => ({ d, c: L === 3 ? catRank(d) : 0, b: L === 0 ? 0 : bary(d) }));
    keyed.sort((p, q) => p.c - q.c || (p.b === q.b ? 0 : p.b < q.b ? -1 : 1) || p.d.name.localeCompare(q.d.name) || p.d.id - q.d.id);
    for (let i = 0; i < keyed.length; i += maxPerRow) {
      const chunk = keyed.slice(i, i + maxPerRow).map((k) => k.d.id);
      chunk.forEach((id, j) => pos.set(id, (j - (chunk.length - 1) / 2) * (NODE_W + GAP_X)));
      rows.push({ layer: L, ids: chunk });
    }
  }

  const nodes: InfraNode[] = [], extras: InfraExtra[] = [];
  let y = 0;
  for (const r of rows) {
    const tall = Math.max(0, ...r.ids.map((id) => exOf.get(id)?.length || 0));
    r.ids.forEach((id, j) => {
      const x = (j - (r.ids.length - 1) / 2) * (NODE_W + GAP_X) - NODE_W / 2;
      nodes.push({ id, dev: byId.get(id)!, layer: r.layer, x, y, w: NODE_W, h: NODE_H });
      (exOf.get(id) || []).forEach((e, k) => extras.push({ ...e, x, y: y + NODE_H + EX_GAP + k * (EX_H + EX_GAP), w: NODE_W, h: EX_H }));
    });
    y += NODE_H + (tall ? tall * (EX_H + EX_GAP) + EX_GAP : 0) + ROW_GAP;
  }
  if (loose.length) {
    loose.forEach((e, j) => extras.push({ ...e, x: (j - (loose.length - 1) / 2) * (NODE_W + GAP_X) - NODE_W / 2, y, w: NODE_W, h: EX_H }));
    y += EX_H;
  } else y -= ROW_GAP;
  const all = [...nodes, ...extras];
  const minX = Math.min(0, ...all.map((n) => n.x)), maxX = Math.max(0, ...all.map((n) => n.x + n.w));
  for (const n of all) n.x -= minX;
  return { nodes, edges, extras, width: maxX - minX, height: Math.max(0, y) };
}
