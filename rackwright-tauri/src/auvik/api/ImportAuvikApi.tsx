// Import from Auvik (web only): choose the Auvik client, read its sites one at a time, review each site, import.
import { useEffect, useMemo, useRef, useState } from "react";
import { v } from "../../theme";
import * as A from "../../api";
import type { AuvikInventory, AuvikLinks, AuvikTenant } from "../../api";
import { ClientItem, clientStore } from "../../clients/store";
import { RACK_MODELS, modelById } from "../../racks";
import { useSettings } from "../../settings/context";
import type { Doc } from "../../types";
import SitePreview, { SiteState, ticksOf, newSiteState } from "./SitePreview";
import { Defaults, SiteDocs, SitePlan, mapTenantToSite, planSite, saveSite, skipLine } from "./sync";
import { Busy, BusyStyle, btn, inp } from "./ui";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cablesFailed = (site: string) => `Cables could not be read for ${site}; devices are imported without them.`;
type Stage = "pick" | "reading" | "preview" | "saving" | "done";
interface SitePick { on: boolean; siteId: number | null }   // siteId null = (new site)
interface Read { tenant: AuvikTenant; inv: AuvikInventory | null; note: string; links: AuvikLinks | null; linkNote: string }   // inv null = skipped; links null = no cables (linkNote says why)

export default function ImportAuvikApi({ client, onDone, onClose }: { client: ClientItem; onDone: () => Promise<unknown> | void; onClose: () => void }) {
  const system = useSettings().system;
  const [cl, setCl] = useState<ClientItem>(client);
  const [stage, setStage] = useState<Stage>("pick");
  const [status, setStatus] = useState<{ configured: boolean; region: string; username: string } | null>(null);
  const [test, setTest] = useState("");
  const [tenants, setTenants] = useState<AuvikTenant[] | null>(null);
  const [err, setErr] = useState("");
  const [parent, setParent] = useState("");
  const [docs, setDocs] = useState<Map<number, SiteDocs> | null>(null);
  const [picks, setPicks] = useState<Record<string, SitePick>>({});
  const [reads, setReads] = useState<Read[]>([]);
  const [progress, setProgress] = useState({ n: 0, of: 0, name: "", cables: false });
  const [sites, setSites] = useState<Record<string, SiteState>>({});
  const [tab, setTab] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  const chooseSeq = useRef(0);   // a slow answer for an earlier client must not replace the later one
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; abort.current?.abort(); }, []);

  // Where a new document gets its first rack: System settings, else the app's usual cabinet.
  const defaults: Defaults = useMemo(() => {
    const m = modelById(typeof system.rack_default_model === "string" ? system.rack_default_model : "") ?? modelById("apc-ar3100") ?? RACK_MODELS[0];
    const u = m.generic && typeof system.rack_default_u === "number" ? system.rack_default_u : m.u;
    return { model: m.id, u };
  }, [system]);

  useEffect(() => {
    A.auvikStatus().then(setStatus, (e) => setErr(msg(e)));
    A.auvikTenants().then(setTenants, (e) => setErr(msg(e)));
  }, []);

  // The Auvik clients: multi-client tenants, plus a client with no parent on its own.
  const parents = useMemo(() => (tenants ?? []).filter((t) => t.type === "multiClient" || (t.type === "client" && !t.parent)), [tenants]);
  const kids = useMemo(() => {
    const p = parents.find((x) => x.id === parent);
    if (!p) return [];
    return p.type === "client" ? [p] : (tenants ?? []).filter((t) => t.type === "client" && t.parent === p.id);
  }, [tenants, parents, parent]);

  const loadDocs = async (c: ClientItem): Promise<Map<number, SiteDocs>> => {
    const out = new Map<number, SiteDocs>();
    for (const s of c.sites) {
      const racks = await Promise.all(s.racks.filter((r) => r.id != null).map(async (r) => { const g = await A.getRack(r.id!); return { id: g.id, name: g.name, version: g.version, doc: g.doc as Doc }; }));
      out.set(s.id, { siteId: s.id, racks });
    }
    return out;
  };
  const mapping = (c: ClientItem, d: Map<number, SiteDocs>, list: AuvikTenant[]) => {
    const m: Record<string, SitePick> = {};
    for (const t of list) m[t.id] = { on: false, siteId: mapTenantToSite(t, c, d).siteId };
    return m;
  };

  const choose = async (id: string) => {
    const seq = ++chooseSeq.current;
    setParent(id); setErr(""); setDocs(null); setPicks({});
    if (!id) return;
    try {
      const fresh = await clientStore().get(cl.key);
      const d = await loadDocs(fresh);
      const p = parents.find((x) => x.id === id)!;
      const list = p.type === "client" ? [p] : (tenants ?? []).filter((t) => t.type === "client" && t.parent === p.id);
      if (!alive.current || seq !== chooseSeq.current) return;
      setCl(fresh); setDocs(d); setPicks(mapping(fresh, d, list));
    } catch (e) { if (alive.current && seq === chooseSeq.current) setErr("Could not read this client's racks. " + msg(e)); }
  };

  const testConn = async () => {
    setTest("Testing...");
    try { const r = await A.auvikTest(); setTest(r.ok ? "Connection works." : r.error ? `Connection failed: ${r.error.replace(/[.\s]+$/, "")}.` : "Connection failed."); }
    catch (e) { setTest(`Connection failed: ${msg(e).replace(/[.\s]+$/, "")}.`); }
  };

  const chosen = kids.filter((t) => picks[t.id]?.on);
  const siteUse = new Map<number, number>();
  for (const t of chosen) { const s = picks[t.id].siteId; if (s != null) siteUse.set(s, (siteUse.get(s) ?? 0) + 1); }
  const clash = [...siteUse.values()].some((n) => n > 1);

  // Read the ticked sites one at a time.
  const read = async () => {
    stopped.current = false; setErr(""); setStage("reading");
    const out: Read[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const t = chosen[i];
      if (stopped.current || !alive.current) break;
      setProgress({ n: i + 1, of: chosen.length, name: t.name, cables: false });
      const ac = new AbortController(); abort.current = ac;
      let inv: AuvikInventory;
      try {
        inv = await A.auvikInventory(t.id, ac.signal);
      } catch (e) {
        if (stopped.current) break;
        // one site that fails (a 403 included) is skipped; the other sites are still read and imported
        const denied = e instanceof A.ApiError && e.status === 403;
        out.push({ tenant: t, inv: null, note: skipLine(t.name, denied ? { status: "denied", note: "", devices: [] } : e), links: null, linkNote: "" });
        continue;
      }
      const skip = skipLine(t.name, inv);
      if (skip) { out.push({ tenant: t, inv: null, note: skip, links: null, linkNote: "" }); continue; }
      // The cables come after the devices. A site whose devices were read is kept even when its cables fail or Stop lands here.
      setProgress({ n: i + 1, of: chosen.length, name: t.name, cables: true });
      let links: AuvikLinks | null = null, linkNote = "";
      try {
        const l = await A.auvikLinks(t.id, ac.signal);
        if (l.status === "ok") { links = l; if (!l.links.length) linkNote = `Auvik lists no connections for ${t.name}.`; }
        else linkNote = l.status === "empty" ? `Auvik lists no connections for ${t.name}.` : cablesFailed(t.name);
      } catch {
        if (stopped.current) { out.push({ tenant: t, inv, note: "", links: null, linkNote: `Cables were not read for ${t.name} (stopped); devices are imported without them.` }); break; }
        linkNote = cablesFailed(t.name);
      }
      out.push({ tenant: t, inv, note: "", links, linkNote });
    }
    abort.current = null;
    if (!alive.current) return;
    setReads(out);
    setSites(Object.fromEntries(out.map((r) => [r.tenant.id, newSiteState()])));
    setTab(out.find((r) => r.inv)?.tenant.id ?? out[0]?.tenant.id ?? "");
    setStage(out.length ? "preview" : "pick");
    if (!out.length) setErr("Nothing was read.");
  };
  const stop = () => { stopped.current = true; abort.current?.abort(); };

  const docsOf = (t: AuvikTenant): SiteDocs => { const s = picks[t.id]?.siteId; return (s != null && docs?.get(s)) || { siteId: s ?? 0, racks: [] }; };
  const nameOf = (t: AuvikTenant) => { const s = picks[t.id]?.siteId; return s != null ? cl.sites.find((x) => x.id === s)?.name ?? t.name : t.name; };
  /** `all` keeps every device (for the table); otherwise the unticked ones are left out (what is saved). */
  const planFor = (r: Read, all: boolean): SitePlan => {
    const st = sites[r.tenant.id] ?? newSiteState();
    const inv = !all && st.excluded.size ? { ...r.inv!, devices: r.inv!.devices.filter((d) => !st.excluded.has(d.id)) } : r.inv!;
    return planSite(inv, r.tenant, docsOf(r.tenant), defaults, st.fill, st.layout ?? undefined, st.hosts, { kinds: st.kinds, types: st.types, models: st.models }, r.links ?? undefined);
  };
  const active = reads.find((r) => r.tenant.id === tab);
  const plans = useMemo((): { view: SitePlan; eff: SitePlan; error?: undefined } | { error: string } | null => {
    if (stage !== "preview" || !active?.inv) return null;
    try { const view = planFor(active, true); const eff = sites[active.tenant.id]?.excluded.size ? planFor(active, false) : view; return { view, eff }; }
    catch (e) { return { error: msg(e) }; }
  }, [stage, active, sites, docs, picks, defaults]); // eslint-disable-line react-hooks/exhaustive-deps

  const doImport = async () => {
    setStage("saving"); setLines([]);
    const out: string[] = [];
    const next = { ...picks };
    for (const r of reads) {
      if (!r.inv) { out.push(r.note); continue; }
      setProgress({ n: out.length + 1, of: reads.length, name: r.tenant.name, cables: false });
      try {
        const p = planFor(r, false);
        const sel = ticksOf(p, sites[r.tenant.id].over);
        const res = await saveSite(p, sel, { clientKey: cl.key, siteId: picks[r.tenant.id].siteId, siteName: nameOf(r.tenant) });
        out.push(res.line);
        next[r.tenant.id] = { ...next[r.tenant.id], siteId: res.siteId };   // a re-run must not make a second site
      } catch (e) { out.push(`${r.tenant.name}: could not save. ${msg(e)}`); }
    }
    setPicks(next); setLines(out); setStage("done");
  };
  const again = async () => {
    setErr(""); setReads([]); setStage("pick");
    try {
      const fresh = await clientStore().get(cl.key);
      const d = await loadDocs(fresh);
      setCl(fresh); setDocs(d); setPicks(mapping(fresh, d, kids));   // the saved sites are now found by tenant id
    } catch (e) { setErr(msg(e)); }
  };
  const close = async () => { try { await onDone(); } finally { onClose(); } };

  const busy = stage === "reading" || stage === "saving";
  // Escape closes the dialog wherever the focus is, but never while sites are being read or saved.
  const onEsc = useRef(() => {});
  onEsc.current = () => { if (!busy) void close(); };
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onEsc.current(); };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, []);
  const body = { overflow: "auto", flex: 1, minHeight: 0 } as const;
  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width: 1100, maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 12 }}>
        <BusyStyle />
        <div style={{ display: "flex", marginBottom: 10 }}>
          <b style={{ flex: 1, fontSize: 14 }}>Import from Auvik</b>
          <button style={{ ...btn, marginRight: 0, padding: "1px 8px" }} disabled={busy} onClick={close}>x</button>
        </div>
        {err && <div style={{ background: v("error-bg"), color: v("error-text"), padding: "6px 10px", marginBottom: 8, borderRadius: 4 }}>{err}</div>}

        {stage === "pick" && (
          <div style={body}>
            <div style={{ marginBottom: 6 }}>
              {status ? `Connected to Auvik (${status.region}, ${status.username})` : <Busy style={{ display: "inline-block" }}>Checking the Auvik connection...</Busy>}
              <button style={{ ...btn, marginLeft: 10 }} onClick={testConn}>Test connection</button>
              {test === "Testing..." ? <Busy style={{ display: "inline-block" }}>{test}</Busy> : <span style={{ opacity: 0.85 }}>{test}</span>}
            </div>
            <div style={{ margin: "10px 0 6px" }}>Choose the Auvik client to import into <b>{cl.name}</b>.</div>
            {tenants === null && !err && <Busy>Loading the Auvik clients...</Busy>}
            {tenants && <select style={{ ...inp, minWidth: 260 }} value={parent} onChange={(e) => choose(e.target.value)}>
              <option value="">Choose a client...</option>
              {parents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>}
            {parent && !docs && !err && <Busy style={{ marginTop: 8 }}>Checking the sites already in Rackwright...</Busy>}
            {parent && docs && (
              <div style={{ marginTop: 10 }}>
                {!kids.length && <div style={{ opacity: 0.8 }}>This Auvik client has no sites.</div>}
                {kids.length > 0 && <div style={{ marginBottom: 4 }}>Tick the sites to read. Pick the Rackwright site each one goes to.</div>}
                {kids.map((t) => {
                  const p = picks[t.id] ?? { on: false, siteId: null };
                  const set = (q: Partial<SitePick>) => setPicks((o) => ({ ...o, [t.id]: { ...p, ...q } }));
                  return (
                    <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "2px 0" }}>
                      <label style={{ width: 300 }}><input type="checkbox" aria-label={`Read ${t.name}`} checked={p.on} onChange={(e) => set({ on: e.target.checked })} /> {t.name}</label>
                      <select style={{ ...inp, minWidth: 220 }} value={p.siteId ?? ""} onChange={(e) => set({ siteId: e.target.value === "" ? null : +e.target.value })}>
                        <option value="">(new site)</option>
                        {cl.sites.map((s) => <option key={s.id} value={s.id}>Update {s.name}</option>)}
                      </select>
                    </div>
                  );
                })}
                {clash && <div style={{ color: v("danger"), marginTop: 6 }}>Two ticked sites go to the same Rackwright site. Pick a different site for one of them.</div>}
                <div style={{ marginTop: 10 }}>
                  <button style={btn} disabled={!chosen.length || clash} onClick={read}>{chosen.length ? `Read ${chosen.length} site${chosen.length === 1 ? "" : "s"}` : "Tick a site to read"}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {stage === "reading" && (
          <div style={{ padding: "10px 0" }}>
            <Busy style={{ marginBottom: 6 }}>{progress.cables ? "Reading cables for site" : "Reading site"} {progress.n} of {progress.of}: {progress.name}…</Busy>
            <progress style={{ width: "100%", accentColor: v("link") }} value={progress.n - 1} max={progress.of} />
            <div style={{ marginTop: 8 }}><button style={btn} onClick={stop}>Stop</button><span style={{ opacity: 0.7 }}>Stop keeps the sites already read.</span></div>
          </div>
        )}

        {stage === "preview" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {reads.map((r) => (
                <button key={r.tenant.id} disabled={!r.inv} title={r.inv ? "" : r.note} onClick={() => setTab(r.tenant.id)}
                  style={{ ...btn, marginRight: 0, background: tab === r.tenant.id ? v("border") : v("control"), opacity: r.inv ? 1 : 0.5, cursor: r.inv ? "pointer" : "default" }}>{r.tenant.name}</button>
              ))}
            </div>
            {reads.filter((r) => !r.inv).map((r) => <div key={r.tenant.id} style={{ opacity: 0.7, marginBottom: 2 }}>{r.note}</div>)}
            {active?.inv && plans && "error" in plans && <div style={{ color: v("danger") }}>Could not plan this site. {plans.error}</div>}
            {active?.inv && plans && "view" in plans && (
              <SitePreview key={active.tenant.id} view={plans.view} eff={plans.eff} st={sites[active.tenant.id] ?? newSiteState()}
                setSt={(f) => setSites((o) => ({ ...o, [active.tenant.id]: f(o[active.tenant.id] ?? newSiteState()) }))}
                targetName={nameOf(active.tenant)} isNew={picks[active.tenant.id]?.siteId == null} linkNote={active.linkNote} />
            )}
            {!active?.inv && <div style={{ padding: 12, opacity: 0.8 }}>Nothing to import from these sites.</div>}
            <div style={{ marginTop: 10, textAlign: "right" }}>
              <button style={btn} onClick={() => { setReads([]); setStage("pick"); }}>Back</button>
              <button style={{ ...btn, marginRight: 0 }} disabled={!reads.some((r) => r.inv)} onClick={doImport}>Import</button>
            </div>
          </>
        )}

        {stage === "saving" && (
          <Busy style={{ padding: "10px 0" }}>Importing site {progress.n} of {progress.of}: {progress.name}…</Busy>
        )}

        {stage === "done" && (
          <div style={body}>
            <b>Done.</b>
            {lines.map((l, i) => <div key={i} style={{ padding: "2px 0" }}>{l}</div>)}
            <div style={{ marginTop: 10 }}>
              <button style={btn} onClick={again}>Import more sites</button>
              <button style={{ ...btn, marginRight: 0 }} onClick={close}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
