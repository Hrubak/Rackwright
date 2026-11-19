// The VM list of the Migration tab: include box, sizes to edit, and the problem or reason for each VM.
import { v } from "../theme";
import type { FitResult } from "./fit";
import SizeInput from "./SizeInput";
import type { MigrationPlan, SizeField, VmEntry } from "./types";
import { PLATFORM_LABEL, defaultInclude, isIncluded, type SiteVm } from "./vms";

const th = { textAlign: "left", fontWeight: 600, padding: "3px 8px", fontSize: 12 } as const;
const td = { padding: "3px 8px" } as const;
const FIELDS: [SizeField, string][] = [["vcpu", "vCPU"], ["ramGb", "RAM (GB)"], ["diskGb", "Disk (GB)"], ["usedGb", "Used (GB)"]];

export default function VmTable({ vms, plan, fit, onEntry }: { vms: SiteVm[]; plan: MigrationPlan; fit: FitResult; onEntry: (key: string, e: VmEntry) => void }) {
  return (
    <table style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr><th style={th} /><th style={th}>VM</th><th style={th}>Now on</th><th style={th}>Platform</th>{FIELDS.map(([, l]) => <th key={l} style={th}>{l}</th>)}<th style={th}>Note</th></tr>
      </thead>
      <tbody>
        {vms.map((vm) => {
          const e = plan.vms[vm.key];
          const inc = isIncluded(vm, e);
          const problem = fit.problems.find((p) => p.key === vm.key)?.reason ?? (fit.missing.includes(vm.key) ? "Add the missing sizes" : "");
          const reason = defaultInclude(vm).reason;
          const note = inc ? problem : reason ? `Left out: ${reason}` : "Left out";
          const set = (f: SizeField, n: number | undefined) => {
            const next: VmEntry = { ...(e ?? {}), name: vm.name, source: { ...(e?.source ?? {}), [f]: "manual" } };
            if (n === undefined) { delete next[f]; delete next.source![f]; } else next[f] = n;
            onEntry(vm.key, next);
          };
          return (
            <tr key={vm.key} style={{ borderTop: `1px solid ${v("border-subtle")}`, opacity: inc ? 1 : 0.65 }}>
              <td style={td}><input type="checkbox" aria-label={`Include ${vm.name}`} checked={inc} onChange={(ev) => onEntry(vm.key, { ...(e ?? {}), name: vm.name, include: ev.target.checked })} /></td>
              <td style={td}>{vm.name}</td>
              <td style={td}>{vm.host}</td>
              <td style={td}>{PLATFORM_LABEL[vm.platform]}</td>
              {FIELDS.map(([f, l]) => (
                <td key={f} style={td}>{inc ? <SizeInput value={e?.[f]} whole={f === "vcpu"} label={`${l} of ${vm.name}`} onChange={(n) => set(f, n)} /> : <span style={{ opacity: 0.6 }}>{e?.[f] ?? ""}</span>}</td>
              ))}
              <td style={{ ...td, fontSize: 12, color: problem && inc ? v("warn") : undefined }}>{note}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
