// Marker replacement for the Word report template. Pure TypeScript: a tag-level scan of the
// part's XML, editing only <w:t> text and replaced paragraphs; every other byte is left alone.
import type { ReportModel } from "./model";

export type MarkerName = "CLIENT" | "SITE" | "DATE" | "REPORT_TITLE" | "PREPARED_FOR" | "PREPARED_BY" | "SUMMARY" | "RECOMMENDATIONS" | "RACKWRIGHT";
export type MarkerValues = Record<Exclude<MarkerName, "RACKWRIGHT">, string>;
export interface ReplaceResult { xml: string; rackwright: "alone" | "shared" | "missing" }

const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** XML-escape & < > " ' and drop characters XML 1.0 forbids. */
export function xmlText(s: string): string {
  return s.replace(BAD_XML, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11-18" -> "November 18, 2026"; anything else comes back unchanged. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || +m[2] < 1 || +m[2] > 12) return iso;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

export function markerValues(model: ReportModel): MarkerValues {
  return {
    CLIENT: model.client.name, SITE: model.sites.map((s) => s.name).join(", "), DATE: longDate(model.date),
    REPORT_TITLE: model.title, PREPARED_FOR: model.preparedFor, PREPARED_BY: model.preparedBy,
    SUMMARY: model.summary, RECOMMENDATIONS: model.recommendations,
  };
}

interface TEl { open: number; textStart: number; textEnd: number; close: number; attrs: string }
interface Para { start: number; end: number; ts: TEl[]; nested: number; fallback: boolean }
interface Scan { paras: Para[]; bodySect: number; bodyClose: number }

function scan(xml: string): Scan {
  const paras: Para[] = [];
  const stack: string[] = [];
  const pstack: Para[] = [];
  let bodySect = -1, bodyClose = -1;
  let openT: { open: number; textStart: number; attrs: string; para: Para } | null = null;
  for (const m of xml.matchAll(/<[^>]+>/g)) {
    const tag = m[0], at = m.index!, end = at + tag.length;
    if (tag[1] === "?" || tag[1] === "!") continue;
    if (tag[1] === "/") {
      const name = tag.slice(2, -1).trim();
      if (name === "w:t" && openT) { openT.para.ts.push({ open: openT.open, textStart: openT.textStart, textEnd: at, close: end, attrs: openT.attrs }); openT = null; }
      if (name === "w:p") { const q = pstack.pop(); if (q) q.end = end; }
      if (name === "w:body") bodyClose = at;
      stack.pop();
      continue;
    }
    const nm = /^<([^\s/>]+)([^>]*?)(\/?)>$/.exec(tag);
    if (!nm) continue;
    const [, name, attrs, selfClose] = nm;
    if (selfClose) continue;
    if (name === "w:sectPr" && stack[stack.length - 1] === "w:body") bodySect = at;
    if (name === "w:p") {
      const q: Para = { start: at, end, ts: [], nested: 0, fallback: stack.includes("mc:Fallback") };
      if (pstack.length) pstack[pstack.length - 1].nested++;
      paras.push(q); pstack.push(q);
    }
    if (name === "w:t" && pstack.length) openT = { open: at, textStart: end, attrs: attrs.replace(/\s+xml:space="[^"]*"/, ""), para: pstack[pstack.length - 1] };
    stack.push(name);
  }
  return { paras, bodySect, bodyClose };
}

const MARK = /\{\{([A-Z0-9_]+)\}\}/g;
const paraText = (xml: string, q: Para) => q.ts.map((t) => xml.slice(t.textStart, t.textEnd)).join("");

/** Marker names found in a part's <w:t> text (split runs included), ignoring anything inside <mc:Fallback>. */
export function scanMarkers(xml: string): Set<string> {
  const out = new Set<string>();
  for (const q of scan(xml).paras) {
    if (q.fallback) continue;
    for (const m of paraText(xml, q).matchAll(MARK)) out.add(m[1]);
  }
  return out;
}

type Seg = { t: string } | { br: true };
const wt = (attrs: string, text: string) => `<w:t${attrs}${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""}>${text}</w:t>`;
function render(attrs: string, segs: Seg[]): string {
  const merged: Seg[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if ("t" in s) { if (!s.t) continue; if (last && "t" in last) last.t += s.t; else merged.push({ t: s.t }); } else merged.push(s);
  }
  return merged.map((s) => ("t" in s ? wt(attrs, s.t) : "<w:br/>")).join("");
}
const lines = (v: string) => v.split(/\r\n|\r|\n/);

/** Replace every {{NAME}} in the part. body goes at the first {{RACKWRIGHT}} (see the spec). */
export function replaceMarkers(xml: string, values: MarkerValues, body?: string): ReplaceResult {
  const { paras, bodySect, bodyClose } = scan(xml);
  const edits: { start: number; end: number; text: string }[] = [];
  let result: ReplaceResult["rackwright"] = "missing";
  let seen = false;

  for (const q of paras.slice().sort((a, b) => a.start - b.start)) {
    const text = paraText(xml, q);
    const ms = [...text.matchAll(MARK)].map((m) => ({ name: m[1], start: m.index!, end: m.index! + m[0].length }));
    if (!ms.length) continue;
    const trimmed = text.trim();
    const whole = xml.slice(q.start, q.end);

    // RACKWRIGHT: the first one wins; it replaces its whole paragraph.
    const rw = ms.find((m) => m.name === "RACKWRIGHT");
    let rwHere = false;
    if (rw && !q.fallback && !seen) {
      seen = true;
      if (body !== undefined) { rwHere = true; result = trimmed === "{{RACKWRIGHT}}" ? "alone" : "shared"; 
        // Keep a section break held in the paragraph's own properties: an empty paragraph after the body.
        const pPr = /^<w:p(?:\s[^>]*)?>(<w:pPr>[\s\S]*?<\/w:pPr>)/.exec(whole)?.[1] ?? "";
        edits.push({ start: q.start, end: q.end, text: body + (pPr.includes("<w:sectPr") ? `<w:p>${pPr}</w:p>` : "") });
      }
    }
    if (rwHere) continue;

    // SUMMARY / RECOMMENDATIONS alone in a paragraph: one paragraph per line.
    const block = /^\{\{(SUMMARY|RECOMMENDATIONS)\}\}$/.exec(trimmed);
    if (block && !q.nested && values[block[1] as keyof MarkerValues]) {
      const pPr = /^<w:p(?:\s[^>]*)?>(<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>)?/.exec(whole)?.[1] ?? "";
      const rPr = /<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)?/.exec(whole)?.[1] ?? "";
      const paras2 = lines(values[block[1] as keyof MarkerValues]).map((l) => `<w:p>${pPr}<w:r>${rPr}${l ? wt("", xmlText(l)) : ""}</w:r></w:p>`);
      edits.push({ start: q.start, end: q.end, text: paras2.join("") });
      continue;
    }

    // Inline: put each value in the first run it touches and cut the marker from later runs.
    let off = 0;
    // RACKWRIGHT here is a later copy, a copy in Fallback, or no body was supplied: removed.
    const reps = ms.map((m) => ({ ...m, value: m.name === "RACKWRIGHT" ? "" : values[m.name as keyof MarkerValues] ?? "" }));
    for (const t of q.ts) {
      const ts = off, te = off + (t.textEnd - t.textStart);
      off = te;
      const hit = reps.filter((m) => m.start < te && m.end > ts);
      if (!hit.length) continue;
      const raw = xml.slice(t.textStart, t.textEnd);
      const segs: Seg[] = [];
      let cur = ts;
      for (const m of hit) {
        const a = Math.max(m.start, ts), b = Math.min(m.end, te);
        if (a > cur) segs.push({ t: raw.slice(cur - ts, a - ts) });
        if (m.start >= ts && m.start < te) lines(m.value).forEach((l, i) => { if (i) segs.push({ br: true }); segs.push({ t: xmlText(l) }); });
        cur = Math.max(cur, b);
      }
      if (cur < te) segs.push({ t: raw.slice(cur - ts) });
      edits.push({ start: t.open, end: t.close, text: render(t.attrs, segs) });
    }
  }

  if (!seen && body !== undefined) {
    const at = bodySect >= 0 ? bodySect : bodyClose;
    if (at >= 0) edits.push({ start: at, end: at, text: body });
  }

  // Drop edits nested inside a replaced paragraph, then apply from the end backwards.
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof edits = [];
  let lastEnd = -1;
  for (const e of edits) { if (e.start < lastEnd) continue; kept.push(e); lastEnd = Math.max(lastEnd, e.end); }
  let out = xml;
  for (let i = kept.length - 1; i >= 0; i--) out = out.slice(0, kept[i].start) + kept[i].text + out.slice(kept[i].end);
  return { xml: out, rackwright: result };
}
