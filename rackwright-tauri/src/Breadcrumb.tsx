import { v } from "./theme";
import type { RackLocation } from "./location";

// Client and site shrink first (each down to ~3 characters); the rack name keeps priority.
const clip = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 24 } as const;
const link = { ...clip, flex: "0 1 auto", background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: v("link"), cursor: "pointer" } as const;
const sep = <span style={{ opacity: 0.5, margin: "0 6px", flex: "none" }}>{"›"}</span>;

export function Breadcrumb({ loc, rackName, dirty, onClient, onSite }: {
  loc: RackLocation | null | "unassigned"; rackName: string; dirty: boolean;
  onClient: (key: string) => void; onSite: (key: string, siteId: number) => void;
}) {
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", whiteSpace: "nowrap", fontSize: 13 }}>
      {loc === "unassigned" && <><span style={{ ...clip, flex: "0 1 auto", opacity: 0.7 }}>Unassigned</span>{sep}</>}
      {loc && loc !== "unassigned" && (
        <>
          <button style={link} onClick={() => onClient(loc.clientKey)} title={`Open ${loc.client}`}>{loc.client}</button>{sep}
          <button style={link} onClick={() => onSite(loc.clientKey, loc.siteId)} title={`Open ${loc.site}`}>{loc.site}</button>{sep}
        </>
      )}
      <b style={{ ...clip, flex: "0 0.2 auto" }} title={rackName}>{rackName}</b>
      {dirty && <span title="Unsaved changes" style={{ marginLeft: 6, flex: "none" }}>{"•"}</span>}
    </span>
  );
}
