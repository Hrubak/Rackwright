import { v } from "../theme";

export type BannerKind = "reload" | "admin" | "desktop";

const btn = { background: v("panel-2"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 10px", fontSize: 12, cursor: "pointer", marginLeft: 8 } as const;

export function UpdateBanner({ kind, text, primary, secondary, onPrimary, onSecondary, onClose }: {
  kind: BannerKind; text: string; primary: string; secondary?: string;
  onPrimary: () => void; onSecondary?: () => void; onClose?: () => void;
}) {
  return (
    <div role="status" data-kind={kind} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, padding: "6px 12px", fontSize: 13, background: v("accent-soft"), color: v("text"), borderBottom: `1px solid ${v("accent-border")}` }}>
      <span>{text}</span>
      <button style={{ ...btn, background: v("accent"), color: v("on-accent"), borderColor: v("accent") }} onClick={onPrimary}>{primary}</button>
      {secondary && onSecondary && <button style={btn} onClick={onSecondary}>{secondary}</button>}
      {onClose && <button style={{ ...btn, marginLeft: "auto", background: "transparent", border: "none" }} aria-label="Close" title="Close" onClick={onClose}>{"×"}</button>}
    </div>
  );
}
