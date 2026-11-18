// Where each device field came from. Pure; must not import backend.ts.
import type { Device } from "./types";

export type FieldSource = "auvik" | "asio" | "csv" | "manual";

export function setSource(d: { source?: Record<string, FieldSource> }, field: string, src: FieldSource): void {
  d.source = { ...(d.source ?? {}), [field]: src };
}

export const isManual = (d: Device, field: string) => !!(d.locked?.includes(field) || d.source?.[field] === "manual");

// A hand edit: remember the source, and lock the field when the device is tied to Auvik.
export function markManual(x: Device, k: string): void {
  setSource(x, k, "manual");
  if (x.auvik_id && !(x.locked ?? []).includes(k)) x.locked = [...(x.locked ?? []), k];
}
