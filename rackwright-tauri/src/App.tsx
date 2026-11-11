import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import RackView, { Sel } from "./RackView";
import { Doc, PortPos, RouteResult } from "./types";
import { CATALOG, addRack, buildFromText, clone, deleteDevice, deleteRack, fits, fromTpl, newCable, placeNew, portOf } from "./edit";

const empty: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
const none: RouteResult = { routes: [], hints: [] };
const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "5px 12px", marginRight: 6, cursor: "pointer" } as const;
const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "4px 6px" } as const;

export default function App() {
  const [doc, setDoc] = useState<Doc>(empty);
  const [undo, setUndo] = useState<Doc[]>([]);
  const [redo, setRedo] = useState<Doc[]>([]);
  const [dirty, setDirty] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [face, setFace] = useState<"front" | "rear">("front");
  const [routes, setRoutes] = useState<RouteResult>(none);
  const [ports, setPorts] = useState<PortPos[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importH, setImportH] = useState("0");

  useEffect(() => {
    invoke<RouteResult>("route_cables", { doc, face }).then(setRoutes).catch((e) => setMsg(String(e)));
    invoke<PortPos[]>("port_positions", { doc }).then(setPorts).catch((e) => setMsg(String(e)));
  }, [doc, face]);

  /** Apply an edit to a copy of the document, with undo. fn returns a status message, or "!msg" to reject the edit. */
  const edit = useCallback((fn: (d: Doc) => string | void): boolean => {
    const next = clone(doc);
    const m = fn(next) || "";
    if (m.startsWith("!")) { setMsg(m.slice(1)); return false; }
    setUndo((u) => [...u.slice(-99), doc]);
    setRedo([]);
    setDoc(next);
    setDirty(true);
    setMsg(m);
    return true;
  }, [doc]);

  const doUndo = useCallback(() => {
    if (!undo.length) return;
    setRedo((r) => [...r, doc]); setDoc(undo[undo.length - 1]); setUndo(undo.slice(0, -1)); setDirty(true); setSel(null);
  }, [undo, doc]);
  const doRedo = useCallback(() => {
    if (!redo.length) return;
    setUndo((u) => [...u, doc]); setDoc(redo[redo.length - 1]); setRedo(redo.slice(0, -1)); setDirty(true); setSel(null);
  }, [redo, doc]);

  const del = useCallback(() => {
    if (!sel) return;
    edit((d) => {
      if (sel.kind === "cable") d.cables = d.cables.filter((c) => c.id !== sel.id);
      else if (sel.kind === "dev") deleteDevice(d, sel.id);
      else deleteRack(d, sel.id);
    });
    setSel(null);
  }, [sel, edit]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
      else if (e.key === "Delete") del();
      else if (e.key === "Escape") { setPending(null); setSel(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doUndo, doRedo, del]);

  const reset = (d: Doc, p: string | null) => { setDoc(d); setPath(p); setUndo([]); setRedo([]); setSel(null); setPending(null); setDirty(false); };
  const doNew = () => { if (!dirty || confirm("Discard unsaved changes?")) reset(clone(empty), null); };
  const doOpen = async () => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    const p = await open({ filters: [{ name: "Rack", extensions: ["json"] }] });
    if (typeof p !== "string") return;
    try { reset(await invoke<Doc>("open_doc", { path: p }), p); setMsg(""); } catch (e) { setMsg(String(e)); }
  };
  const doSave = async (asNew = false) => {
    const p = (!asNew && path) || (await save({ filters: [{ name: "Rack", extensions: ["json"] }], defaultPath: "rack.rack.json" }));
    if (!p) return;
    try { await invoke("save_doc", { path: p, doc }); setPath(p); setDirty(false); setMsg("Saved"); } catch (e) { setMsg(String(e)); }
  };

  const onPort = (pid: number) => {
    if (pending == null) { setPending(pid); setMsg("Click a second port to connect"); return; }
    if (pending === pid) { setPending(null); return; }
    let newId = 0;
    const ok = edit((d) => {
      const c = newCable(d, pending, pid);
      if (typeof c === "string") return "!" + c;
      newId = c.id;
    });
    if (ok) setSel({ kind: "cable", id: newId });
    setPending(null);
  };

  const onMoveDevice = (id: number, rack: number | null, u: number, side: number, fx: number, fy: number) =>
    edit((d) => {
      const dev = d.devices.find((x) => x.id === id)!;
      dev.rack = rack; if (rack != null) { dev.u = u; dev.side = side; } else { dev.fx = fx; dev.fy = fy; }
    });

  const addFromCatalog = (i: number) => {
    let id = 0;
    const ok = edit((d) => {
      const dev = fromTpl(d, CATALOG[i]);
      id = dev.id;
      return placeNew(d, dev, face, sel?.kind === "rack" ? sel.id : sel?.kind === "dev" ? d.devices.find((x) => x.id === sel.id)?.rack : null);
    });
    if (ok) setSel({ kind: "dev", id });
  };

  const doImport = () => {
    let n = 0;
    const ok = edit((d) => {
      n = buildFromText(d, importText, parseInt(importH) || 0);
      return n ? `Imported ${n} rack(s)` : "!No rack lines found. Each line needs a size like (2U).";
    });
    if (ok) setImportOpen(false);
  };

  const list = useMemo(() => {
    const t = q.toLowerCase().split(/\s+/).filter(Boolean);
    return CATALOG.map((c, i) => ({ c, i })).filter(({ c }) => {
      const hay = `${c.name} ${c.type} ${c.group || ""} ${c.model || ""}`.toLowerCase();
      return t.every((w) => hay.includes(w));
    }).slice(0, 200);
  }, [q]);

  const selDev = sel?.kind === "dev" ? doc.devices.find((d) => d.id === sel.id) : undefined;
  const selCable = sel?.kind === "cable" ? doc.cables.find((c) => c.id === sel.id) : undefined;
  const selRack = sel?.kind === "rack" ? doc.racks.find((r) => r.id === sel.id) : undefined;
  const endp = (pid: number) => { const o = portOf(doc, pid); return o ? `${o.d.name} ${o.p.name}` : "?"; };
  const cab = (c: NonNullable<typeof selCable>, patch: Record<string, unknown>) =>
    edit((d) => { Object.assign(d.cables.find((x) => x.id === c.id)!, patch); });
  const field = (label: string, val: string | number, set: (v: string) => void, w = 140) => (
    <label style={{ display: "block", marginBottom: 6, fontSize: 12 }}>{label}<br />
      <input style={{ ...inp, width: w }} value={val} onChange={(e) => set(e.target.value)} /></label>
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", color: "#e6e8eb", fontFamily: "Segoe UI, sans-serif" }}>
      <div style={{ height: 40, padding: "5px 8px", background: "#1b1d21", borderBottom: "1px solid #2c2f35", boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden" }}>
        <button style={btn} onClick={doNew}>New</button>
        <button style={btn} onClick={doOpen}>Open</button>
        <button style={btn} onClick={() => doSave()}>Save{dirty ? " *" : ""}</button>
        <button style={btn} onClick={() => doSave(true)}>Save as</button>
        <button style={btn} onClick={doUndo} disabled={!undo.length}>Undo</button>
        <button style={btn} onClick={doRedo} disabled={!redo.length}>Redo</button>
        <button style={btn} onClick={() => edit((d) => { const r = addRack(d); setSel({ kind: "rack", id: r.id }); })}>+ Rack</button>
        <button style={btn} onClick={() => setImportOpen(true)}>Import list</button>
        <button style={btn} onClick={() => setFace(face === "front" ? "rear" : "front")}>Showing: {face} (flip)</button>
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {path ?? "no file"} | {doc.racks.length}R {doc.devices.length}D {doc.cables.length}C {msg}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ width: 250, background: "#1b1d21", borderRight: "1px solid #2c2f35", display: "flex", flexDirection: "column", fontSize: 12 }}>
          <input style={{ ...inp, margin: 6 }} placeholder="Search devices (dell r650, ups, 48...)" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ flex: 1, overflow: "auto" }}>
            {list.map(({ c, i }) => (
              <div key={i} onClick={() => addFromCatalog(i)} title="Click to add to the rack"
                style={{ padding: "4px 8px", borderBottom: "1px solid #24272c", cursor: "pointer" }}>
                {c.name} <span style={{ opacity: 0.55 }}>{c.u_size}U {c.type}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RackView doc={doc} face={face} routes={routes} ports={ports} selected={sel} onSelect={setSel}
            pendingPort={pending} onPort={onPort} onMoveDevice={onMoveDevice} />
        </div>
        {sel && (
          <div style={{ width: 220, background: "#1b1d21", borderLeft: "1px solid #2c2f35", padding: 8 }}>
            {selRack && <>
              <b>Rack</b>
              {field("Name", selRack.name, (v) => edit((d) => { d.racks.find((r) => r.id === selRack.id)!.name = v; }))}
              {field("Height (U)", selRack.u, (v) => edit((d) => { d.racks.find((r) => r.id === selRack.id)!.u = Math.max(1, parseInt(v) || 1); }), 60)}
            </>}
            {selDev && <>
              <b>Device</b>
              {field("Name", selDev.name, (v) => edit((d) => { d.devices.find((x) => x.id === selDev.id)!.name = v; }))}
              {field("IP", selDev.ip ?? "", (v) => edit((d) => { d.devices.find((x) => x.id === selDev.id)!.ip = v; }))}
              <label style={{ fontSize: 12 }}>Mounted<br />
                <select style={inp} value={selDev.face} onChange={(e) => edit((d) => {
                  const x = d.devices.find((y) => y.id === selDev.id)!; x.face = e.target.value;
                  const r = d.racks.find((z) => z.id === x.rack);
                  if (r && !fits(d, r, x)) return "!That face is occupied";
                })}>
                  <option>front</option><option>rear</option><option>both</option>
                </select></label>
              <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>{selDev.type} {selDev.u_size}U, {selDev.ports.length} ports. Drag it to move; click a port, then another, to cable.</div>
            </>}
            {selCable && <>
              <b>Cable</b>
              <div style={{ fontSize: 12, margin: "6px 0" }}>{endp(selCable.a)}<br />to {endp(selCable.b)}</div>
              {field("Label", selCable.label ?? "", (v) => cab(selCable, { label: v }))}
              <label style={{ fontSize: 12 }}>Colour<br />
                <input type="color" value={selCable.color || "#1f6feb"} onChange={(e) => cab(selCable, { color: e.target.value })} /></label>
              <label style={{ fontSize: 12, display: "block", margin: "6px 0" }}>Style<br />
                <select style={inp} value={selCable.style ?? "solid"} onChange={(e) => cab(selCable, { style: e.target.value })}>
                  <option>solid</option><option>dashed</option>
                </select></label>
            </>}
            <button style={{ ...btn, marginTop: 10, color: "#f85149" }} onClick={del}>Delete</button>
          </div>
        )}
      </div>
      {routes.hints.length > 0 && (
        <div style={{ maxHeight: 70, overflow: "auto", background: "#1b1d21", fontSize: 12, padding: 6, borderTop: "1px solid #2c2f35" }}>
          {routes.hints.map((h, i) => <div key={i}>! {h.msg}</div>)}
        </div>
      )}
      {importOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1b1d21", padding: 14, borderRadius: 6, width: 520, border: "1px solid #3a3d42" }}>
            <div style={{ fontSize: 12, marginBottom: 6, opacity: 0.8 }}>Paste a list, top of rack first, e.g. "Rack1", "- Panel A - (2U)", "- Open - (12U)". Open/Empty/Free leave a gap; add "rear" to mount on the back.</div>
            <textarea style={{ ...inp, width: "100%", height: 260, boxSizing: "border-box" }} value={importText} onChange={(e) => setImportText(e.target.value)} />
            <div style={{ marginTop: 8, fontSize: 12 }}>Rack height (0 = size to list): <input style={{ ...inp, width: 50 }} value={importH} onChange={(e) => setImportH(e.target.value)} />
              <span style={{ float: "right" }}>
                <button style={btn} onClick={() => setImportOpen(false)}>Cancel</button>
                <button style={{ ...btn, marginRight: 0 }} onClick={doImport}>Build racks</button>
              </span></div>
          </div>
        </div>
      )}
    </div>
  );
}
