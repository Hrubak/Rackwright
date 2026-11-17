// Endpoint kinds shared by the Infrastructure, Switch and Endpoints views.
export type EpKind = "pc" | "phone" | "iot" | "printer" | "vm" | "other";
export const EP_KINDS: EpKind[] = ["pc", "phone", "iot", "printer", "vm", "other"];
export const KIND_LABEL: Record<EpKind, [string, string]> = {
  pc: ["PC", "PCs"], phone: ["phone", "phones"], iot: ["IoT device", "IoT devices"],
  printer: ["printer", "printers"], vm: ["VM", "VMs"], other: ["other", "others"],
};
export const KIND_COLOR: Record<EpKind, string> = {
  pc: "#4f8fdf", phone: "#3fb68b", iot: "#d9a441", printer: "#b07cd8", vm: "#5fc3d4", other: "#8b93a0", // theme-ok
};
export const INFRA_COLOR = "#e0735c"; // theme-ok
export const EMPTY_COLOR = "#2a2d33"; // theme-ok

/** Kind from an explicit field, else guessed from the type / model text (older imports have no kind). */
export function kindOf(ep: { kind?: string; type?: string; model?: string; name?: string }): EpKind {
  const k = (ep.kind || "").toLowerCase();
  if ((EP_KINDS as string[]).includes(k)) return k as EpKind;
  const t = `${ep.type || ""} ${ep.model || ""}`.toLowerCase();
  if (/phone|voip|handset|softphone|yealink|polycom|grandstream|mitel|fanvil|snom|avaya/.test(t)) return "phone";
  if (/printer|\bmfp\b|copier|plotter/.test(t)) return "printer";
  if (/\bvm\b|virtual/.test(t)) return "vm";
  if (/camera|iot|sensor|thermostat|\btv\b|speaker|badge|doorbell|\bhvac\b/.test(t)) return "iot";
  if (/\bpc\b|computer|laptop|workstation|desktop|notebook|windows|macbook|imac|thin ?client/.test(t)) return "pc";
  return "other";
}

/** "23 phones, 3 PCs, 2 others", most common first. `max` kinds are named, the rest become an ellipsis. */
export function kindCounts(eps: { kind?: string; type?: string; model?: string }[], max = 3): string {
  const n = new Map<EpKind, number>();
  for (const e of eps) { const k = kindOf(e); n.set(k, (n.get(k) || 0) + 1); }
  const list = [...n.entries()].sort((a, b) => b[1] - a[1] || EP_KINDS.indexOf(a[0]) - EP_KINDS.indexOf(b[0]));
  const txt = list.slice(0, max).map(([k, c]) => `${c} ${KIND_LABEL[k][c === 1 ? 0 : 1]}`).join(", ");
  return list.length > max ? txt + "…" : txt;
}
