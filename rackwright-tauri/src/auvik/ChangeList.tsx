import { v } from "../theme";
import { Cat, Change } from "./diff";

const SECTIONS: { cats: Cat[]; title: string; hint?: string }[] = [
  { cats: ["new"], title: "New devices", hint: "Will be added." },
  { cats: ["field"], title: "Changed fields", hint: "Fields you edited by hand are kept. Tick one to take the Auvik value." },
  { cats: ["newCable"], title: "New connections", hint: "Cables to add." },
  { cats: ["moved"], title: "Moved connections", hint: "The old cable is replaced by one on the new port." },
  { cats: ["gone"], title: "Connections Auvik no longer lists", hint: "Tick to remove the cable. Cables you drew by hand are never listed." },
  { cats: ["missingDev", "missingMember"], title: "Missing from this export", hint: "Kept unless you tick them. Tick to remove." },
];

export function ChangesList({ changes, isOn, setOn }: { changes: Change[]; isOn: (c: Change) => boolean; setOn: (ids: string[], v: boolean) => void }) {
  if (!changes.length) return <div style={{ padding: 12, opacity: 0.8 }}>Nothing changed. The rack already matches this export.</div>;
  return (
    <div style={{ overflow: "auto", border: `1px solid ${v("border-subtle")}`, borderRadius: 4, flex: 1, minHeight: 200 }}>
      {SECTIONS.map((sec) => {
        const list = changes.filter((c) => sec.cats.includes(c.cat));
        if (!list.length) return null;
        const ids = list.map((c) => c.id);
        return (
          <div key={sec.title} style={{ padding: "6px 8px", borderBottom: `1px solid ${v("border-faint")}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <b>{sec.title} ({list.length})</b>
              <span style={{ opacity: 0.65, flex: 1 }}>{sec.hint}</span>
              <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setOn(ids, true)}>Tick all</a>
              <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setOn(ids, false)}>Untick all</a>
            </div>
            {list.map((c) => (
              <label key={c.id} style={{ display: "flex", gap: 8, padding: "2px 0 2px 6px", alignItems: "baseline", opacity: c.locked && !isOn(c) ? 0.6 : 1 }}>
                <input type="checkbox" checked={isOn(c)} onChange={(e) => setOn([c.id], e.target.checked)} />
                <span><b>{c.title}</b>{c.detail ? <span style={{ opacity: 0.7 }}> {c.detail}</span> : null}
                  {c.from !== undefined || c.to !== undefined ? <span>: <span style={{ opacity: 0.7 }}>{c.from || "(empty)"}</span> {"->"} <span style={{ color: c.locked && !isOn(c) ? v("text-dim") : undefined }}>{c.to}</span></span> : null}
                  {c.locked && <span style={{ color: v("warn") }}> kept (you edited this)</span>}
                </span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
