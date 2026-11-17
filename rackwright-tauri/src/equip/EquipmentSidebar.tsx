import { useMemo, useState, type MouseEvent } from "react";
import { v } from "../theme";
import { CHIPS, groupCatalog, type Chip } from "./group";
import type { Tpl } from "../edit";

const OPEN_KEY = "rw.equipOpen";
const readOpen = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") || {}; } catch { return {}; }
};

interface Props {
  list: Tpl[];
  fitsOnly: boolean;
  onFits: (b: boolean) => void;
  onDragStart: (e: MouseEvent, i: number) => void;
  onAdd: (i: number) => void;
  statusOf: (c: Tpl) => string;
  icon: (i: number) => string;
  widthLabel: (c: Tpl) => string;
  selected: number | null;
  collapsed: boolean;
  onCollapse: (b: boolean) => void;
}

export default function EquipmentSidebar(p: Props) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"catalog" | "generic">("catalog");
  const [chip, setChip] = useState<Chip>("all");
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const searching = q.trim() !== "";

  const groups = useMemo(() => groupCatalog(p.list, q, chip, tab)
    .map((g) => ({ ...g, items: p.fitsOnly ? g.items.filter(({ c }) => p.statusOf(c) !== "full") : g.items }))
    .filter((g) => g.items.length), [p.list, q, chip, tab, p.fitsOnly, p.statusOf]);

  const toggle = (g: string, isOpen: boolean) => {
    const n = { ...open, [g]: !isOpen };
    setOpen(n);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* ignore */ }
  };

  if (p.collapsed) {
    return (
      <div style={{ width: 28, background: v("panel"), borderRight: `1px solid ${v("border-subtle")}`, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
        <button title="Show equipment" aria-label="Show equipment" onClick={() => p.onCollapse(false)}
          style={{ background: "none", border: "none", color: v("text"), cursor: "pointer", fontSize: 16 }}>{"»"}</button>
        <div style={{ writingMode: "vertical-rl", marginTop: 10, color: v("text-dim"), fontSize: 12 }}>Equipment</div>
      </div>
    );
  }

  const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px" } as const;
  const pill = (on: boolean) => ({
    background: on ? v("accent") : v("control"), color: on ? v("on-accent") : v("text"),
    border: `1px solid ${on ? v("accent") : v("border")}`, borderRadius: 10, padding: "1px 8px", fontSize: 11, cursor: "pointer",
  }) as const;

  return (
    <div style={{ width: 270, background: v("panel"), borderRight: `1px solid ${v("border-subtle")}`, display: "flex", flexDirection: "column", fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", margin: "8px 10px 0" }}>
        <b style={{ flex: 1, fontSize: 13 }}>Equipment</b>
        <button title="Hide equipment" aria-label="Hide equipment" onClick={() => p.onCollapse(true)}
          style={{ background: "none", border: "none", color: v("text"), cursor: "pointer", fontSize: 16 }}>{"«"}</button>
      </div>
      <input style={{ ...inp, margin: "8px 10px" }} placeholder="Search (dell r650, ups, 48...)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ display: "flex", gap: 6, margin: "0 10px 8px", alignItems: "center" }}>
        <button style={pill(tab === "catalog")} onClick={() => setTab("catalog")}>Catalog</button>
        <button style={pill(tab === "generic")} onClick={() => setTab("generic")}>Generic</button>
        <span style={{ flex: 1 }} />
        <label title="Hide items with no free slot in the selected rack"><input type="checkbox" checked={p.fitsOnly} onChange={(e) => p.onFits(e.target.checked)} /> fits</label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "0 10px 8px" }}>
        {CHIPS.map((c) => <button key={c.id} style={pill(chip === c.id)} onClick={() => setChip(c.id)}>{c.label}</button>)}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {groups.map((g) => {
          const isOpen = searching || !!open[g.group];
          return (
            <div key={g.group}>
              <div onClick={() => toggle(g.group, isOpen)} role="button" aria-expanded={isOpen}
                style={{ padding: "5px 10px", cursor: "pointer", background: v("panel-2"), borderBottom: `1px solid ${v("border-subtle")}`, display: "flex", gap: 6 }}>
                <span style={{ width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                <b style={{ flex: 1 }}>{g.group}</b>
                <span style={{ color: v("text-dim") }}>{g.items.length}</span>
              </div>
              {isOpen && g.items.map(({ c, i }) => {
                const st = p.statusOf(c);
                return (
                  <div className="cat" key={i} onMouseDown={(e) => p.onDragStart(e, i)} onDoubleClick={() => p.onAdd(i)}
                    title="Drag into the rack, or double-click to add"
                    style={{ padding: "6px 10px 6px 24px", borderBottom: `1px solid ${v("panel-2")}`, cursor: "grab", background: p.selected === i ? v("accent-soft") : undefined, opacity: st === "full" ? 0.5 : 1 }}>
                    <span style={{ opacity: 0.6, marginRight: 6 }}>{p.icon(i)}</span>{c.name}{" "}
                    <span style={{ color: v("text-dim") }}>{c.u_size}U {c.type}{p.widthLabel(c)}</span>
                    {st === "off" && <span style={{ color: v("warn") }}> off-rack</span>}
                    {st === "full" && <span style={{ color: v("danger") }}> no room</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!groups.length && <div style={{ padding: 10, opacity: 0.6 }}>Nothing matches.</div>}
      </div>
      <div style={{ padding: "8px 10px", color: v("text-dim"), borderTop: `1px solid ${v("border-subtle")}` }}>Drag onto a rack, or double-click to add</div>
    </div>
  );
}
