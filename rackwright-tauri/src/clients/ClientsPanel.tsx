// Clients screen: pick a client, see its sites and the racks in each, open a rack.
import { v } from "../theme";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { Doc } from "../types";
import { Stats, addStats, docStats, statText, zero } from "./util";
import Inventory from "./Inventory";
import Links from "./Links";
import { ClientItem, ClientListItem, RackItem, SiteItem, clientStore } from "./store";

const ImportToClient = lazy(() => import("./ImportToClient"));

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 10px", marginRight: 5, cursor: "pointer", fontSize: 12 } as const;
const small = { ...btn, padding: "1px 7px", fontSize: 11 } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px", fontSize: 12 } as const;
const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface CurrentRack {
  /** What the open rack is called, for the "Add the open rack" button. */
  label: string;
  /** Web: the open shared rack's id (null when it is not saved yet). Desktop: its file path (null when not saved). */
  id: number | null;
  path: string | null;
}

export interface ClientsPanelProps {
  current: CurrentRack;
  /** Web: save the open (unsaved) rack as a new shared rack in this site. */
  saveCurrentTo?: (siteId: number) => Promise<boolean>;
  /** Open a rack; with `devId`, select that device. */
  onOpenRack: (r: RackItem, devId?: number) => void;
  onClose: () => void;
  /** Open with the Auvik import dialog already showing. */
  startImport?: boolean;
  /** Select this client when the screen opens. */
  openClient?: string;
  /** Scroll this site's card into view. */
  focusSite?: number;
}

/** Small elevation drawing of every rack in a document. */
export function MiniRack({ doc }: { doc: Doc }) {
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

export default function ClientsPanel({ current, saveCurrentTo, onOpenRack, onClose, startImport, openClient, focusSite }: ClientsPanelProps) {
  const store = clientStore();
  const [list, setList] = useState<ClientListItem[] | null>(null);
  const [q, setQ] = useState("");
  const [key, setKey] = useState<string | null>(() => { if (openClient) return openClient; try { return localStorage.getItem("rw.client") || null; } catch { return null; } });
  const [client, setClient] = useState<ClientItem | null>(null);
  const [docs, setDocs] = useState<Record<string, Doc | string>>({}); // rack key -> doc, or an error text
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteForm, setSiteForm] = useState<{ id: number | null; name: string; address: string; notes: string } | null>(null);
  const [importOpen, setImportOpen] = useState(!!startImport);
  const [picker, setPicker] = useState<{ siteId: number; items: RackItem[] | null } | null>(null);
  const [tab, setTab] = useState<"sites" | "inventory" | "links">(() => { try { const t = localStorage.getItem("rw.clientTab"); return t === "inventory" || t === "links" ? t : "sites"; } catch { return "sites"; } });
  useEffect(() => { try { localStorage.setItem("rw.clientTab", tab); } catch { /* ignore */ } }, [tab]);

  const reloadList = useCallback(async () => { try { setList(await store.list()); } catch (e) { setErr(errOf(e)); setList([]); } }, [store]);
  const reloadClient = useCallback(async (k: string | null) => {
    if (!k) { setClient(null); return; }
    try { setClient(await store.get(k)); setErr(""); } catch (e) { setClient(null); setErr(errOf(e)); }
  }, [store]);
  useEffect(() => { reloadList(); }, [reloadList]);
  useEffect(() => { reloadClient(key); try { if (key) localStorage.setItem("rw.client", key); } catch { /* ignore */ } }, [key, reloadClient]);

  useEffect(() => {
    if (focusSite == null || !client) return;
    document.querySelector(`[data-site="${focusSite}"]`)?.scrollIntoView({ block: "center" });
  }, [focusSite, client]);

  // Load each rack's document once, for the thumbnails and the counts.
  useEffect(() => {
    if (!client) return;
    let stop = false;
    for (const s of client.sites) for (const r of s.racks) {
      if (docs[r.key] !== undefined) continue;
      store.loadDoc(r).then((d) => { if (!stop) setDocs((m) => ({ ...m, [r.key]: d })); }, (e) => { if (!stop) setDocs((m) => ({ ...m, [r.key]: errOf(e) })); });
    }
    return () => { stop = true; };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, after?: () => Promise<unknown> | void) => {
    setBusy(true); setErr("");
    try { await fn(); await after?.(); } catch (e) { setErr(errOf(e)); }
    setBusy(false);
  };
  const refresh = async () => { await reloadClient(key); await reloadList(); };

  const newClient = () => {
    const name = prompt("Name of the new client:")?.trim();
    if (!name) return;
    run(async () => { const k = await store.create(name); if (k) { await reloadList(); setKey(k); } });
  };
  const openFile = () => run(async () => { const k = await store.open?.(); if (k) { await reloadList(); setKey(k); } });
  const removeClient = () => {
    if (!client) return;
    const msg = store.web ? `Delete the client "${client.name}"? It must have no sites left.` : `Remove "${client.name}" from this list? The client file is not deleted.`;
    if (!confirm(msg)) return;
    run(() => store.remove(client.key), async () => { setKey(null); await reloadList(); });
  };
  const saveSite = () => {
    if (!client || !siteForm) return;
    const f = siteForm;
    if (!f.name.trim()) { setErr("Give the site a name."); return; }
    const p = { name: f.name.trim(), address: f.address.trim(), notes: f.notes };
    run(() => (f.id == null ? store.addSite(client.key, p) : store.updateSite(client.key, f.id, p)), async () => { setSiteForm(null); await refresh(); });
  };
  const removeSite = (s: SiteItem) => {
    if (!client || !confirm(`Delete the site "${s.name}"? Its racks are kept${store.web ? " and move to Unassigned" : " (the files stay)"}.`)) return;
    run(() => store.removeSite(client.key, s.id), refresh);
  };
  const addRacks = async (s: SiteItem) => {
    if (!client) return;
    if (store.web) { setPicker({ siteId: s.id, items: null }); try { const items = await store.unassigned!(); setPicker({ siteId: s.id, items }); } catch (e) { setErr(errOf(e)); setPicker(null); } return; }
    run(() => store.addRacks(client.key, s.id), refresh);
  };
  const addCurrent = (s: SiteItem) => {
    if (!client) return;
    if (store.web) {
      if (current.id != null) run(() => store.addRacks(client.key, s.id, [{ key: `r${current.id}`, id: current.id!, name: current.label }]), refresh);
      else if (saveCurrentTo) run(async () => { await saveCurrentTo(s.id); }, refresh);
    } else if (current.path) run(() => store.addRacks(client.key, s.id, [], [current.path!]), refresh);
  };
  const canAddCurrent = store.web ? current.id != null || !!saveCurrentTo : !!current.path;

  const shown = useMemo(() => (list ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())), [list, q]);
  const siteStats = (s: SiteItem) => s.racks.reduce((a, r) => { const d = docs[r.key]; return typeof d === "object" ? addStats(a, docStats(d)) : a; }, zero);
  const total = client ? client.sites.reduce((a, s) => addStats(a, siteStats(s)), zero) : zero;

  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay-strong"), zIndex: 90, display: "flex", alignItems: "stretch", justifyContent: "center", padding: 20 }}>
      <div style={{ background: v("panel"), border: `1px solid ${v("border")}`, borderRadius: 6, color: v("text"), fontSize: 13, display: "flex", flexDirection: "column", width: "100%", maxWidth: 1400 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${v("border-subtle")}` }}>
          <b style={{ fontSize: 15, flex: 1 }}>Clients and sites</b>
          {busy && <span style={{ opacity: 0.7, marginRight: 10 }}>Working...</span>}
          <button style={{ ...btn, marginRight: 0 }} onClick={onClose}>Close</button>
        </div>
        {err && <div style={{ background: v("error-bg"), color: v("error-text"), padding: "6px 14px" }}>{err}</div>}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ width: 260, borderRight: `1px solid ${v("border-subtle")}`, display: "flex", flexDirection: "column", padding: 10 }}>
            <input style={{ ...inp, marginBottom: 8 }} placeholder="Find a client" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ marginBottom: 8 }}>
              <button style={btn} onClick={newClient}>New client</button>
              {!store.web && <button style={btn} onClick={openFile}>Open client file</button>}
            </div>
            <div style={{ overflow: "auto", flex: 1 }}>
              {list === null && <div style={{ opacity: 0.7 }}>Loading...</div>}
              {list && !list.length && <div style={{ opacity: 0.7, fontSize: 12 }}>No clients yet. Click New client{store.web ? "" : " or Open client file"}.</div>}
              {shown.map((c) => (
                <div key={c.key} onClick={() => setKey(c.key)} style={{ padding: "6px 8px", borderRadius: 4, cursor: "pointer", background: c.key === key ? v("accent-soft") : undefined, marginBottom: 2 }}>
                  <div>{c.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.65 }}>{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
            {!client && <div style={{ opacity: 0.7 }}>Pick a client on the left, or add a new one.</div>}
            {client && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <input key={`n${client.key}${client.name}`} style={{ ...inp, fontSize: 17, fontWeight: 600, flex: 1, maxWidth: 480 }} defaultValue={client.name}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== client.name) run(() => store.update(client.key, { name: v }), refresh); }} />
                  <button style={{ ...btn, color: v("danger") }} onClick={removeClient}>{store.web ? "Delete client" : "Remove from list"}</button>
                </div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>{client.sites.length} site{client.sites.length === 1 ? "" : "s"}, {statText(total)}{!store.web && <> · <span title={client.key}>{client.key}</span></>}</div>
                <textarea key={`t${client.key}`} style={{ ...inp, width: "100%", maxWidth: 800, minHeight: 44, boxSizing: "border-box", marginBottom: 10 }} placeholder="Notes about this client (contacts, contract, escalation...)"
                  defaultValue={client.notes} onBlur={(e) => { if (e.target.value !== client.notes) run(() => store.update(client.key, { notes: e.target.value }), refresh); }} />
                <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${v("border-subtle")}`, marginBottom: 12 }}>
                  {([["sites", "Sites"], ["inventory", "Inventory and search"], ["links", "Links"]] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setTab(id)} style={{ background: "none", color: tab === id ? v("text") : v("text-muted-alt"), border: "none", cursor: "pointer", fontSize: 13,
                      padding: "6px 12px", borderBottom: tab === id ? `2px solid ${v("accent-border")}` : "2px solid transparent", marginBottom: -1 }}>{label}</button>
                  ))}
                  <span style={{ flex: 1 }} />
                  {tab === "sites" && <button style={{ ...btn, marginBottom: 4 }} onClick={() => setImportOpen(true)}>Import Auvik</button>}
                  {tab === "sites" && <button style={{ ...btn, marginBottom: 4 }} onClick={() => setSiteForm({ id: null, name: "", address: "", notes: "" })}>Add site</button>}
                </div>
                {tab === "inventory" && <Inventory client={client} docs={docs} onOpen={onOpenRack} />}
                {tab === "links" && <Links client={client} docs={docs} store={store} onChanged={refresh} />}
                {tab === "sites" && <>
                {siteForm && (
                  <div style={{ border: `1px solid ${v("border")}`, borderRadius: 6, padding: 10, marginBottom: 12, maxWidth: 520, background: v("card") }}>
                    <b>{siteForm.id == null ? "New site" : "Edit site"}</b>
                    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 6, marginTop: 8, alignItems: "center" }}>
                      <span>Name</span><input autoFocus style={inp} value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} />
                      <span>Address</span><input style={inp} value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} />
                      <span>Notes</span><textarea style={{ ...inp, minHeight: 40 }} value={siteForm.notes} onChange={(e) => setSiteForm({ ...siteForm, notes: e.target.value })} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button style={btn} onClick={saveSite}>Save site</button>
                      <button style={btn} onClick={() => setSiteForm(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                {!client.sites.length && !siteForm && <div style={{ opacity: 0.7 }}>No sites yet. Add the client's offices, data centers or closets as sites, then put racks in them.</div>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
                  {client.sites.map((s) => {
                    const st = siteStats(s);
                    return (
                      <div key={s.id} data-site={s.id} style={{ border: `1px solid ${v("scrollbar")}`, borderRadius: 6, padding: 10, background: v("card") }}>
                        <div style={{ display: "flex", alignItems: "flex-start" }}>
                          <div style={{ flex: 1 }}>
                            <b style={{ fontSize: 14 }}>{s.name}</b>
                            {s.address && <div style={{ fontSize: 12, opacity: 0.75 }}>{s.address}</div>}
                          </div>
                          <button style={small} onClick={() => setSiteForm({ id: s.id, name: s.name, address: s.address, notes: s.notes })}>Edit</button>
                          <button style={{ ...small, marginRight: 0, color: v("danger") }} onClick={() => removeSite(s)}>Delete</button>
                        </div>
                        {s.notes && <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "pre-wrap", marginTop: 4 }}>{s.notes}</div>}
                        <div style={{ fontSize: 11, opacity: 0.65, margin: "6px 0" }}>{statText(st)}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {s.racks.map((r) => {
                            const d = docs[r.key];
                            return (
                              <div key={r.key} style={{ border: `1px solid ${v("border-subtle")}`, borderRadius: 4, padding: 6, background: v("inset"), minWidth: 120 }}>
                                <div style={{ cursor: "pointer" }} title="Open this rack" onClick={() => onOpenRack(r)}>
                                  {d === undefined ? <div style={{ fontSize: 11, opacity: 0.6 }}>Loading...</div> : typeof d === "string" ? <div style={{ fontSize: 11, color: v("error-text"), maxWidth: 160 }}>{d}</div> : <MiniRack doc={d} />}
                                  <div style={{ fontSize: 12, marginTop: 4, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                                  {typeof d === "object" && <div style={{ fontSize: 10, opacity: 0.6 }}>{d.devices.length} devices</div>}
                                </div>
                                <button style={{ ...small, marginTop: 4 }} onClick={() => onOpenRack(r)}>Open</button>
                                <button style={{ ...small, marginTop: 4, marginRight: 0 }} title="Take it out of this site (the rack is kept)"
                                  onClick={() => { if (confirm(`Take "${r.name}" out of ${s.name}? The rack is kept.`)) run(() => store.removeRack(client.key, s.id, r), refresh); }}>Remove</button>
                              </div>
                            );
                          })}
                          {!s.racks.length && <div style={{ fontSize: 12, opacity: 0.6 }}>No racks in this site yet.</div>}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <button style={small} onClick={() => addRacks(s)}>{store.web ? "Add saved racks" : "Add rack files"}</button>
                          {canAddCurrent && <button style={small} onClick={() => addCurrent(s)} title={current.label}>{store.web && current.id == null ? "Save the open rack here" : "Add the open rack"}</button>}
                        </div>
                        {picker && picker.siteId === s.id && (
                          <div style={{ marginTop: 8, borderTop: `1px solid ${v("border-subtle")}`, paddingTop: 6 }}>
                            <div style={{ fontSize: 12, marginBottom: 4 }}>Racks that are in no site yet:</div>
                            {picker.items === null && <div style={{ fontSize: 12, opacity: 0.7 }}>Loading...</div>}
                            {picker.items && !picker.items.length && <div style={{ fontSize: 12, opacity: 0.7 }}>None. Every saved rack is already in a site.</div>}
                            {picker.items?.map((r) => (
                              <div key={r.key} style={{ display: "flex", alignItems: "center", fontSize: 12, padding: "2px 0" }}>
                                <span style={{ flex: 1 }}>{r.name}</span>
                                <button style={small} onClick={() => run(() => store.addRacks(client.key, s.id, [r]), async () => { setPicker((p) => p && { ...p, items: p.items?.filter((x) => x.key !== r.key) ?? null }); await refresh(); })}>Add</button>
                              </div>
                            ))}
                            <button style={{ ...small, marginTop: 4 }} onClick={() => setPicker(null)}>Done</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </>}
              </>
            )}
          </div>
        </div>
      </div>
      {importOpen && client && <Suspense fallback={null}><ImportToClient client={client} onDone={refresh} onClose={() => setImportOpen(false)} /></Suspense>}
    </div>
  );
}
