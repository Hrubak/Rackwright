// Site visit model: walk list and per-step edits on a Doc (pure, no UI).
import type { Device, Doc } from "../types";
import { setField, statusOf } from "../device/info";
import { setOffRack } from "../edit";

export type VisitField = "name" | "status" | "manufacturer" | "model" | "serial" | "asset_tag" | "ip";
export const VISIT_FIELDS: { key: VisitField; label: string }[] = [
  { key: "name", label: "Name" }, { key: "status", label: "Status" }, { key: "manufacturer", label: "Manufacturer" },
  { key: "model", label: "Model" }, { key: "serial", label: "Serial" }, { key: "asset_tag", label: "Asset tag" }, { key: "ip", label: "IP" },
];
export type VisitAction = "ok" | "missing";

const SKIP = new Set(["Blank", "Cable manager"]);

/** Device ids of a rack in walk order: top U first, then side 0,1,2. */
export function visitList(doc: Doc, rackId: number): number[] {
  return doc.devices
    .filter((d) => d.rack === rackId && !SKIP.has(d.type))
    .sort((a, b) => (b.u + b.u_size - 1) - (a.u + a.u_size - 1) || a.side - b.side || a.id - b.id)
    .map((d) => d.id);
}

export function applyStep(
  doc: Doc, devId: number, action: VisitAction, fields: Partial<Record<VisitField, string>>, today: string,
): "confirmed" | "corrected" | "missing" | "gone" {
  const d = doc.devices.find((x) => x.id === devId);
  if (!d) return "gone";
  if (action === "missing") {
    setOffRack(doc, d);
    d.status = "offline";
    return "missing";
  }
  let changed = false;
  for (const f of VISIT_FIELDS) {
    const raw = fields[f.key];
    if (raw === undefined) continue;
    const val = raw.trim();
    if (f.key === "name") {
      if (!val || val === d.name) continue;
      setField(d, "name", val); changed = true;
    } else if (f.key === "status") {
      const next = (val || "active") as Device["status"];
      if (next === statusOf(d)) continue;
      if (next === "active") delete d.status; else d.status = next;
      changed = true;
    } else {
      const cur = ((d as any)[f.key] ?? "") as string;
      if (val === cur) continue;
      setField(d, f.key, val); changed = true;
    }
  }
  d.last_verified = today;
  return changed ? "corrected" : "confirmed";
}

export function finishVisit(
  doc: Doc, rackId: number, counts: { confirmed: number; corrected: number; missing: number }, today: string,
): boolean {
  const r = doc.racks.find((x) => x.id === rackId);
  if (!r || counts.confirmed + counts.corrected + counts.missing <= 0) return false;
  r.last_verified = today;
  return true;
}

export function posLabel(d: Device): string {
  let s = d.u_size > 1 ? `U${d.u}–${d.u + d.u_size - 1}` : `U${d.u}`;
  const cols = d.cols && d.cols > 2 ? 3 : d.half ? 2 : 0;
  if (cols === 2) s += d.side === 0 ? " · left" : " · right";
  else if (cols === 3) s += d.side === 0 ? " · left" : d.side === 1 ? " · middle" : " · right";
  if (d.face === "rear") s += " · rear";
  return s;
}
