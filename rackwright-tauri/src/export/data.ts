// Shared, UI-free helpers for the PDF and Visio exports. Pure functions only (they also run under tsx in tests).
import { devDims, xOffset } from "../edit";
import { Device, Doc, PortPos, RouteResult, UH, RW, RAIL, HDR, PADB } from "../types";

export type Face = "front" | "rear";
export interface ExportData { front: RouteResult; rear: RouteResult; ports: PortPos[] }
export interface Bounds { l: number; t: number; r: number; b: number }

/** Device rectangle in world px. Mirrors devRect() in RackView.tsx (read-only copy; keep in step with it). */
export function devRect(doc: Doc, d: Device) {
  const { w, h } = devDims(d);
  const r = d.rack != null ? doc.racks.find((x) => x.id === d.rack) : undefined;
  if (r) {
    const t = r.y + HDR + (r.u - (d.u + d.u_size - 1)) * UH;
    const l = r.x + RAIL + xOffset(d);
    return { l, t, w, h };
  }
  return { l: d.fx, t: d.fy, w, h };
}

export const rackBox = (r: Doc["racks"][number]): Bounds => ({ l: r.x, t: r.y, r: r.x + RW + 2 * RAIL, b: r.y + HDR + r.u * UH + PADB });

/** Is the device drawn on this face? Same rule as RackView. */
export const visibleOn = (d: Device, face: Face) => d.rack == null || d.face === face || d.face === "both";

/** Bounding box of everything drawn on a face (racks, loose devices, cable routes). */
export function contentBounds(doc: Doc, routes: RouteResult, face: Face): Bounds {
  const boxes: Bounds[] = doc.racks.map(rackBox);
  for (const d of doc.devices) {
    if (!visibleOn(d, face)) continue;
    const q = devRect(doc, d);
    boxes.push({ l: q.l, t: q.t, r: q.l + q.w, b: q.t + q.h + (d.rack == null ? 24 : 0) });
  }
  for (const r of routes.routes) for (const p of r.pts) boxes.push({ l: p[0], t: p[1], r: p[0], b: p[1] });
  if (!boxes.length) return { l: 0, t: 0, r: 100, b: 100 };
  return {
    l: Math.min(...boxes.map((x) => x.l)), t: Math.min(...boxes.map((x) => x.t)),
    r: Math.max(...boxes.map((x) => x.r)), b: Math.max(...boxes.map((x) => x.b)),
  };
}

export function portInfo(doc: Doc, pid: number): { dev: Device; name: string } | null {
  for (const d of doc.devices) { const p = d.ports.find((x) => x.id === pid); if (p) return { dev: d, name: p.name }; }
  return null;
}
const endText = (doc: Doc, pid: number) => { const i = portInfo(doc, pid); return i ? `${i.dev.name}:${i.name}` : `port ${pid}`; };

export interface CableRow { label: string; from: string; to: string; type: string; color: string; length: string }
export function cableRows(doc: Doc): CableRow[] {
  return doc.cables.map((c: any) => ({
    label: c.label || `#${c.id}`,
    from: endText(doc, c.a), to: endText(doc, c.b),
    type: c.type || "", color: c.color || "",
    length: c.length ? `${c.length}${c.unit ? " " + c.unit : ""}` : "",
  }));
}

export interface DeviceRow { rack: string; u: string; name: string; model: string; face: string }
export function deviceRows(doc: Doc): DeviceRow[] {
  const rows = doc.devices.map((d) => {
    const r = d.rack != null ? doc.racks.find((x) => x.id === d.rack) : undefined;
    const top = d.u + d.u_size - 1;
    return { d, rack: r?.name ?? "(off rack)", order: r ? doc.racks.indexOf(r) : 1e9, u: r ? (d.u_size > 1 ? `${d.u}-${top}` : `${d.u}`) : "-" };
  });
  rows.sort((a, b) => a.order - b.order || b.d.u - a.d.u);
  return rows.map(({ d, rack, u }) => ({ rack, u, name: d.name, model: d.model || d.type, face: d.face || "front" }));
}

export const safeName = (s: string) => s.replace(/[\/\:*?"<>|]+/g, "_").trim() || "rack";
export const docTitle = (doc: Doc, name?: string) => name || doc.racks.map((r) => r.name).join(", ") || "Rackwright";
