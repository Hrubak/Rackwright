import type { Units } from "./settings/types";

export function fmtLen(mm: number, u: Units): string {
  return u === "in" ? `${(mm / 25.4).toFixed(1)} in` : `${mm} mm`;
}

export function fmtDims(w: number | undefined, d: number | undefined, u: Units): string {
  const n = (x: number) => (u === "in" ? (x / 25.4).toFixed(1) : String(x));
  const unit = u === "in" ? "in" : "mm";
  if (w && d) return `${n(w)} x ${n(d)} ${unit}`;
  if (w) return `${n(w)} ${unit} wide`;
  return "size varies";
}
