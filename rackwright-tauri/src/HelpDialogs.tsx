import { useEffect, type ReactNode } from "react";
import { v } from "./theme";
import { btn } from "./web";
import { SHORTCUTS, type Cmd } from "./shortcuts";
import { IS_WEB } from "./backend";
import { latestEntries, changelogRaw } from "./changelog";

function Shell({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width: number }) {
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: v("panel"), padding: 16, borderRadius: 6, width, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 13 }}>
        <b style={{ fontSize: 14, display: "block", marginBottom: 10 }}>{title}</b>
        {children}
        <div style={{ textAlign: "right", marginTop: 14 }}><button style={{ ...btn, marginRight: 0 }} onClick={onClose} autoFocus>Close</button></div>
      </div>
    </div>
  );
}

const LABELS: Record<Cmd, string> = {
  new: "New rack", open: "Open", save: "Save", saveAs: "Save as", undo: "Undo", redo: "Redo",
  duplicate: "Duplicate the selected device", delete: "Delete the selection", fit: "Fit to screen", deselect: "Clear the selection",
};

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ...(Object.keys(LABELS) as Cmd[]).filter((c) => !(IS_WEB && c === "new")).map((c): [string, string] => [LABELS[c], SHORTCUTS[c]]),
    ["Move the selected device", "Arrow keys"],
  ];
  return (
    <Shell title="Keyboard shortcuts" onClose={onClose} width={360}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>
        {rows.map(([l, k]) => (
          <tr key={l}><td style={{ padding: "3px 0" }}>{l}</td><td style={{ padding: "3px 0", textAlign: "right", color: v("text-dim") }}>{k}</td></tr>
        ))}
      </tbody></table>
    </Shell>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/\*\*(.+?)\*\*/g).map((t, i) => (i % 2 ? <b key={i}>{t}</b> : t));
}

export function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  const entries = latestEntries(changelogRaw, 3);
  return (
    <Shell title="What's new" onClose={onClose} width={560}>
      {entries.map((en) => (
        <div key={en.heading} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{en.heading}</div>
          {en.lines.filter((l) => l.trim()).map((l, i) => {
            const m = /^(\s*)- (.*)$/.exec(l);
            return m
              ? <div key={i} style={{ paddingLeft: 12 + (m[1].length ? 16 : 0), textIndent: -10 }}>{"• "}{inline(m[2])}</div>
              : <p key={i} style={{ margin: "4px 0" }}>{inline(l.trim())}</p>;
          })}
        </div>
      ))}
    </Shell>
  );
}
