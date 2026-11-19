// The capacity table of the Migration tab: needed, available, used and left for CPU, RAM and disk.
import { v } from "../theme";
import { failoverText, type FitResult, type Level, type ResourceFit } from "./fit";

export const LEVEL_COLOR: Record<Level | "incomplete", string> = { fits: v("ok"), tight: v("warn"), incomplete: v("warn"), over: v("danger") };

const th = { textAlign: "right", fontWeight: 600, padding: "3px 10px", fontSize: 12 } as const;
const td = { textAlign: "right", padding: "3px 10px" } as const;
const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const one = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function CapacityTable({ fit }: { fit: FitResult }) {
  const rows: { label: string; r: ResourceFit; fmt: (n: number) => string; note?: string }[] = [
    { label: "vCPU", r: fit.cpu, fmt: whole },
    { label: "RAM (GB)", r: fit.ram, fmt: whole },
    { label: "Disk (TB)", r: fit.disk, fmt: one, note: `Used today: ${one(fit.usedTb)} TB` },
  ];
  return (
    <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
      <thead>
        <tr><th style={{ ...th, textAlign: "left" }}>Capacity</th><th style={th}>Needed</th><th style={th}>Available ({failoverText(fit)})</th><th style={th}>Used</th><th style={th}>Left</th><th /></tr>
      </thead>
      <tbody>
        {rows.map(({ label, r, fmt, note }) => (
          <tr key={label} style={{ borderTop: `1px solid ${v("border-subtle")}` }}>
            <td style={{ ...td, textAlign: "left" }}>{label}</td>
            <td style={td}>{fmt(r.needed)}</td>
            <td style={td}>{fmt(r.available)}</td>
            <td style={{ ...td, color: LEVEL_COLOR[r.level] }}>{r.available > 0 ? `${Math.round(r.usedPct)}%` : "\u2014"}</td>
            <td style={td}>{fmt(r.left)}</td>
            <td style={{ ...td, textAlign: "left", opacity: 0.75, fontSize: 12 }}>{note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
