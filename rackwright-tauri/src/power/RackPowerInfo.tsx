import { v } from "../theme";
import type { Doc, Rack } from "../types";
import { btu, fmtW, type PowerBudget } from "./model";

/** Power lines for the rack panel: rack total, amps, heat, shared circuit and UPS/PDU load. */
export default function RackPowerInfo({ doc, rack, budget }: { doc: Doc; rack: Rack; budget: PowerBudget }) {
  const rp = budget.racks.find((r) => r.rackId === rack.id);
  if (!rp) return null;
  const circuit = rp.circuit ? budget.circuits.find((c) => c.name === rp.circuit) : undefined;
  const feeds = budget.feeds.filter((f) => doc.devices.find((d) => d.id === f.devId)?.rack === rack.id);
  const n = (x: number) => Math.round(x).toLocaleString("en-US");
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
      <div>Power: {rp.w === 0 && rp.unknown === 0 ? "none" : fmtW(rp.w, rp.unknown)}</div>
      {rp.w > 0 && <>
        <div>{"≈"} {rp.amps.toFixed(1)} A at {rp.volts} V</div>
        <div>{btu(rp.w).toLocaleString("en-US")} BTU/hr</div>
      </>}
      {circuit && circuit.racks.length > 1 && (
        <div>Circuit {circuit.name}: {n(circuit.w)} W, {circuit.amps.toFixed(1)} A ({circuit.racks.length} racks)</div>
      )}
      {feeds.map((f) => {
        const d = doc.devices.find((x) => x.id === f.devId)!;
        const col = f.pct == null ? undefined : f.pct > 100 ? v("danger") : f.pct > 80 ? v("warn") : undefined;
        return <div key={f.devId} style={{ color: col }}>
          {d.name}: {n(f.loadW)} W{f.ratedW ? ` of ${n(f.ratedW)} W${f.pct != null ? ` (${f.pct}%)` : ""}` : ""}
        </div>;
      })}
    </div>
  );
}
