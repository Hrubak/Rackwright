// Visio .vsdx reader. Port of RackMap parseVsdx/vsdxPage, using jszip + fast-xml-parser so it also runs under Node.
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { DiagramLink, DiagramModel, DiagramNode } from "./diagram";

type X = any; // parsed XML node

const ARRAYS = new Set(["Shape", "Shapes", "Cell", "Section", "Row", "Connect", "Master", "Page"]);
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, textNodeName: "#text", parseTagValue: false, trimValues: false,
  isArray: (name) => ARRAYS.has(name),
});
const parseXml = (s: string): X => parser.parse(s);
const arr = (v: X): X[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** All text inside an element (Visio Text can hold <cp/> and other children). */
function textOf(v: X): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(textOf).join("");
  let out = "";
  for (const [k, val] of Object.entries(v)) if (!k.startsWith("@_")) out += textOf(val);
  return out;
}

interface Pt { x: number; y: number }
interface VShape { id: string; master: string; nameU: string; text: string; data: Record<string, string>; x: number; y: number; w: number; h: number; begin: Pt | null; end: Pt | null; is1D: boolean; parent: string | null }

export async function parseVsdx(data: ArrayBuffer | Uint8Array, fileName: string): Promise<DiagramModel[]> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error("not a .vsdx file"); }
  const read = async (p: string) => { const f = zip.file(p); return f ? f.async("string") : null; };
  const masters = new Map<string, string>(), pageNames = new Map<number, string>();
  const mx = await read("visio/masters/masters.xml");
  if (mx) {
    const root = parseXml(mx);
    arr(root.Masters?.Master).forEach((m) => masters.set(String(m["@_ID"]), m["@_NameU"] || m["@_Name"] || ""));
  }
  const px = await read("visio/pages/pages.xml");
  if (px) arr(parseXml(px).Pages?.Page).forEach((pg, i) => pageNames.set(i + 1, pg["@_NameU"] || pg["@_Name"] || "Page-" + (i + 1)));
  const num = (k: string) => parseInt(k.match(/(\d+)\.xml/)![1]);
  const pages = Object.keys(zip.files).filter((k) => /^visio\/pages\/page\d+\.xml$/i.test(k)).sort((a, b) => num(a) - num(b));
  if (!pages.length) throw new Error("no drawing pages found");
  const models: DiagramModel[] = [];
  for (const pk of pages) {
    const no = num(pk);
    models.push(vsdxPage(parseXml((await read(pk))!), masters, fileName + " · " + (pageNames.get(no) || "Page-" + no)));
  }
  return models;
}

function vsdxPage(doc: X, masters: Map<string, string>, source: string): DiagramModel {
  const root = doc.PageContents ?? Object.values(doc).find((v) => v && typeof v === "object") ?? {};
  const cell = (el: X, n: string): string | null => {
    const c = arr(el.Cell).find((c) => c["@_N"] === n);
    return c && c["@_V"] != null ? String(c["@_V"]) : null;
  };
  const shapes = new Map<string, VShape>(), parentOf = new Map<string, string>(), top: VShape[] = [];
  const walk = (el: X, parent: string | null, ox: number, oy: number, inheritMaster: string | null) => {
    arr(el.Shapes).forEach((ss) => arr(ss?.Shape).forEach((sEl) => {
      const id = String(sEl["@_ID"]), mId = sEl["@_Master"] != null ? String(sEl["@_Master"]) : null;
      const nameU: string = sEl["@_NameU"] || sEl["@_Name"] || "";
      const master = (mId && masters.get(mId)) || inheritMaster || nameU.replace(/\.\d+$/, "");
      const num = (n: string) => { const v = cell(sEl, n); return v == null || v === "" ? null : +v; };
      const w = num("Width") || 0, h = num("Height") || 0, pinX = num("PinX") || 0, pinY = num("PinY") || 0, lpx = num("LocPinX"), lpy = num("LocPinY");
      const x = ox + pinX - (lpx != null ? lpx : w / 2), y = oy + pinY - (lpy != null ? lpy : h / 2);
      const text = sEl.Text == null ? "" : textOf(sEl.Text).replace(/\r/g, "\n").split("\n").map((t) => t.trim()).filter(Boolean).join("\n");
      const data: Record<string, string> = {};
      arr(sEl.Section).filter((s) => s["@_N"] === "Property").forEach((sec) => arr(sec.Row).forEach((row) => {
        const v = cell(row, "Value"), rn = String(row["@_N"] || "");
        if (v == null || v === "" || (v === "0" && !/port|count/i.test(rn))) return;
        data[cell(row, "Label") || rn] = v;
      }));
      const bx = num("BeginX"), ex = num("EndX");
      const begin = bx != null ? { x: ox + bx, y: oy + (num("BeginY") || 0) } : null;
      const end = ex != null ? { x: ox + ex, y: oy + (num("EndY") || 0) } : null;
      const s: VShape = { id, master, nameU, text, data, x, y, w, h, begin, end, is1D: !!(begin && end), parent };
      shapes.set(id, s);
      if (parent) parentOf.set(id, parent); else top.push(s);
      walk(sEl, id, x, y, mId ? masters.get(mId) ?? null : inheritMaster);
    }));
  };
  walk(root, null, 0, 0, null);

  // child text/data roll up into their top-level group
  const topOf = (id: string) => { while (parentOf.has(id)) id = parentOf.get(id)!; return id; };
  shapes.forEach((s) => {
    if (!s.parent) return;
    const t = shapes.get(topOf(s.id));
    if (!t || t.is1D) return;
    if (s.text && !t.text.includes(s.text)) t.text = (t.text ? t.text + "\n" : "") + s.text;
    Object.entries(s.data).forEach(([k, v]) => { if (!(k in t.data)) t.data[k] = v; });
  });

  const ends = new Map<string, { a?: string; b?: string }>();
  arr(root.Connects).forEach((cs) => arr(cs?.Connect).forEach((c) => {
    const from = String(c["@_FromSheet"]), to = topOf(String(c["@_ToSheet"])), fc = String(c["@_FromCell"] || "");
    if (!ends.has(from)) ends.set(from, {});
    const e = ends.get(from)!;
    if (/^Begin/i.test(fc)) e.a = to; else if (/^End/i.test(fc)) e.b = to; else if (!e.a) e.a = to; else e.b = e.b || to;
  }));

  const nodes: DiagramNode[] = top.filter((s) => !s.is1D).map((s) => ({ id: s.id, title: s.master, label: s.text, data: s.data, x: s.x, y: s.y, w: s.w, h: s.h }));
  const links: DiagramLink[] = [];
  top.filter((s) => s.is1D).forEach((s) => {
    const e = ends.get(s.id) || {};
    let a = e.a ?? null, b = e.b ?? null;
    // not glued: fall back to the nearest shape at each end
    if (!a && s.begin) a = nearestNode(nodes, s.begin, 0.25);
    if (!b && s.end) b = nearestNode(nodes, s.end, 0.25);
    if (a && b && a !== b) links.push({ a, b, text: s.text });
  });
  return { source, nodes, links, yUp: true };
}

function distToBox(p: Pt, n: DiagramNode): number {
  const dx = Math.max(n.x - p.x, 0, p.x - (n.x + n.w)), dy = Math.max(n.y - p.y, 0, p.y - (n.y + n.h));
  return Math.hypot(dx, dy);
}
function nearestNode(nodes: DiagramNode[], p: Pt, tol: number): string | null {
  let best: string | null = null, bd = Infinity;
  nodes.forEach((n) => { const d = distToBox(p, n); if (d < bd && d <= tol) { bd = d; best = n.id; } });
  return best;
}
