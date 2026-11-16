import { Device, Doc } from "../types";

const btn = { background: "#2a2d33", color: "#e6e8eb", border: "1px solid #3a3d42", borderRadius: 4, padding: "5px 12px", cursor: "pointer" } as const;
export const isDown = (s: string) => /down|unreach/i.test(s);
export const StatusChip = ({ s }: { s: string }) => (
  <span style={{ padding: "0 6px", borderRadius: 8, fontSize: 11, background: isDown(s) ? "#5a1d1d" : "#1d3a2a", color: isDown(s) ? "#ff7b72" : "#7ee787", border: `1px solid ${isDown(s) ? "#f85149" : "#2ea043"}` }}>{s || "Up"}</span>
);

export { EndpointTable } from "./EndpointEditor";

export function UnplacedDialog({ items, onClose }: { items: { name: string; type: string; model: string; ip: string; status: string; reason: string }[]; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div style={{ background: "#1b1d21", padding: 14, borderRadius: 6, width: 760, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", border: "1px solid #3a3d42", color: "#e6e8eb", fontSize: 12 }}>
        <div style={{ display: "flex", marginBottom: 8 }}><b style={{ flex: 1, fontSize: 14 }}>Unplaced endpoints ({items.length})</b><button style={btn} onClick={onClose}>Close</button></div>
        <div style={{ opacity: 0.7, marginBottom: 6 }}>These devices are in the Auvik export but could not be tied to a switch port.</div>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left", opacity: 0.7 }}><th>Name</th><th>Type</th><th>Model</th><th>IP</th><th>Status</th><th>Why</th></tr></thead>
            <tbody>{items.map((u, i) => <tr key={i} style={{ borderTop: "1px solid #2c2f35" }}><td>{u.name}</td><td>{u.type}</td><td>{u.model}</td><td>{u.ip}</td><td><StatusChip s={u.status} /></td><td>{u.reason}</td></tr>)}</tbody>
          </table>
          {!items.length && <div style={{ padding: 10, opacity: 0.6 }}>None.</div>}
        </div>
      </div>
    </div>
  );
}

/** Small "Auvik" info block for the Overview panel. */
export function AuvikInfo({ doc, onOpen }: { doc: Doc; onOpen: () => void }) {
  if (!doc.auvik) return null;
  return (
    <div style={{ fontSize: 12, marginTop: 8 }}>
      Auvik: {doc.auvik.site}, imported {doc.auvik.imported}.{" "}
      <a href="#" style={{ color: "#58a6ff" }} onClick={(e) => { e.preventDefault(); onOpen(); }}>{doc.auvik.unplaced.length} unplaced endpoint(s)</a>
    </div>
  );
}
