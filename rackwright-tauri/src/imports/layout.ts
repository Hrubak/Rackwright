// Rack layout list reader: one line per device, top of the rack first. Also reads the old "Import list" syntax.
import { catalogFind, smartTemplate } from "../edit";
import { guessType, type ImpFace, type ImportDevice, type ImportSpec } from "./spec";

const BULLET = /^\s*(?:[-*•]|\d+\.)\s+/;
const HEIGHT_PAREN = /\(\s*(\d+)\s*U\s*\)/i;
const HEIGHT_TOKEN = /(?:^|\s)(\d+)\s*U(?=\s|$)/i;
const EMPTY_WORD = /^(open|empty|free|spare|vacant|available)\b/i;

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

function emptyHeight(s: string): number | null {
  let m = /^(\d+)\s*U\b.*\b(empty|open|free|spare|blank space|vacant)/i.exec(s);
  if (m) return +m[1];
  if (!EMPTY_WORD.test(s)) return null;
  m = HEIGHT_PAREN.exec(s) || HEIGHT_TOKEN.exec(s);
  return m ? +m[1] : 1;
}

function deviceFrom(raw: string, line: number, face: ImpFace, group: string | undefined): ImportDevice {
  let text = raw.trim();
  let height: number | null = null;
  const hm = HEIGHT_PAREN.exec(text) || HEIGHT_TOKEN.exec(text);
  let tail = "";
  if (hm) {
    height = +hm[1];
    tail = text.slice(hm.index + hm[0].length);
    text = text.slice(0, hm.index);
  }
  let notes = "";
  const nm = /\s*\(([^)]*)\)\s*$/.exec(text);
  if (nm) { notes = nm[1].trim(); text = text.slice(0, nm.index); }
  const name = text.replace(/^[-–—:\s]+|[-–—:\s]+$/g, "");
  let f = face;
  const tl = (tail + " " + name).toLowerCase();
  if (/\b(rear|back)\b/.test(tl)) f = "rear"; else if (tl.includes("full depth")) f = "both";
  let guessed = false;
  if (height == null) { const g = guessHeight(name); height = g.height; guessed = g.guessed; }
  const tpl = smartTemplate(name, height);
  const found = catalogFind(name);
  const type = tpl.type !== "Other" ? tpl.type : guessType(name) ?? "Other";
  const d: ImportDevice = {
    kind: "device", line, name, type, rack: undefined, u: null, height, face: f, fields: {}, ports: null, specs: {}, services: [],
  };
  if (guessed) d.heightGuessed = true;
  if (group) d.group = group;
  if (found?.model) d.fields.model = found.model;
  if (notes) d.fields.notes = notes;
  return d;
}

export function parseLayout(text: string): ImportSpec {
  const spec: ImportSpec = { kind: "layout", racks: [], devices: [], links: [], notes: [], warnings: [] };
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const meaningful = lines.map((l, i) => ({ s: l.trim(), i: i + 1 })).filter((x) => x.s && !x.s.startsWith("#") && !x.s.startsWith("//"));
  let face: ImpFace = "front";
  let group: string | undefined;
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
      spec.devices.push({ kind: "empty", line: i, name: "Empty", type: null, rack: undefined, u: null, height: eh, face, fields: {}, ports: null, specs: {}, services: [] });
      return;
    }
    // Old syntax: an unbulleted line with no height, followed by a bulleted "(nU)" line, names a rack.
    const next = meaningful[idx + 1]?.s;
    if (!bulleted && !HEIGHT_PAREN.test(t) && next && BULLET.test(next) && HEIGHT_PAREN.test(next)) {
      spec.racks.push({ name: t.replace(/^[-:* ]+|[-:* ]+$/g, ""), u: null });
      return;
    }
    const wc = words(t);
    if (wc >= 9 || (t.endsWith(".") && wc >= 6)) {
      spec.devices.push({ kind: "note", line: i, name: t, type: null, rack: undefined, u: null, height: 0, face, fields: {}, ports: null, specs: {}, services: [] });
      return;
    }
    const halves = t.split(/\s+\|\s+/).map((h) => h.trim()).filter(Boolean).slice(0, 2);
    halves.forEach((h, k) => {
      const d = deviceFrom(h, i, face, group);
      if (halves.length === 2) { d.cols = 2; d.side = k; }
      spec.devices.push(d);
    });
  });
  return spec;
}

/** Fills each device's and empty slot's lowest U, top line at the top of a rackU rack. Returns the U the list needs. */
export function placeLayout(spec: ImportSpec, rackU: number): number {
  const byLine = new Map<number, ImportDevice[]>();
  for (const d of spec.devices) {
    if (d.kind === "note") continue;
    byLine.set(d.line, [...(byLine.get(d.line) || []), d]);
  }
  let top = rackU, used = 0;
  for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
    const row = byLine.get(line)!;
    const h = Math.max(...row.map((d) => d.height ?? 1));
    for (const d of row) d.u = top - h + 1;
    top -= h; used += h;
  }
  return used;
}
