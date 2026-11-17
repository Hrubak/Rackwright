import { RAIL } from "./types";
import { v } from "./theme";

/** Frame artwork drawn inside a rack's outer box (x, y, w, h). Rails, U labels and the device area are drawn by the caller. */
export default function RackFrame({ kind, x, y, w, h }: { kind?: string; x: number; y: number; w: number; h: number }) {
  const post = v("rack-post"), edge = v("rack-edge"), panel = v("rack-panel"), dark = v("rack-dark");
  const r = x + w, b = y + h;
  switch (kind) {
    case "cabinet":
      return (
        <g pointerEvents="none">
          <rect x={x + 2} y={y + 2} width={RAIL - 10} height={h - 4} rx={2} fill={panel} stroke={dark} />
          <rect x={r - RAIL + 8} y={y + 2} width={RAIL - 10} height={h - 4} rx={2} fill={panel} stroke={dark} />
          <rect x={x + 2} y={y + 2} width={w - 4} height={6} rx={2} fill={v("rack-bar")} stroke={dark} />
          <rect x={x + 2} y={b - 6} width={w - 4} height={4} rx={1} fill={v("rack-bar")} />
          <line x1={x + RAIL - 7} y1={y + 12} x2={x + RAIL - 7} y2={b - 8} stroke={edge} strokeWidth={0.6} />
          <line x1={r - RAIL + 7} y1={y + 12} x2={r - RAIL + 7} y2={b - 8} stroke={edge} strokeWidth={0.6} />
        </g>
      );
    case "open4":
      return (
        <g pointerEvents="none">
          <rect x={x + 1} y={y + 8} width={9} height={h - 10} fill={post} stroke={edge} strokeWidth={0.6} />
          <rect x={r - 10} y={y + 8} width={9} height={h - 10} fill={post} stroke={edge} strokeWidth={0.6} />
          <rect x={x + 1} y={y + 6} width={w - 2} height={3} fill={post} />
          <rect x={x + 1} y={b - 5} width={w - 2} height={3} fill={post} />
        </g>
      );
    case "twopost":
      return (
        <g pointerEvents="none">
          <rect x={x + 1} y={y + 8} width={10} height={h - 14} fill={post} stroke={edge} strokeWidth={0.6} />
          <rect x={r - 11} y={y + 8} width={10} height={h - 14} fill={post} stroke={edge} strokeWidth={0.6} />
          <rect x={x + 2} y={b - 6} width={64} height={4} rx={1} fill={v("rack-foot")} />
          <rect x={r - 66} y={b - 6} width={64} height={4} rx={1} fill={v("rack-foot")} />
          <rect x={x + 6} y={b - 3} width={10} height={2} fill={dark} />
          <rect x={r - 16} y={b - 3} width={10} height={2} fill={dark} />
        </g>
      );
    case "wall":
      return (
        <g pointerEvents="none">
          <rect x={x + 2} y={y + 3} width={w - 4} height={6} rx={1} fill={v("rack-cap")} stroke={edge} strokeWidth={0.6} />
          <circle cx={x + 14} cy={y + 6} r={1.6} fill={dark} />
          <circle cx={r - 14} cy={y + 6} r={1.6} fill={dark} />
          {[0.18, 0.5, 0.82].map((f, i) => (
            <rect key={i} x={x + 1} y={y + 10 + (h - 20) * f - 6} width={5} height={12} rx={1.5} fill={v("rack-handle")} stroke={dark} />
          ))}
          <rect x={r - 7} y={y + h / 2 - 8} width={5} height={16} rx={1.5} fill={v("rack-cap")} stroke={edge} strokeWidth={0.6} />
          <rect x={x + 2} y={b - 5} width={w - 4} height={3} fill={v("rack-base")} />
        </g>
      );
    case "desktop":
      return (
        <g pointerEvents="none">
          <rect x={x + 1} y={y + 12} width={5} height={22} rx={2.5} fill="none" stroke={edge} strokeWidth={1.4} />
          <rect x={r - 6} y={y + 12} width={5} height={22} rx={2.5} fill="none" stroke={edge} strokeWidth={1.4} />
          <rect x={x + 1} y={y + 6} width={w - 2} height={3} fill={post} />
          <rect x={x + 1} y={b - 6} width={w - 2} height={3} fill={post} />
          {[x + 10, r - 22].map((fx, i) => <rect key={i} x={fx} y={b - 3} width={12} height={3} rx={1} fill={v("rack-foot")} />)}
        </g>
      );
    default:
      return null;
  }
}
