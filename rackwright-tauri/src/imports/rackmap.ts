// RackMap text format reader. Ported from RackMap parseRackText.
import { devFrom, nk, parseUSpan, parseWidth, typeWord } from "./spec";
import type { ImportDevice, ImportLink, ImportRack, ImportSpec } from "./spec";

interface Tok { k?: string; v: string }
function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /([A-Za-z_][\w.\-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))|"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) out.push({ k: m[1], v: m[2] ?? m[3] ?? m[4] ?? "" });
    else out.push({ v: m[5] ?? m[6] ?? m[7] ?? "" });
  }
  return out;
}
const split = (t: Tok[]) => {
  const pos: string[] = [], kv: [string, string][] = [];
  t.forEach((x) => (x.k ? kv.push([x.k, x.v]) : pos.push(x.v)));
  return { pos, kv };
};

function endpoint(str: string) {
  const { pos, kv } = split(tokens(str));
  let dev = "", port = "";
  if (pos[0] && pos[0].includes(":")) {
    const i = pos[0].indexOf(":");
    dev = pos[0].slice(0, i);
    port = [pos[0].slice(i + 1), ...pos.slice(1)].join(" ").trim();
  } else {
    dev = pos[0] || "";
    port = pos.slice(1).join(" ").replace(/^(port|interface|int)\s+/i, "");
  }
  return { dev: dev.trim(), port: port.trim(), kv };
}

export function parseRackmapText(text: string): ImportSpec & { ratio: number } {
  const spec: ImportSpec = { kind: "rackmap", racks: [], devices: [], links: [], notes: [], warnings: [] };
  let cur: string | null = null, rec = 0, total = 0;
  String(text).replace(/^﻿/, "").split(/\r?\n/).forEach((raw, ln) => {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!line || /^(#|\/\/|;)/.test(line)) return;
    total++;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^rack\b\s*[:=]?\s*(.+)$/i))) {
      const r: ImportRack = { name: "", u: null };
      let location = "";
      tokens(m[1].replace(/[()]/g, " ")).forEach((x) => {
        if (x.k) {
          const k = nk(x.k);
          if (k === "u" || k === "height" || k === "size" || k === "units") r.u = parseInt(x.v) || null;
          else if (k === "location" || k === "row") location = x.v;
          else if (k === "circuit" || k === "power") r.circuit = x.v;
          else r.notes = (r.notes ? r.notes + "; " : "") + x.k + ": " + x.v;
        } else if (/^\d{1,2}\s*u$/i.test(x.v) || (/^\d{1,2}$/.test(x.v) && r.name)) r.u = parseInt(x.v);
        else if (!r.name) r.name = x.v;
        else location = (location ? location + " " : "") + x.v;
      });
      if (location) r.notes = (r.notes ? r.notes + "; " : "") + "Location: " + location;
      if (r.name) { spec.racks.push(r); cur = r.name; rec++; }
      return;
    }
    const linkKw = line.match(/^(?:link|cable|conn(?:ect(?:ion)?)?|wire)\b\s*:?\s*(.+)$/i);
    const body = linkKw ? linkKw[1] : /^\S+:\S+.*?\s*(?:<->|<-->|-->|->|→|↔|<=>|=>)\s*\S+/.test(line) ? line : null;
    if (body) {
      const parts = body.split(/\s*(?:<-->|<->|-->|->|<=>|=>|→|↔)\s*|\s+to\s+/i);
      if (parts.length >= 2) {
        const A = endpoint(parts[0]), B = endpoint(parts.slice(1).join(" -> "));
        if (A.dev && B.dev) {
          const kv = Object.fromEntries([...A.kv, ...B.kv].map(([k, v]) => [nk(k), v]));
          const l: ImportLink = { a: A.dev, ap: A.port, b: B.dev, bp: B.port };
          const type = kv.cable || kv.type || kv.media, label = kv.label || kv.id || kv.tag, length = kv.length || kv.len, color = kv.color || kv.colour;
          if (type) l.type = type;
          if (label) l.label = label;
          if (length) l.length = length;
          if (color) l.color = color;
          spec.links.push(l); rec++;
          return;
        }
      }
    }
    if ((m = line.match(/^(u\s*\d{1,2}(?:\s*(?:-|–|to)\s*u?\s*\d{1,2})?)\s+(.+)$/i))) {
      const sp = parseUSpan(m[1])!;
      const { pos, kv } = split(tokens(m[2]));
      let type: string | null = null;
      if (pos.length > 1 && typeWord(pos[0])) type = typeWord(pos.shift()!);
      const name = pos.shift() || "";
      let height: number | null = sp.height > 1 ? sp.height : null;
      const rest: string[] = [];
      let width: number | null = null;
      pos.forEach((p) => {
        const hm = p.match(/^(\d{1,2})\s*u$/i);
        const wm = /^(half|third|1\/2|1\/3|½|⅓)(-?width)?$/i.test(p) ? parseWidth(p.replace(/-?width$/i, "")) : null;
        if (hm) height = +hm[1]; else if (wm) width = wm; else rest.push(p);
      });
      if (!name) { spec.warnings.push(`Line ${ln + 1}: no name — skipped`); return; }
      const d = devFrom(kv, { line: ln + 1, name, type, rack: cur ?? undefined, u: sp.u, height });
      if (width && !d.cols) { d.cols = width; d.side = 0; }
      if (rest.length && !d.fields.role) d.fields.role = rest.join(" ");
      if (!kv.some(([k]) => nk(k) === "rack")) d.rack = cur ?? undefined;
      spec.devices.push(d); rec++;
      return;
    }
    if ((m = line.match(/^(?:unracked|device|floor|wall|equipment)\b\s*:?\s*(.+)$/i))) {
      const { pos, kv } = split(tokens(m[1]));
      let type: string | null = null;
      if (pos.length > 1 && typeWord(pos[0])) type = typeWord(pos.shift()!);
      const name = pos.shift();
      if (!name) return;
      const d: ImportDevice = devFrom(kv, { line: ln + 1, name, type, rack: null });
      if (pos.length && !d.fields.role) d.fields.role = pos.join(" ");
      spec.devices.push(d); rec++;
      return;
    }
    if (spec.warnings.length < 40) spec.warnings.push(`Line ${ln + 1} not understood: “${line.length > 70 ? line.slice(0, 70) + "…" : line}”`);
  });
  return { ...spec, ratio: total ? rec / total : 0 };
}
