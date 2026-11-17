// A list of things that need a look: level dot, client, "Rack › Device", message. Stale-rack info is folded to one line per client.
import { v } from "../theme";
import { groupInfo } from "./model";
import type { TaggedAlert } from "./lists";

const dot = { critical: "danger", warning: "warn", info: "text-muted" } as const;

export default function AttentionList({ alerts, clientName, onOpen, max = 50, loading = false }: {
  alerts: TaggedAlert[]; clientName?: string; loading?: boolean; onOpen: (a: TaggedAlert) => void; max?: number;
}) {
  const { shown: sh, staleRacks } = groupInfo(alerts);
  const shown = sh as TaggedAlert[];
  const stale = new Map<string, { name: string; n: number }>();
  for (const a of alerts) if (a.level === "info" && a.kind === "stale") {
    const k = a.clientKey ?? a.clientName ?? clientName ?? "";
    const e = stale.get(k) ?? { name: a.clientName ?? clientName ?? "", n: 0 };
    e.n++; stale.set(k, e);
  }
  const rows = shown.slice(0, max);
  if (!shown.length && !staleRacks) return loading ? null : <div style={{ fontSize: 13, color: v("text-muted") }}>Nothing needs attention.</div>;
  return (
    <div style={{ fontSize: 13 }}>
      {rows.map((a, i) => {
        const cn = a.clientName ?? clientName;
        const where = [a.rackName, a.devName].filter(Boolean).join(" › ");
        return (
          <div key={i} onClick={() => onOpen(a)} title="Open this rack" style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 4px", cursor: "pointer", borderTop: i ? `1px solid ${v("border-subtle")}` : undefined }}
            onMouseEnter={(e) => (e.currentTarget.style.background = v("row-hover-blue"))} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
            <span aria-label={a.level} style={{ width: 9, height: 9, borderRadius: "50%", background: v(dot[a.level]), flex: "none" }} />
            {cn && <span style={{ fontWeight: 600 }}>{cn}</span>}
            {where && <span style={{ color: v("text-muted") }}>{where}</span>}
            <span>{a.msg}</span>
          </div>
        );
      })}
      {shown.length > max && <div style={{ color: v("text-muted"), padding: "3px 4px" }}>and {shown.length - max} more</div>}
      {[...stale].map(([k, { name: n, n: c }]) => (
        <div key={k} style={{ color: v("text-muted"), fontSize: 12, padding: "3px 4px" }}>{n ? `${n}: ` : ""}{c} rack{c === 1 ? "" : "s"} not checked on site in 90 days</div>
      ))}
    </div>
  );
}
