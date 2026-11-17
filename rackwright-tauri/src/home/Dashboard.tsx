// Home screen: one card per client with the numbers that matter, and a way into each client.
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { v } from "../theme";
import type { Doc } from "../types";
import { ClientItem, clientStore } from "../clients/store";
import MiniRack from "../clients/MiniRack";
import { cardStats, clientToken, initials } from "./cards";
import { addStats, zero } from "../clients/util";
import type { RackItem } from "../clients/store";
import { todayIso } from "../attention/model";
import AttentionList from "../attention/AttentionList";
import { alertsByClient, mergeClientAlerts, stillLoading } from "../attention/lists";

const ImportToClient = lazy(() => import("../clients/ImportToClient"));

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 6, cursor: "pointer", fontSize: 12 } as const;
const small = { ...btn, padding: "1px 8px", fontSize: 11, marginRight: 0 } as const;
const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type ClientTab = "floor" | "sites" | "racks" | "inventory" | "cabling" | "links";
export interface OpenOpts { tab?: ClientTab; site?: number }

export default function Dashboard({ onOpen, onOpenRack, importTick }: { onOpen: (key: string, o?: OpenOpts) => void; onOpenRack?: (clientKey: string, r: RackItem, devId?: number) => void; importTick?: number }) {
  const store = clientStore();
  const [clients, setClients] = useState<ClientItem[] | null>(null);
  const [docs, setDocs] = useState<Record<string, Doc | string>>({});
  const [err, setErr] = useState("");
  const [importFor, setImportFor] = useState<ClientItem | null>(null);
  const [pickImport, setPickImport] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await store.list();
      const all: ClientItem[] = [];
      for (const c of list) { try { all.push(await store.get(c.key)); } catch { /* unreadable client file: skipped */ } }
      setClients(all); setErr("");
    } catch (e) { setErr(errOf(e)); setClients([]); }
  }, [store]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (importTick) setPickImport(true); }, [importTick]);

  useEffect(() => {
    if (!clients) return;
    let stop = false;
    for (const c of clients) for (const s of c.sites) for (const r of s.racks) {
      if (docs[r.key] !== undefined) continue;
      store.loadDoc(r).then((d) => { if (!stop) setDocs((m) => ({ ...m, [r.key]: d })); }, (e) => { if (!stop) setDocs((m) => ({ ...m, [r.key]: errOf(e) })); });
    }
    return () => { stop = true; };
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const newClient = async () => {
    const name = prompt("Name of the new client:")?.trim();
    if (!name) return;
    try { const k = await store.create(name); if (k) { await load(); onOpen(k, { tab: "sites" }); } } catch (e) { setErr(errOf(e)); }
  };
  const openFile = async () => { try { const k = await store.open?.(); if (k) { await load(); onOpen(k); } } catch (e) { setErr(errOf(e)); } };

  const totals = useMemo(() => {
    const list = clients ?? [];
    let st = zero;
    for (const c of list) st = addStats(st, cardStats(c, docs, []).stats);
    return { clients: list.length, sites: list.reduce((n, c) => n + c.sites.length, 0), racks: list.reduce((n, c) => n + c.sites.reduce((m, s) => m + s.racks.length, 0), 0), devices: st.devices };
  }, [clients, docs]);
  const byClient = useMemo(() => alertsByClient(clients ?? [], docs, todayIso()), [clients, docs]);
  const attention = useMemo(() => mergeClientAlerts(clients ?? [], byClient), [clients, byClient]);
  const checking = !!clients && stillLoading(clients, docs);
  const openAlert = (a: { clientKey?: string; rackKey?: string; devId?: number; kind: string }) => {
    const c = clients?.find((x) => x.key === a.clientKey);
    const r = c?.sites.flatMap((s) => s.racks).find((x) => x.key === a.rackKey);
    if (c && r) onOpenRack?.(c.key, r, a.kind === "stale" ? undefined : a.devId);
  };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 24px", color: v("text"), background: v("bg") }}>
      <div style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Clients</h1>
          <div style={{ fontSize: 13, color: v("text-muted"), marginTop: 2 }}>
            {plural(totals.clients, "client")} · {plural(totals.sites, "site")} · {plural(totals.racks, "rack")} · {plural(totals.devices, "device")}
          </div>
        </div>
        <button style={btn} onClick={() => (clients && clients.length === 1 ? setImportFor(clients[0]) : setPickImport(true))} disabled={!clients?.length}>Import Auvik…</button>
        {!store.web && <button style={btn} onClick={openFile}>Open client file…</button>}
        <button style={{ ...btn, marginRight: 0, background: v("accent"), color: v("on-accent"), borderColor: v("accent") }} onClick={newClient}>+ New client</button>
      </div>
      {err && <div style={{ background: v("error-bg"), color: v("error-text"), padding: "6px 12px", borderRadius: 4, marginBottom: 12 }}>{err}</div>}
      {pickImport && clients && (
        <div style={{ border: `1px solid ${v("border")}`, borderRadius: 6, background: v("card"), padding: 10, marginBottom: 14, maxWidth: 420 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Which client should get the Auvik import?</div>
          {clients.map((c) => <div key={c.key}><button style={{ ...btn, marginBottom: 4 }} onClick={() => { setPickImport(false); setImportFor(c); }}>{c.name}</button></div>)}
          {!clients.length && <div style={{ fontSize: 12, opacity: 0.7 }}>Add a client first.</div>}
          <button style={small} onClick={() => setPickImport(false)}>Cancel</button>
        </div>
      )}
      {clients === null && <div style={{ opacity: 0.7 }}>Loading...</div>}
      {clients && !clients.length && <div style={{ opacity: 0.8, marginBottom: 14, fontSize: 13 }}>No clients yet. Click + New client{store.web ? "" : " or Open client file"} to start.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {(clients ?? []).map((c) => {
          const cs = cardStats(c, docs, byClient.get(c.key) ?? []);
          const first = c.notes.split(/\r?\n/).find((l) => l.trim()) ?? "";
          const minis = c.sites.flatMap((s) => s.racks).slice(0, 4);
          const big = (n: string | number, l: string) => <div style={{ textAlign: "center", flex: 1 }}><div style={{ fontSize: 20, fontWeight: 600 }}>{n}</div><div style={{ fontSize: 11, color: v("text-muted") }}>{l}</div></div>;
          return (
            <div key={c.key} style={{ border: `1px solid ${v("border")}`, borderRadius: 8, background: v("card"), padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 8, background: v(clientToken(c.key)), color: v("on-accent"), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flex: "none" }}>{initials(c.name)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</div>
                  <div style={{ fontSize: 12, color: v("text-muted"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{first || "No notes"}</div>
                </div>
                <button style={small} onClick={() => onOpen(c.key, { tab: "sites" })}>Edit</button>
              </div>
              <div style={{ display: "flex", gap: 8, minHeight: 20, alignItems: "flex-end" }}>
                {minis.map((r) => { const d = docs[r.key]; return typeof d === "object" ? <MiniRack key={r.key} doc={d} /> : <span key={r.key} style={{ fontSize: 11, opacity: 0.6 }}>{d === undefined ? "Loading..." : "Could not read"}</span>; })}
                {!minis.length && <span style={{ fontSize: 12, color: v("text-muted") }}>{c.sites.length ? "No racks in these sites yet." : "Add a site to start."}</span>}
              </div>
              <div style={{ display: "flex" }}>{big(cs.stats.racks, "racks")}{big(cs.stats.devices, "devices")}{big(cs.stats.cables, "cables")}{big(`${cs.usedPct}%`, "rack space")}</div>
              {cs.checking
                ? <div style={{ fontSize: 12, textAlign: "center", color: v("text-muted") }}>Checking racks…</div>
                : cs.alerts.critical + cs.alerts.warning > 0
                ? <div style={{ fontSize: 12, textAlign: "center" }}>
                    {cs.alerts.critical > 0 && <span style={{ color: v("danger") }}>{cs.alerts.critical} critical</span>}
                    {cs.alerts.critical > 0 && cs.alerts.warning > 0 && " · "}
                    {cs.alerts.warning > 0 && <span style={{ color: v("warn") }}>{cs.alerts.warning} warning{cs.alerts.warning === 1 ? "" : "s"}</span>}
                  </div>
                : <div style={{ fontSize: 12, textAlign: "center", color: v("text-muted") }}>Nothing needs attention</div>}
              {cs.failed.length > 0 && <div style={{ fontSize: 11, color: v("error-text") }}>Could not read: {cs.failed.join(", ")}</div>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {cs.sites.map((s) => <button key={s.id} style={{ ...small, borderRadius: 10 }} onClick={() => onOpen(c.key, { tab: "racks", site: s.id })} title={`Open ${s.name}`}>{s.name} · {s.racks}</button>)}
                <button style={{ ...small, borderStyle: "dashed" }} onClick={() => onOpen(c.key, { tab: "sites" })}>+ Site</button>
                <span style={{ flex: 1 }} />
                <button style={{ ...small, color: v("link") }} onClick={() => onOpen(c.key)}>Open →</button>
              </div>
            </div>
          );
        })}
        <button onClick={newClient} style={{ border: `2px dashed ${v("border")}`, borderRadius: 8, background: "none", color: v("text-muted"), minHeight: 120, cursor: "pointer", fontSize: 14 }}>+ New client</button>
      </div>
      <h2 style={{ fontSize: 15, margin: "26px 0 6px" }}>Needs attention across clients</h2>
      {checking && <div style={{ fontSize: 13, color: v("text-muted") }}>Checking racks…</div>}
      <AttentionList alerts={attention} onOpen={openAlert} loading={checking} />
      {importFor && <Suspense fallback={null}><ImportToClient client={importFor} onDone={load} onClose={() => setImportFor(null)} /></Suspense>}
    </div>
  );
}
