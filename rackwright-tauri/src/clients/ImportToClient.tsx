// Import an Auvik export straight into a client: one rack per site, devices split by network if wanted.
import { useState } from "react";
import * as A from "../api";
import type { Doc } from "../types";
import { RACK_MODELS, modelById, specOf } from "../racks";
import type { ParsedAuvik } from "../auvik/parse";
import { ClientItem, clientStore } from "./store";

const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer", fontSize: 12 } as const;
const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "3px 5px", fontSize: 12 } as const;
const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MAIN = "main";
const NEW_MAIN = "main:new";
const safeName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim() || "Site";
const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")));

export default function ImportToClient({ client, onDone, onClose }: { client: ClientItem; onDone: () => Promise<unknown> | void; onClose: () => void }) {
  const store = clientStore();
  const [parsed, setParsed] = useState<ParsedAuvik | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [mainSel, setMainSel] = useState<string>(client.sites[0] ? `s${client.sites[0].id}` : NEW_MAIN);
  const [mainName, setMainName] = useState("");
  const [assign, setAssign] = useState<Record<string, string>>({}); // network -> "main" | "s<id>" | "n:<name>"
  const [newSites, setNewSites] = useState<string[]>([]);
  const [newText, setNewText] = useState("");
  const [nets, setNets] = useState<{ name: string; devices: number }[]>([]);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setErr(""); setBusy(true);
    try {
      const [{ readXlsx }, { parseAuvik }, { networksOf }] = await Promise.all([import("../auvik/xlsx"), import("../auvik/parse"), import("../auvik/split")]);
      const p = parseAuvik(await readXlsx(await f.arrayBuffer()));
      setParsed(p); setNets(networksOf(p)); setMainName(p.site || "Auvik import"); setAssign({});
    } catch (e) { setErr(errOf(e)); }
    setBusy(false);
  };

  const model = modelById("apc-ar3100") ?? RACK_MODELS[0];
  const label = (key: string): string => {
    if (key === MAIN) return label(mainSel);
    if (key === NEW_MAIN) return mainName.trim() || "Auvik import";
    if (key.startsWith("n:")) return key.slice(2);
    return client.sites.find((s) => `s${s.id}` === key)?.name ?? key;
  };
  const addNewSite = () => {
    const n = newText.trim();
    if (!n || newSites.includes(n) || client.sites.some((s) => s.name.toLowerCase() === n.toLowerCase())) { setNewText(""); return; }
    setNewSites([...newSites, n]); setNewText("");
  };

  const run = async () => {
    if (!parsed) return;
    setBusy(true); setErr(""); setDone("");
    try {
      const [{ buildItems, resolvePlan }, { applyPlan }, { splitBySite }] = await Promise.all([import("../auvik/plan"), import("../auvik/apply"), import("../auvik/split")]);
      const eff: Record<string, string> = {};
      for (const [n, k] of Object.entries(assign)) if (k !== MAIN) eff[n] = k;
      const groups = splitBySite(parsed, eff, mainSel);
      // Targets: site key -> name
      const keys = Object.keys(groups).filter((k) => groups[k].devices.length);
      const names = new Map(keys.map((k) => [k, label(k)]));
      const clash = new Set<string>();
      for (const n of names.values()) { if (clash.has(n.toLowerCase())) throw new Error(`Two targets are called "${n}". Give them different names.`); clash.add(n.toLowerCase()); }
      // Create new sites first, then reload to find their ids.
      const wanted = keys.filter((k) => k === NEW_MAIN || k.startsWith("n:"));
      for (const k of wanted) await store.addSite(client.key, { name: names.get(k)! });
      const fresh = wanted.length ? await store.get(client.key) : client;
      const siteId = (k: string): number => {
        if (k.startsWith("s")) return Number(k.slice(1));
        const s = fresh.sites.find((x) => x.name.toLowerCase() === names.get(k)!.toLowerCase());
        if (!s) throw new Error(`Could not find the new site "${names.get(k)}".`);
        return s.id;
      };
      const taken = new Set<string>();
      let total = 0;
      for (const k of keys) {
        const sub = groups[k];
        const items = buildItems(sub);
        const plan = resolvePlan(sub, items);
        const base: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
        const { doc } = applyPlan(base, plan, { target: "new", spec: specOf(model), rackU: model.generic ? 42 : model.u }, items);
        const id = siteId(k), nm = names.get(k)!;
        if (store.web) {
          await A.createRack(`${nm} (Auvik)`, doc, id);
        } else {
          const { invoke } = await import("@tauri-apps/api/core");
          const dir = dirOf(client.key), sep = client.key.includes("\\") ? "\\" : "/";
          let n = 1, path = "";
          for (;;) {
            path = `${dir}${sep}${safeName(nm)} (Auvik)${n > 1 ? " " + n : ""}.rack.json`;
            if (taken.has(path.toLowerCase())) { n++; continue; }
            try { await invoke("read_text", { path }); n++; } catch { break; } // unreadable = does not exist
          }
          taken.add(path.toLowerCase());
          await invoke("save_doc", { path, doc });
          await store.addRacks(client.key, id, [], [path]);
        }
        total += items.filter((i) => i.mode !== "skip").length;
      }
      await onDone();
      setDone(`Imported ${total} devices into ${keys.length} site${keys.length === 1 ? "" : "s"}.`);
    } catch (e) { setErr(errOf(e)); await onDone(); }
    setBusy(false);
  };

  const siteOptions = (withMain: boolean) => (
    <>
      {withMain && <option value={MAIN}>Main site</option>}
      {client.sites.map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}
      {newSites.map((n) => <option key={n} value={`n:${n}`}>{n} (new)</option>)}
    </>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
      <div style={{ background: "#1b1d21", padding: 14, borderRadius: 6, width: 720, maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column", border: "1px solid #3a3d42", color: "#e6e8eb", fontSize: 12 }}>
        <div style={{ display: "flex", marginBottom: 10 }}>
          <b style={{ flex: 1, fontSize: 14 }}>Import Auvik into {client.name}</b>
          <button style={{ ...btn, marginRight: 0, padding: "1px 8px" }} onClick={onClose} disabled={busy}>x</button>
        </div>
        {err && <div style={{ color: "#f85149", marginBottom: 8 }}>{err}</div>}
        {!parsed && (
          <div style={{ padding: "10px 0" }}>
            <div style={{ marginBottom: 8 }}>Choose the device export from Auvik (.xlsx). The file stays on this computer.</div>
            <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => load(e.target.files?.[0])} />
            {busy && <span style={{ marginLeft: 8 }}>Reading...</span>}
          </div>
        )}
        {parsed && !done && (
          <div style={{ overflow: "auto", flex: 1 }}>
            <div style={{ marginBottom: 8 }}>{parsed.devices.length} devices found in {parsed.site || "the export"}.</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <b>Main site:</b>
              <select style={inp} value={mainSel} onChange={(e) => setMainSel(e.target.value)}>
                {client.sites.map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}
                <option value={NEW_MAIN}>New site</option>
              </select>
              {mainSel === NEW_MAIN && <input style={inp} value={mainName} onChange={(e) => setMainName(e.target.value)} placeholder="Site name" />}
            </div>
            <details open={nets.length > 0 && Object.keys(assign).length > 0}>
              <summary style={{ cursor: "pointer", marginBottom: 6 }}>Split by network (optional)</summary>
              <div style={{ opacity: 0.75, marginBottom: 6 }}>Devices go to the site of their network. Use this when each office has its own subnets.</div>
              <div style={{ marginBottom: 6 }}>
                <input style={inp} value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="New site name" onKeyDown={(e) => e.key === "Enter" && addNewSite()} />
                <button style={{ ...btn, marginLeft: 5 }} onClick={addNewSite}>Add site</button>
              </div>
              {!nets.length && <div style={{ opacity: 0.7 }}>This export lists no networks.</div>}
              <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #2c2f35", borderRadius: 4 }}>
                {nets.map((n) => (
                  <div key={n.name} style={{ display: "flex", gap: 8, padding: "2px 6px", alignItems: "center", borderTop: "1px solid #22252b" }}>
                    <span style={{ flex: 1 }}>{n.name}</span>
                    <span style={{ opacity: 0.65 }}>{n.devices} device{n.devices === 1 ? "" : "s"}</span>
                    <select style={{ ...inp, maxWidth: 200 }} value={assign[n.name] ?? MAIN} onChange={(e) => setAssign((a) => ({ ...a, [n.name]: e.target.value }))}>{siteOptions(true)}</select>
                  </div>
                ))}
              </div>
            </details>
            <div style={{ opacity: 0.75, marginTop: 10 }}>Each site gets one new rack with default choices. To review or update later, open the rack and use Import Auvik there.</div>
          </div>
        )}
        {done && <div style={{ padding: "10px 0" }}>{done}</div>}
        <div style={{ marginTop: 10, textAlign: "right" }}>
          <button style={btn} onClick={onClose} disabled={busy}>{done ? "Close" : "Cancel"}</button>
          {parsed && !done && <button style={{ ...btn, marginRight: 0 }} disabled={busy || (mainSel === NEW_MAIN && !mainName.trim())} onClick={run}>{busy ? "Importing..." : "Import"}</button>}
        </div>
      </div>
    </div>
  );
}
