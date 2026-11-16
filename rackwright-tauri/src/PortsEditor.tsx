// Collapsible port list in the properties panel: rename, change type, add, delete.
import { useState } from "react";
import { Device, Doc, PORT_COLORS } from "./types";
import { addPort, deletePort } from "./endpointEdit";

type Edit = (fn: (d: Doc) => string | void, key?: string) => boolean;
const inp = { background: "#14161a", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "2px 4px", fontSize: 11 } as const;
const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 } as const;

export default function PortsEditor({ dev, doc, edit }: { dev: Device; doc: Doc; edit: Edit }) {
  const [open, setOpen] = useState(false);
  const cabled = (pid: number) => doc.cables.some((c) => c.a === pid || c.b === pid);
  const patch = (pid: number, k: "name" | "type", v: string) =>
    edit((d) => { const p = d.devices.find((x) => x.id === dev.id)?.ports.find((x) => x.id === pid); if (p) p[k] = v; }, `port${pid}${k}`);
  const del = (pid: number, name: string) => {
    if (cabled(pid) && !confirm(`Delete port ${name} and the cable on it?`)) return;
    edit((d) => { deletePort(d, dev.id, pid); return `Deleted port ${name}`; });
  };
  return (
    <div style={{ margin: "6px 0", fontSize: 12 }}>
      <a href="#" style={{ color: "#58a6ff" }} onClick={(e) => { e.preventDefault(); setOpen(!open); }}>{open ? "▾" : "▸"} Ports ({dev.ports.length})</a>
      {open && (
        <div style={{ marginTop: 4 }}>
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {dev.ports.map((p) => (
              <div key={p.id} style={{ display: "flex", gap: 3, marginBottom: 2, alignItems: "center" }}>
                <input style={{ ...inp, width: 66 }} value={p.name} onChange={(e) => patch(p.id, "name", e.target.value)} />
                <select style={{ ...inp, width: 76 }} value={p.type} onChange={(e) => patch(p.id, "type", e.target.value)}>
                  {Object.keys(PORT_COLORS).map((t) => <option key={t}>{t}</option>)}
                  {!(p.type in PORT_COLORS) && <option>{p.type}</option>}
                </select>
                <span title={cabled(p.id) ? "Cabled" : "Free"} style={{ width: 8, height: 8, borderRadius: 4, background: cabled(p.id) ? "#2ea043" : "#3a3d42" }} />
                <button style={{ ...btn, padding: "0 6px", color: "#f85149" }} title="Delete this port" onClick={() => del(p.id, p.name)}>x</button>
              </div>
            ))}
          </div>
          <button style={{ ...btn, marginTop: 4 }} onClick={() => edit((d) => { addPort(d, dev.id, dev.ports[dev.ports.length - 1]?.type ?? "RJ45"); })}>Add port</button>
        </div>
      )}
    </div>
  );
}
