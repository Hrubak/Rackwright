import { v } from "../theme";
import { useMemo, useState } from "react";
import type { Doc } from "../types";
import type { Sel } from "../RackView";
import { switchPorts, portGroups, switchesOf, PortInfo } from "./switchPorts";
import { EMPTY_COLOR, INFRA_COLOR, KIND_COLOR, KIND_LABEL } from "./kinds";

const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px" } as const;
const colorOf = (i: PortInfo) => (i.kind === "empty" ? EMPTY_COLOR : i.kind === "infra" ? INFRA_COLOR : KIND_COLOR[i.kind]);
const kindText = (i: PortInfo) => (i.kind === "empty" ? "Empty" : i.kind === "infra" ? "Network device" : KIND_LABEL[i.kind][0]);

export default function SwitchView({ doc, selected, onSelect, onOpen }: { doc: Doc; selected: Sel; onSelect: (s: Sel) => void; onOpen?: (s: Sel) => void }) {
  const switches = useMemo(() => switchesOf(doc), [doc]);
  const [pick, setPick] = useState<number | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const selDev = selected?.kind === "dev" ? switches.find((s) => s.id === selected.id) : undefined;
  const dev = selDev ?? switches.find((s) => s.id === pick) ?? switches[0];
  const infos = useMemo(() => (dev ? switchPorts(doc, dev) : []), [doc, dev]);
  const groups = useMemo(() => portGroups(infos), [infos]);
  const used = infos.filter((i) => i.kind !== "empty").length;
  const legend = (["infra", "pc", "phone", "iot", "printer", "vm", "other", "empty"] as const);

  if (!dev) return <div style={{ padding: 20, opacity: 0.7 }}>There are no switches in this rack yet. Add one in the Rack view.</div>;
  const choose = (id: number) => { setPick(id); onSelect({ kind: "dev", id }); };
  const cell = (i: PortInfo) => {
    const tip = i.kind === "empty" ? `Port ${i.port.name}: empty` : `Port ${i.port.name} to ${i.far}${i.ip ? " (" + i.ip + ")" : ""}, ${kindText(i)}`;
    return (
      <div key={i.port.id} title={tip} onDoubleClick={() => i.farDevId != null && onOpen?.({ kind: "dev", id: i.farDevId })} onClick={() => i.farDevId != null && onSelect({ kind: "dev", id: i.farDevId })}
        style={{ width: 54, height: 46, boxSizing: "border-box", borderRadius: 4, background: colorOf(i), border: `1px solid ${v("edge")}`, padding: "2px 3px", overflow: "hidden",
          color: i.kind === "empty" ? v("text-faint") : v("ink"), cursor: i.farDevId != null ? "pointer" : "default", fontSize: 9.5, lineHeight: "11px" }}>
        <b style={{ fontSize: 11 }}>{i.port.name}</b>
        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.far}</div>
        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.ip}</div>
      </div>
    );
  };
  const list = infos.filter((i) => showEmpty || i.kind !== "empty");

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", background: v("bg"), padding: 14, fontSize: 12.5 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label>Switch{" "}
          <select style={inp} value={dev.id} onChange={(e) => choose(+e.target.value)}>
            {switches.map((s) => <option key={s.id} value={s.id}>{s.name}{s.ip ? ` (${s.ip})` : ""}</option>)}
          </select>
        </label>
        <span style={{ opacity: 0.7 }}>{dev.model || dev.type}{dev.ip ? ` | ${dev.ip}` : ""} | {used} of {infos.length} ports in use</span>
      </div>
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 10 }}>
          <div style={{ opacity: 0.55, marginBottom: 3 }}>{g.label}</div>
          <div style={{ background: v("panel"), border: `1px solid ${v("border-subtle")}`, borderRadius: 6, padding: 8, display: "inline-flex", flexDirection: "column", gap: 4, maxWidth: "100%", overflowX: "auto" }}>
            {g.rows.map((r, k) => <div key={k} style={{ display: "flex", gap: 4 }}>{r.map(cell)}</div>)}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "6px 0 14px", fontSize: 11.5 }}>
        {legend.map((k) => <span key={k}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: k === "empty" ? EMPTY_COLOR : k === "infra" ? INFRA_COLOR : KIND_COLOR[k], marginRight: 4, border: `1px solid ${v("edge")}` }} />{k === "empty" ? "Empty" : k === "infra" ? "Network device" : KIND_LABEL[k][0]}</span>)}
      </div>
      <label style={{ display: "block", marginBottom: 6 }}><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Show empty ports</label>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr style={{ textAlign: "left", background: v("panel") }}>{["Port", "Connected to", "Type", "IP", "MAC"].map((h) => <th key={h} style={{ padding: "5px 8px", borderBottom: `1px solid ${v("border-subtle")}` }}>{h}</th>)}</tr></thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.port.id} onDoubleClick={() => i.farDevId != null && onOpen?.({ kind: "dev", id: i.farDevId })} onClick={() => i.farDevId != null && onSelect({ kind: "dev", id: i.farDevId })} style={{ cursor: i.farDevId != null ? "pointer" : "default", borderBottom: `1px solid ${v("panel-2")}` }}>
              <td style={{ padding: "4px 8px" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: colorOf(i), marginRight: 6 }} />{i.port.name} <span style={{ opacity: 0.5 }}>{i.port.type}</span></td>
              <td style={{ padding: "4px 8px" }}>{i.far || <span style={{ opacity: 0.4 }}>empty</span>}{i.farPort && <span style={{ opacity: 0.55 }}> ({i.farPort})</span>}</td>
              <td style={{ padding: "4px 8px" }}>{i.kind === "empty" ? "" : i.type || kindText(i)}</td>
              <td style={{ padding: "4px 8px" }}>{i.ip}</td>
              <td style={{ padding: "4px 8px", fontFamily: "Consolas, monospace" }}>{i.mac}</td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={5} style={{ padding: 10, opacity: 0.6 }}>Nothing is plugged into this switch.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
