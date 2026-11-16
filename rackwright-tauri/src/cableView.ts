// Cable display options for the Rack view. Pure: which cables show, and where stubs and their labels go.
import type { Cable, Device, Doc } from "./types";

export type CableShow = "all" | "selected" | "none";
export type CableStyle = "routed" | "stubs";
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
      style: o.style === "stubs" ? "stubs" : "routed",
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
