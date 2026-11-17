import { v } from "../theme";
import type { Doc } from "../types";

/** Small elevation drawing of every rack in a document. */
export default function MiniRack({ doc }: { doc: Doc }) {
  const racks = doc.racks.slice(0, 4);
  if (!racks.length) return <div style={{ fontSize: 11, opacity: 0.6 }}>No racks</div>;
  const PX = 3, W = 30;
  const maxU = Math.max(...racks.map((r) => r.u));
  return (
    <svg width={racks.length * (W + 6)} height={maxU * PX + 6} style={{ display: "block" }}>
      {racks.map((r, i) => {
        const x = i * (W + 6), top = (maxU - r.u) * PX;
        return (
          <g key={r.id}>
            <rect x={x} y={top} width={W} height={r.u * PX + 4} fill={v("mini-rack-bg")} stroke={v("mini-rack-border")} rx={2} />
            {doc.devices.filter((d) => d.rack === r.id).map((d) => {
              const cols = d.half ? Math.max(2, d.cols || 2) : 1;
              const w = (W - 4) / cols;
              return <rect key={d.id} x={x + 2 + (d.half ? (d.side || 0) * w : 0)} y={top + 2 + (r.u - (d.u + d.u_size - 1)) * PX} width={w - 0.5} height={d.u_size * PX - 0.5} fill={d.color || v("mini-device")} />;
            })}
          </g>
        );
      })}
    </svg>
  );
}
