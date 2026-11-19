// The Import from Auvik device table: sort, filter, ticks. Pure; no backend.ts import.
import type { Kind, Mode } from "../plan";
import { typeOptions } from "../../deviceTypes";
import { TO_PLACE_KINDS, VM_MODELS, type VmVendor } from "./map";

export type SortCol = "name" | "kind" | "type" | "model" | "template" | "u" | "rack" | "ip" | "status";
export type Sort = { col: SortCol; dir: 1 | -1 } | null;

/** One table row, as display strings. `id` is the tick id (Auvik id), `key` the plan item key. */
export interface Row { key: string; id: string; name: string; kind: string; type: string; model: string; template: string; u: string; rack: string; dest: string; ip: string; status: string }

/** Numbers in order (EX-SW2 before EX-SW10), case ignored. */
export const natCmp = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const octets = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  return m ? m.slice(1).map(Number) : null;
};
/** IPv4 numerically by octets; other text after IPv4 (natural order); empty last. */
export function ipCmp(a: string, b: string): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const x = octets(a), y = octets(b);
  if (x && y) { for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }
  if (x || y) return x ? -1 : 1;
  return natCmp(a, b);
}

const numCmp = (a: string, b: string) => Number(a) - Number(b);

/** Sorted copy. Stable: equal rows keep their input (Auvik) order in both directions. Empty values stay last. null = input order. */
export function sortRows(rows: Row[], s: Sort): Row[] {
  if (!s) return [...rows];
  const cmp = s.col === "ip" ? ipCmp : s.col === "u" ? numCmp : natCmp;
  return rows.map((r, i) => ({ r, i })).sort((p, q) => {
    const a = p.r[s.col], b = q.r[s.col];
    if (!a || !b) { if (a || b) return a ? -1 : 1; return p.i - q.i; }
    return cmp(a, b) * s.dir || p.i - q.i;
  }).map((x) => x.r);
}

/** Rows whose name, kind, type, model, rack, IP or status holds the text (trimmed, case ignored). */
export function filterRows(rows: Row[], q: string): Row[] {
  const n = q.trim().toLowerCase();
  if (!n) return rows;
  return rows.filter((r) => [r.name, r.kind, r.type, r.model, r.rack, r.ip, r.status].some((x) => x.toLowerCase().includes(n)));
}

/** Ticks (on) or unticks the visible rows; the rest are left as they are. Returns a new set of unticked ids. */
export function setTicked(excluded: Set<string>, visibleIds: string[], on: boolean): Set<string> {
  const out = new Set(excluded);
  for (const id of visibleIds) if (on) out.delete(id); else out.add(id);
  return out;
}

/** The Import header box: every visible row ticked, none, or some. */
export function headState(excluded: Set<string>, visibleIds: string[]): "all" | "none" | "some" {
  const on = visibleIds.filter((id) => !excluded.has(id)).length;
  return on === 0 ? "none" : on === visibleIds.length ? "all" : "some";
}

/** Sets a pick, or removes it when it is the computed default, so a default is never saved as a hand edit. */
export function setPick<T>(rec: Record<string, T>, key: string, value: T, dflt: T): Record<string, T> {
  const out = { ...rec };
  if (value === dflt) delete out[key]; else out[key] = value;
  return out;
}

/** The small text under the rack name: where in the document the row goes. */
export function destOf(mode: Mode, kind: Kind): string {
  if (mode === "vm") return "VM box";
  if (mode === "endpoint" || mode === "phone" || mode === "iot") return "Endpoints";
  if (mode === "skip") return "";
  return TO_PLACE_KINDS.includes(kind) ? "To place" : "Inventory";
}

/** A device row's Type choices: the app's types without the box types (Endpoints, Virtual machines), which belong to
 *  box members. A current value is always kept. */
export function deviceRowTypes(current: string): string[] {
  return typeOptions(current).filter((t) => t === current || (t !== "Endpoints" && t !== "Virtual machines"));
}

/** The text of a Model dropdown value: Auvik's text (""), a catalog name ("tpl:") or a Virtual Machine model ("vm:"). */
export function modelLabel(choice: string, auvik: string): string {
  if (choice.startsWith("tpl:")) return choice.slice(4);
  if (choice.startsWith("vm:")) return VM_MODELS[choice.slice(3) as VmVendor] ?? auvik;
  return auvik;
}
