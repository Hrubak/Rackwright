import type { Device, Doc } from "./types";
import { v } from "./theme";

type R = { l: number; t: number; w: number; h: number };

/** Point where the ray from the centre of `r` towards (px, py) leaves the rectangle. */
export function edgePoint(r: R, px: number, py: number): [number, number] {
  const cx = r.l + r.w / 2, cy = r.t + r.h / 2, dx = px - cx, dy = py - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
  return [cx + dx * s, cy + dy * s];
}

/** Thin dashed line from each "Virtual machines" box to the device that hosts it. Not a cable and never routed. */
export default function VmLinks({ doc, rectOf, visible }: { doc: Doc; rectOf: (d: Device) => R; visible: (d: Device) => boolean }) {
  const byId = new Map(doc.devices.map((d) => [d.id, d]));
  return (
    <g style={{ pointerEvents: "none" }}>
      {doc.devices.filter((d) => d.type === "Virtual machines" && d.vm_host != null && visible(d)).map((d) => {
        const h = byId.get(d.vm_host!);
        if (!h || h.id === d.id || !visible(h)) return null;
        const a = rectOf(d), b = rectOf(h);
        const p = edgePoint(a, b.l + b.w / 2, b.t + b.h / 2), q = edgePoint(b, a.l + a.w / 2, a.t + a.h / 2);
        return <line key={d.id} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={v("vm-link")} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.8} />;
      })}
    </g>
  );
}
