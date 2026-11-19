// The Migration tab: plan a site's VM move onto a HyperCore cluster and show whether it fits. Saves after a short pause.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v } from "../theme";
import type { Doc } from "../types";
import { ClientItem, clientStore } from "../clients/store";
import { useLeaveGuard } from "../unsaved";
import CapacityTable, { LEVEL_COLOR } from "./CapacityTable";
import SizeInput, { inp } from "./SizeInput";
import { LEVEL_TEXT, fitPlan, resultText } from "./fit";
import { NODE_PRESETS } from "./presets";
import { SIZE_SOURCES, applyFill } from "./sources";
import { newPlan, readPlan, type ClusterSpec, type FitRules, type MigrationPlan, type VmEntry } from "./types";
import VmTable from "./VmTable";
import { orphanKeys, siteVms } from "./vms";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 } as const;
const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const row = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 8 } as const;
const lab = { display: "inline-flex", gap: 5, alignItems: "center" } as const;

export interface MigrationTabProps {
  client: ClientItem;
  siteId?: number;
  docs: Record<string, Doc | string>;
  /** Called after a save; the page reloads the client (web shows what was stored). */
  onSaved: () => Promise<unknown> | void;
}

export default function MigrationTab({ client, siteId, docs, onSaved }: MigrationTabProps) {
  const store = clientStore();
  const site = client.sites.find((s) => s.id === siteId) ?? client.sites[0];
  const [plan, setPlan] = useState<MigrationPlan | undefined>(undefined);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<{ key: string; id: number; plan: MigrationPlan | null } | null>(null);
  useLeaveGuard(pending);

  const ready = !!site && site.racks.every((r) => docs[r.key] !== undefined);
  const vms = useMemo(() => (site && ready ? siteVms(site.racks, docs) : []), [site, ready, docs]);

  useEffect(() => {
    if (!site || dirty.current) return;
    setPlan(readPlan(site.migration));
  }, [site]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const q = queued.current; if (!q) return;
    queued.current = null;
    try {
      await store.setMigration(q.key, q.id, q.plan);
      if (!queued.current) { dirty.current = false; setPending(false); }
      setSaved(true); setMsg("");
      if (store.web) await onSaved(); // web: reload so the tab shows what was stored
    } catch (e) { setMsg(errOf(e)); }
  }, [store, onSaved]);
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => () => { if (queued.current) void flushRef.current(); }, []);

  const edit = (next: MigrationPlan | null) => {
    if (!site) return;
    dirty.current = true; setPending(true); setPlan(next ?? undefined); setSaved(false);
    queued.current = { key: client.key, id: site.id, plan: next };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  };

  const fit = useMemo(() => (plan ? fitPlan(plan, vms) : undefined), [plan, vms]);

  if (!client.sites.length) return <div style={{ opacity: 0.8 }}>Add a site on the Sites tab to start a migration plan.</div>;
  if (!site) return null;
  if (!ready) return <div style={{ opacity: 0.7 }}>Loading...</div>;

  const header = (
    <>
      {!siteId && client.sites.length > 1 && <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Showing {site.name}. Pick a site in the bar above to see another.</div>}
      {msg && <div style={{ fontSize: 12, color: v("error-text"), marginBottom: 6 }}>{msg}</div>}
    </>
  );

  if (!plan || !fit) {
    return (
      <div>
        {header}
        <div style={{ marginBottom: 8 }}>No migration plan for this site yet.</div>
        <button style={btn} onClick={() => edit(newPlan(site.name))}>Start a plan</button>
      </div>
    );
  }

  const setCluster = (c: Partial<ClusterSpec>) => edit({ ...plan, cluster: { ...plan.cluster, ...c } });
  const setRules = (r: Partial<FitRules>) => edit({ ...plan, rules: { ...plan.rules, ...r } });
  const setEntry = (key: string, e: VmEntry) => edit({ ...plan, vms: { ...plan.vms, [key]: e } });
  const num = (label: string, value: number, whole: boolean, set: (n: number) => void, w = 56) => (
    <label style={lab}>{label}<SizeInput value={value} whole={whole} width={w} label={label} blankKeeps onChange={(n) => { if (n !== undefined) set(n); }} /></label>
  );
  const pickPreset = (id: string) => {
    const p = NODE_PRESETS.find((x) => x.id === id);
    if (p) setCluster({ cores: p.cores, ramGb: p.ramGb, rawTb: p.rawTb, preset: p.id });
    else setCluster({ preset: undefined });
  };
  const canFill = SIZE_SOURCES.filter((s) => s.id !== "manual" && s.available());
  const fill = async (i: number) => {
    try { edit(applyFill(plan, await canFill[i].fill(site.id, vms), canFill[i].id, false)); } catch (e) { setMsg(errOf(e)); }
  };
  const del = () => { if (confirm("Delete the migration plan for this site?")) edit(null); };

  const q = filter.trim().toLowerCase();
  const shown = q ? vms.filter((x) => x.name.toLowerCase().includes(q) || x.host.toLowerCase().includes(q)) : vms;
  const orphans = orphanKeys(plan, vms);
  const noSize = fit.missing.length;

  return (
    <div>
      {header}
      <div style={{ ...row, justifyContent: "space-between" }}>
        <b style={{ fontSize: 14 }}>{site.name}</b>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          {saved && !pending && <span style={{ opacity: 0.7, fontSize: 12 }}>Saved</span>}
          <span style={{ fontSize: 12, opacity: 0.8 }}>Result:</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: LEVEL_COLOR[fit.overall] }} role="status" aria-label={`Result: ${LEVEL_TEXT[fit.overall]}`}>{resultText(fit)}</span>
        </span>
      </div>

      <div style={row}>
        <b>Target cluster</b>
        <label style={lab}>Name<input style={{ ...inp, width: 120 }} value={plan.cluster.name} onChange={(e) => setCluster({ name: e.target.value })} /></label>
        {num("Nodes", plan.cluster.nodes, true, (n) => setCluster({ nodes: n }), 44)}
        {NODE_PRESETS.length > 0 && (
          <label style={lab}>Start from
            <select style={inp} value={plan.cluster.preset ?? ""} onChange={(e) => pickPreset(e.target.value)}>
              <option value="">Custom</option>
              {NODE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <div style={row}>
        <span style={{ opacity: 0.8 }}>Per node:</span>
        {num("Cores", plan.cluster.cores, true, (n) => setCluster({ cores: n }))}
        {num("RAM (GB)", plan.cluster.ramGb, true, (n) => setCluster({ ramGb: n }))}
        {num("Raw storage (TB)", plan.cluster.rawTb, false, (n) => setCluster({ rawTb: n }))}
      </div>
      <div style={row}>
        <span style={{ opacity: 0.8 }}>Rules:</span>
        {num("vCPU per core", plan.rules.cpuRatio, false, (n) => setRules({ cpuRatio: n }), 48)}
        {num("RAM reserve (GB)", plan.rules.ramReserveGb, false, (n) => setRules({ ramReserveGb: n }), 48)}
        {num("Keep free (%)", plan.rules.keepFreePct, false, (n) => setRules({ keepFreePct: n }), 48)}
        <label style={lab}><input type="checkbox" checked={plan.rules.nPlus1} onChange={(e) => setRules({ nPlus1: e.target.checked })} />One node can fail (N+1)</label>
        <span style={{ fontSize: 11, opacity: 0.7 }}>Defaults to be checked against Scale's guidance.</span>
      </div>

      <CapacityTable fit={fit} />

      <div style={{ ...row, marginTop: 4 }}>
        <b>VMs</b>
        <span style={{ fontSize: 12, opacity: 0.8 }}>{fit.included} included, {fit.excluded} excluded{noSize > 0 ? `, ${noSize} with no size` : ""}</span>
        <input style={{ ...inp, width: 160 }} placeholder="Filter by name or host" aria-label="Filter VMs" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canFill.map((s, i) => <button key={s.id} style={btn} onClick={() => void fill(i)}>Fill sizes from {s.label}</button>)}
      </div>
      {vms.length === 0
        ? <div style={{ opacity: 0.8 }}>No VMs found in this site's racks.</div>
        : <VmTable vms={shown} plan={plan} fit={fit} onEntry={setEntry} />}

      {orphans.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <b>No longer in the racks</b>
          <div style={{ fontSize: 12, opacity: 0.8, margin: "2px 0 6px" }}>These sizes are kept until you remove them.</div>
          {orphans.map((k) => (
            <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
              <span style={{ fontSize: 12 }}>{k}</span>
              <button style={btn} onClick={() => { const rest = { ...plan.vms }; delete rest[k]; edit({ ...plan, vms: rest }); }}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}><button style={btn} onClick={del}>Delete plan</button></div>
    </div>
  );
}
