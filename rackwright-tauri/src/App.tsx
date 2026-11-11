import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import RackView from "./RackView";
import { Doc, PortPos, RouteResult } from "./types";

const empty: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
const none: RouteResult = { routes: [], hints: [] };

export default function App() {
  const [doc, setDoc] = useState<Doc>(empty);
  const [path, setPath] = useState<string | null>(null);
  const [face, setFace] = useState<"front" | "rear">("front");
  const [routes, setRoutes] = useState<RouteResult>(none);
  const [ports, setPorts] = useState<PortPos[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    invoke<RouteResult>("route_cables", { doc, face }).then(setRoutes).catch((e) => setErr(String(e)));
    invoke<PortPos[]>("port_positions", { doc }).then(setPorts).catch((e) => setErr(String(e)));
  }, [doc, face]);

  const doOpen = async () => {
    const p = await open({ filters: [{ name: "Rack", extensions: ["json"] }] });
    if (typeof p !== "string") return;
    try { setDoc(await invoke<Doc>("open_doc", { path: p })); setPath(p); setErr(""); } catch (e) { setErr(String(e)); }
  };
  const doSave = async () => {
    const p = path ?? (await save({ filters: [{ name: "Rack", extensions: ["json"] }] }));
    if (!p) return;
    try { await invoke("save_doc", { path: p, doc }); setPath(p); } catch (e) { setErr(String(e)); }
  };

  const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "5px 12px", marginRight: 6 };
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", color: "#e6e8eb", fontFamily: "Segoe UI, sans-serif" }}>
      <div style={{ height: 40, padding: "5px 8px", background: "#1b1d21", borderBottom: "1px solid #2c2f35", boxSizing: "border-box" }}>
        <button style={btn} onClick={doOpen}>Open</button>
        <button style={btn} onClick={doSave}>Save</button>
        <button style={btn} onClick={() => setFace(face === "front" ? "rear" : "front")}>Showing: {face} (flip)</button>
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {path ?? "no file"} | {doc.racks.length} racks, {doc.devices.length} devices, {doc.cables.length} cables
          {routes.hints.length ? ` | ${routes.hints.length} cabling hint(s)` : ""} {err}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <RackView doc={doc} face={face} routes={routes} ports={ports} selected={sel} onSelect={setSel} />
      </div>
      {routes.hints.length > 0 && (
        <div style={{ maxHeight: 90, overflow: "auto", background: "#1b1d21", fontSize: 12, padding: 6, borderTop: "1px solid #2c2f35" }}>
          {routes.hints.map((h, i) => <div key={i}>! {h.msg}</div>)}
        </div>
      )}
    </div>
  );
}
