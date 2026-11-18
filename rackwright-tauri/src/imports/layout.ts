// Rack layout list reader: one line per device, top of the rack first. Also reads the old "Import list" syntax.
import { catalogFind, smartTemplate } from "../edit";
import { guessType, type ImpFace, type ImportDevice, type ImportSpec } from "./spec";

const BULLET = /^\s*(?:[-*•]|\d+\.)\s+/;
const HEIGHT_PAREN = /\(\s*(\d+)\s*U\s*\)/i;
const HEIGHT_TOKEN = /(?:^|\s)(\d+)\s*U(?=\s|$)/i;

/** Height from the catalog when the name matches a template, else a type default. */
export function guessHeight(name: string): { height: number; guessed: boolean } {
  const t = catalogFind(name);
  if (t) return { height: t.u_size, guessed: false };
  const n = name.toLowerCase();
  if (/\bups\b|battery pack|smart-?ups/.test(n)) return { height: 2, guessed: true };
  if (/server|hypervisor|esxi?|proliant|poweredge|\bhv\d*\b/.test(n)) return { height: 2, guessed: true };
  if (/storage|\bnas\b|\bsan\b/.test(n)) return { height: 2, guessed: true };
  return { height: 1, guessed: true };
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const EMPTY_KEY = new Set(["empty", "open", "free", "spare", "vacant"]);
const EMPTY_FILL = new Set(["rack", "u", "unit", "units", "space", "blank"]);
/** An empty slot is the keyword alone (with an optional height), or "N U ... EMPTY SPACE" with only filler words. */
function emptyHeight(s: string): number | null {
  let m = /^(open|empty|free|spare|vacant|available)(?:\s*[-–]?\s*(?:\(\s*(\d+)\s*U\s*\)|(\d+)\s*U))?$/i.exec(s);
  if (m) return +(m[2] || m[3] || 1);
  m = /^(\d+)\s*U\b(.*)$/i.exec(s);
  if (!m) return null;
  const rest = m[2].toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const keyed = rest.some((w) => EMPTY_KEY.has(w)) || (rest.includes("blank") && rest.includes("space"));
  return keyed && rest.every((w) => EMPTY_KEY.has(w) || EMPTY_FILL.has(w)) ? +m[1] : null;
}

function deviceFrom(raw: string, line: number, face: ImpFace, group: string | undefined, rack?: string): ImportDevice {
  let text = raw.trim();
  let height: number | null = null;
  const hm = HEIGHT_PAREN.exec(text) || HEIGHT_TOKEN.exec(text);
  if (hm) {
    height = +hm[1];
    text = (text.slice(0, hm.index) + " " + text.slice(hm.index + hm[0].length)).replace(/\s+/g, " ").trim();
  }
  let notes = "";
  const unpunct = text.replace(/[.,;:!]+$/, "");
  if (unpunct.endsWith(")")) text = unpunct; // "Name (note)." -> "Name (note)"
  const nm = /\s*\(([^)]*)\)\s*$/.exec(text);
  if (nm) { notes = nm[1].trim(); text = text.slice(0, nm.index); }
  const name = text.replace(/^[-–—:\s]+|[-–—:\s]+$/g, "");
  let f = face;
  const tl = name.toLowerCase();
  if (/\b(rear|back)\b/.test(tl)) f = "rear"; else if (tl.includes("full depth")) f = "both";
  let guessed = false;
  if (height == null) { const g = guessHeight(name); height = g.height; guessed = g.guessed; }
  const tpl = smartTemplate(name, height);
  const found = catalogFind(name);
  const type = tpl.type !== "Other" ? tpl.type : guessType(name) ?? "Other";
  const d: ImportDevice = {
    kind: "device", line, name, type, rack, u: null, height, face: f, fields: {}, ports: null, specs: {}, services: [],
  };
  if (guessed) d.heightGuessed = true;
  if (group) d.group = group;
  if (found?.model) { d.fields.model = found.model; d.modelGuessed = true; }
  if (notes) d.fields.notes = notes;
  return d;
}

export function parseLayout(text: string): ImportSpec {
  const spec: ImportSpec = { kind: "layout", racks: [], devices: [], links: [], notes: [], warnings: [] };
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const meaningful = lines.map((l, i) => ({ s: l.trim(), i: i + 1 })).filter((x) => x.s && !x.s.startsWith("#") && !x.s.startsWith("//"));
  let face: ImpFace = "front";
  let group: string | undefined;
  let rack: string | undefined;
  meaningful.forEach(({ s, i }, idx) => {
    const bulleted = BULLET.test(s);
    const t = s.replace(BULLET, "").trim();
    const sect = /^\[(.*)\]$/.exec(t);
    if (sect) {
      const w = sect[1].toLowerCase();
      face = /back|rear/.test(w) ? "rear" : /full/.test(w) && /width|depth/.test(w) ? "both" : /front/.test(w) ? "front" : face;
      group = undefined;
      return;
    }
    const grp = /^\((.+)\)$/.exec(t);
    if (grp) { group = grp[1].trim(); return; }
    const eh = emptyHeight(t);
    if (eh != null) {
      group = undefined;
      spec.devices.push({ kind: "empty", line: i, name: "Empty", type: null, rack, u: null, height: eh, face, fields: {}, ports: null, specs: {}, services: [] });
      return;
    }
    // Old syntax: an unbulleted line with no height, followed by a bulleted "(nU)" line, names a rack.
    const next = meaningful[idx + 1]?.s;
    if (!bulleted && !HEIGHT_PAREN.test(t) && next && BULLET.test(next) && HEIGHT_PAREN.test(next)) {
      rack = t.replace(/^[-:* ]+|[-:* ]+$/g, "");
      spec.racks.push({ name: rack, u: null });
      return;
    }
    const wc = words(t);
    if (!t.includes("|") && (wc >= 9 || (t.endsWith(".") && wc >= 6))) {
      group = undefined;
      spec.devices.push({ kind: "note", line: i, name: t, type: null, rack: undefined, u: null, height: 0, face, fields: {}, ports: null, specs: {}, services: [] });
      return;
    }
    const all = t.split("|").map((h) => h.trim()).filter(Boolean);
    if (all.length > 3) spec.warnings.push(`Line ${i}: only the first 3 items on a line are used.`);
    const halves = all.slice(0, 3);
    halves.forEach((h, k) => {
      const d = deviceFrom(h, i, face, group, rack);
      if (halves.length > 1) { d.cols = halves.length; d.side = k; }
      spec.devices.push(d);
    });
  });
  return spec;
}

/** Fills each device's and empty slot's lowest U, top line at the top of a rackU rack. Returns the U the list needs. */
export function placeLayout(spec: ImportSpec, rackU: number): number {
  const racks = new Map<string | undefined, Map<number, ImportDevice[]>>();
  for (const d of spec.devices) {
    if (d.kind === "note") continue;
    const rows = racks.get(d.rack as string | undefined) || new Map<number, ImportDevice[]>();
    rows.set(d.line, [...(rows.get(d.line) || []), d]);
    racks.set(d.rack as string | undefined, rows);
  }
  let most = 0;
  for (const byLine of racks.values()) {
    let top = rackU, used = 0;
    for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
      const row = byLine.get(line)!;
      const h = Math.max(...row.map((d) => d.height ?? 1));
      for (const d of row) d.u = top - h + 1;
      top -= h; used += h;
    }
    most = Math.max(most, used);
  }
  return most;
}

/** Change a layout row's kind: a new Device gets a name and a height of at least 1 U; an Empty keeps its height; a Note has none. */
export function switchKind(d: ImportDevice, kind: "device" | "empty" | "note"): ImportDevice {
  const was = d.kind ?? "device";
  if (was === kind) return d;
  if (kind === "note") return { ...d, kind, height: 0, heightGuessed: undefined };
  const height = Math.max(1, d.height ?? 1);
  if (kind === "empty") return { ...d, kind, height };
  const name = was === "note" ? d.name : !d.name || d.name === "Empty" ? "New device" : d.name;
  return { ...d, kind, name: name || "New device", height };
}

export type SideChoice = "full" | "left" | "middle" | "right";
/** The side selector's value for a device: derived from its cols and side. */
export function sideChoice(d: Pick<ImportDevice, "cols" | "side">): SideChoice {
  if (!d.cols || d.cols < 2) return "full";
  if (d.cols >= 3 && d.side === 1) return "middle";
  return (d.side ?? 0) === 0 ? "left" : "right";
}
/** What choosing a side does to a device: Full width = no columns, Left / Right = two columns. */
export function sidePatch(c: SideChoice): { cols: number | undefined; side: number } {
  if (c === "left") return { cols: 2, side: 0 };
  if (c === "right") return { cols: 2, side: 1 };
  if (c === "middle") return { cols: 3, side: 1 };
  return { cols: undefined, side: 0 };
}
