// Cable display options for the Rack view. Pure: which cables show, and where stubs and their labels go.
import type { Cable, Device, Doc } from "./types";

export type CableShow = "all" | "selected" | "none";
export type CableStyle = "routed" | "stubs" | "loose";
export interface CableOpts { show: CableShow; style: CableStyle; hideEndpoints: boolean }
export const DEFAULT_OPTS: CableOpts = { show: "all", style: "routed", hideEndpoints: false };
export const STUB_LEN = 18;
export const DENSE_PORTS = 24;

const KEY = "rw.cableOpts";
export function loadOpts(): CableOpts {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      show: o.show === "selected" || o.show === "none" ? o.show : "all",
      style: o.style === "stubs" || o.style === "loose" ? o.style : "routed",
      hideEndpoints: !!o.hideEndpoints,
    };
  } catch { return { ...DEFAULT_OPTS }; }
}
export function saveOpts(o: CableOpts) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ } }

type Sel = { kind: "cable" | "dev" | "rack"; id: number } | null;

const isEndpointDev = (d?: Device) => !!d && (d.type === "Endpoints" || d.type === "Virtual machines" || d.rack == null);

/** device ids at both ends of a cable */
export function cableEnds(doc: Doc, c: Cable): [Device | undefined, Device | undefined] {
  let a: Device | undefined, b: Device | undefined;
  for (const d of doc.devices) {
    if (!a && d.ports.some((p) => p.id === c.a)) a = d;
    if (!b && d.ports.some((p) => p.id === c.b)) b = d;
    if (a && b) break;
  }
  return [a, b];
}

/** True when the "hide endpoint cables" option hides this cable. */
export function isEndpointCable(doc: Doc, c: Cable): boolean {
  const [a, b] = cableEnds(doc, c);
  return isEndpointDev(a) || isEndpointDev(b);
}

/** Ids of the cables to draw. */
export function visibleCables(doc: Doc, o: CableOpts, selected: Sel, hoverDev: number | null): Set<number> {
  const out = new Set<number>();
  if (o.show === "none") return out;
  const byPort = new Map<number, number>();
  for (const d of doc.devices) for (const p of d.ports) byPort.set(p.id, d.id);
  for (const c of doc.cables) {
    if (o.hideEndpoints && isEndpointCable(doc, c)) continue;
    if (o.show === "selected") {
      const a = byPort.get(c.a), b = byPort.get(c.b);
      const hit = (selected?.kind === "cable" && selected.id === c.id)
        || (selected?.kind === "dev" && (a === selected.id || b === selected.id))
        || (hoverDev != null && (a === hoverDev || b === hoverDev));
      if (!hit) continue;
    }
    out.add(c.id);
  }
  return out;
}

/** Cables that show a connected-port dot: all non-hidden ones when lines are off. */
export function dotCables(doc: Doc, o: CableOpts): Set<number> {
  const out = new Set<number>();
  if (o.show !== "none") return out;
  for (const c of doc.cables) if (!(o.hideEndpoints && isEndpointCable(doc, c))) out.add(c.id);
  return out;
}

export function clipText(s: string, max: number): string { return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s; }

/** "→ switch :12", clipped. The full text goes in the hover title. */
export function stubText(far: { dev: string; port: string } | null): { short: string; full: string } {
  if (!far) return { short: "→ ?", full: "→ ?" };
  const full = `→ ${far.dev} :${far.port}`.trim();
  const portPart = far.port ? ` :${clipText(far.port, 6)}` : "";
  return { short: `→ ${clipText(far.dev, 12)}${portPart}`, full };
}

export interface Stub {
  cable: number; x: number; y: number; x2: number; y2: number; dir: 1 | -1; lane: number; dev: number;
  short: string; full: string; labelOn: boolean;
}
export interface StubEnd { cable: number; dev: number; pt: [number, number]; dir: number; far: { dev: string; port: string } | null }

/**
 * Stub geometry for every cabled port end. Along one device, neighbouring stubs alternate between two lengths (lanes),
 * so their labels do not sit on top of each other. A device with more than DENSE_PORTS stubs shows labels only on hover.
 */
export function layoutStubs(ends: StubEnd[], len = STUB_LEN): Stub[] {
  const byDev = new Map<number, StubEnd[]>();
  for (const e of ends) { const l = byDev.get(e.dev); if (l) l.push(e); else byDev.set(e.dev, [e]); }
  const out: Stub[] = [];
  for (const [dev, list] of byDev) {
    const dense = list.length > DENSE_PORTS;
    const sorted = list.slice().sort((p, q) => p.pt[1] - q.pt[1] || p.pt[0] - q.pt[0]);
    // lane = position among the stubs that share a row (same y) and a direction
    const rows = new Map<string, number>();
    for (const e of sorted) {
      const dir: 1 | -1 = e.dir < 0 ? -1 : 1, k = `${Math.round(e.pt[1])}|${dir}`;
      const lane = rows.get(k) ?? 0; rows.set(k, lane + 1);
      const l = len + (lane % 2) * 12;
      const t = stubText(e.far);
      out.push({ cable: e.cable, x: e.pt[0], y: e.pt[1], x2: e.pt[0], y2: e.pt[1] + dir * l, dir, lane: lane % 2, dev, short: t.short, full: t.full, labelOn: !dense });
    }
  }
  return out;
}

// ---- loose style: a patch cable hanging straight from port to port

/** A fixed number in [0, 1) for a cable id and a salt, so a cable keeps the same shape on every redraw. */
function jitter(id: number, salt: number): number {
  let x = (Math.imul(id | 0, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fin = (n: number) => (Number.isFinite(n) ? n : 0);
const pt = (x: number, y: number) => `${+fin(x).toFixed(2)} ${+fin(y).toFixed(2)}`;

type P = [number, number];
/** The loose cable's points: port a, out of the plug, two curve controls, into the plug, port b. */
function looseCurve(a: P, da: number, b: P, db: number, id: number): P[] {
  const sa = da < 0 ? -1 : 1, sb = db < 0 ? -1 : 1;
  const ax = fin(a[0]), ay = fin(a[1]), bx = fin(b[0]), by = fin(b[1]);
  const a1y = ay + sa * 10, b1y = by + sb * 10; // past the plug body
  const dist = Math.hypot(bx - ax, b1y - a1y);
  const k = clamp(0.35 * dist, 14, 110);
  const sag = clamp(0.16 * dist, 6, 64) * (0.7 + 0.6 * jitter(id, 1));
  const jx = (jitter(id, 2) - 0.5) * Math.min(14, dist * 0.08);
  return [[ax, ay], [ax, a1y], [ax + jx, a1y + sa * k + sag], [bx + jx, b1y + sb * k + sag], [bx, b1y], [bx, by]];
}

/** SVG path for the loose style: out of port a along da (+1 down, -1 up), one sagging curve, into port b along db. */
export function loosePath(a: P, da: number, b: P, db: number, id: number): string {
  const [p0, p1, c1, c2, p2, p3] = looseCurve(a, da, b, db, id);
  return `M${pt(...p0)}L${pt(...p1)}C${pt(...c1)} ${pt(...c2)} ${pt(...p2)}L${pt(...p3)}`;
}

/** Box around every loose cable as drawn (the curve sampled, not its control points), or null with no routes. */
export function looseBounds(routes: { cable: number; pts: P[]; dir_a: number; dir_b: number }[]): { l: number; t: number; r: number; b: number } | null {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const add = (x: number, y: number) => { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); };
  for (const rt of routes) {
    const n = rt.pts.length; if (!n) continue;
    const [p0, p1, c1, c2, p2, p3] = looseCurve(rt.pts[0], rt.dir_a, rt.pts[n - 1], rt.dir_b, rt.cable);
    add(...p0); add(...p3);
    for (let i = 0; i <= 24; i++) {
      const s = i / 24, u = 1 - s;
      const w0 = u * u * u, w1 = 3 * u * u * s, w2 = 3 * u * s * s, w3 = s * s * s;
      add(w0 * p1[0] + w1 * c1[0] + w2 * c2[0] + w3 * p2[0], w0 * p1[1] + w1 * c1[1] + w2 * c2[1] + w3 * p2[1]);
    }
  }
  return Number.isFinite(l) ? { l, t, r, b } : null;
}
