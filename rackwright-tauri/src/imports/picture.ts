// Picture reader: text by on-device OCR (tesseract.js, loaded on first use) plus box/icon/line analysis.
// Port of RackMap parseImage and its helpers.
import { guessType } from "./spec";
import type { DiagramLink, DiagramModel, DiagramNode } from "./diagram";
import { loadTesseract, readerError, isReaderError, withTimeout, TESS_TIMEOUT_MS } from "./readers";
import type { TessWorker } from "./readers";

export interface Word { k: string; x: number; y: number; w: number; h: number; text: string; conf: number }
interface Line { words: Word[]; x: number; y: number; w: number; h: number; text: string }
export interface Label { lines: Line[]; x: number; y: number; w: number; h: number; text: string }

/** Tesseract TSV to words: level-5 rows, confidence 45 or more, must contain a letter or digit; coordinates divided by `scale`. */
export function parseTsv(tsv: string, scale: number): Word[] {
  const words: Word[] = [];
  String(tsv || "").split("\n").forEach((row) => {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") return;
    const conf = +c[10], text = c.slice(11).join(" ").trim();
    if (!text || conf < 45 || !/[A-Za-z0-9]/.test(text)) return;
    words.push({ k: c[2] + "." + c[3] + "." + c[4], x: +c[6] / scale, y: +c[7] / scale, w: +c[8] / scale, h: +c[9] / scale, text, conf });
  });
  return words;
}

/** Group words into lines, then lines into device labels (stacked, roughly centred text). */
export function wordsToLabels(words: Word[]): { labels: Label[]; lh: number } {
  const lines: Line[] = [];
  const byKey = new Map<string, Line>();
  words.slice().sort((a, b) => a.x - b.x).forEach((w) => {
    let l = byKey.get(w.k) || null;
    // sparse-mode TSV "lines" can join words that are far apart: split on a big gap
    if (l && w.x - (l.x + l.w) > Math.max(l.h, w.h) * 1.6) l = null;
    if (!l) { l = { words: [], x: w.x, y: w.y, w: w.w, h: w.h, text: "" }; lines.push(l); byKey.set(w.k, l); }
    l.words.push(w);
    const x2 = Math.max(l.x + l.w, w.x + w.w), y2 = Math.max(l.y + l.h, w.y + w.h);
    l.x = Math.min(l.x, w.x); l.y = Math.min(l.y, w.y); l.w = x2 - l.x; l.h = y2 - l.y;
  });
  lines.forEach((l) => { l.text = l.words.map((w) => w.text).join(" "); });
  const lh = lines.length ? lines.map((l) => l.h).sort((a, b) => a - b)[Math.floor(lines.length / 2)] : 12;
  const labels: Label[] = [];
  lines.sort((a, b) => a.y - b.y || a.x - b.x).forEach((l) => {
    const cx = l.x + l.w / 2;
    let best: Label | null = null, bestGap = Infinity;
    labels.forEach((L) => {
      const last = L.lines[L.lines.length - 1];
      const gap = l.y - (last.y + last.h);
      const overlapX = Math.min(L.x + L.w, l.x + l.w) - Math.max(L.x, l.x);
      if (gap > -lh * 0.4 && gap < lh * 1.6 && (overlapX > Math.min(L.w, l.w) * 0.4 || Math.abs((L.x + L.w / 2) - cx) < lh * 1.2) && gap < bestGap) { best = L; bestGap = gap; }
    });
    if (best) {
      const B = best as Label;
      B.lines.push(l);
      const x2 = Math.max(B.x + B.w, l.x + l.w), y2 = Math.max(B.y + B.h, l.y + l.h);
      B.x = Math.min(B.x, l.x); B.y = Math.min(B.y, l.y); B.w = x2 - B.x; B.h = y2 - B.y;
    } else labels.push({ lines: [l], x: l.x, y: l.y, w: l.w, h: l.h, text: "" });
  });
  labels.forEach((L) => { L.text = L.lines.map((l) => l.text).join("\n"); });
  return { labels, lh };
}

// short text that annotates a cable rather than naming a device (ports, VLANs, speeds)
export const WIRE_NOTE_RE = /^((gi|ge|te|tw|fa|fo|eth|et|xe|po|port|p|vlan|lan|wan|mgmt|uplink|trunk)[\s\-]?[\d\/.:\-]*|\d{1,3}|\d+(\.\d+)?\s?(g|m|gb|mb|gbps|mbps)|\d{1,2}\/\d{1,2}(\/\d{1,3})?)$/i;

interface Box { x: number; y: number; w: number; h: number }

/** Foreground mask, then device areas (boxes or icons beside labels), then leftover strokes are the cables. */
function analyseShapes(cv: HTMLCanvasElement, scale: number, words: Word[], labels: Label[], lh: number): { nodes: DiagramNode[]; links: DiagramLink[] } {
  const W = cv.width, H = cv.height, px = cv.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const hist = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4 * 7) { const k = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4); hist.set(k, (hist.get(k) || 0) + 1); }
  let bk = 0, bn = -1; hist.forEach((n, k) => { if (n > bn) { bn = n; bk = k; } });
  const br = ((bk >> 8) & 15) * 16 + 8, bgc = ((bk >> 4) & 15) * 16 + 8, bb = (bk & 15) * 16 + 8;
  const fg = new Uint8Array(W * H);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) { if (Math.abs(px[i] - br) + Math.abs(px[i + 1] - bgc) + Math.abs(px[i + 2] - bb) > 90) fg[p] = 1; }
  const S = (v: number) => v * scale, L = Math.max(5, lh * scale);
  const clearRect = (m: Uint8Array, x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    for (let y = y0; y < y1; y++) m.fill(0, y * W + x0, y * W + x1);
  };
  const noText = fg.slice();
  words.forEach((w) => clearRect(noText, S(w.x) - 2, S(w.y) - 2, S(w.x + w.w) + 2, S(w.y + w.h) + 2));
  const frac = (x0: number, x1: number, y0: number, y1: number) => {
    x0 = Math.max(0, Math.round(x0)); x1 = Math.min(W, Math.round(x1)); y0 = Math.max(0, Math.round(y0)); y1 = Math.min(H, Math.round(y1));
    let n = 0, t = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; n += noText[y * W + x]; }
    return t ? n / t : 0;
  };
  // edge test: a 3px band along a side that is mostly ink
  const edge = (x0: number, x1: number, y0: number, y1: number) => frac(x0, x1, y0, y1) > 0.55;
  const findBox = (x0: number, y0: number, x1: number, y1: number): Box | null => {
    const max = L * 7; let t = 0, b = 0, l = 0, r = 0;
    for (let d = 1; d < max && !t; d++) if (frac(x0, x1, y0 - d, y0 - d + 1) > 0.6) t = d;
    for (let d = 1; d < max && !b; d++) if (frac(x0, x1, y1 + d - 1, y1 + d) > 0.6) b = d;
    if (!t || !b) return null;
    const top = y0 - t, bot = y1 + b - 1;
    for (let d = 1; d < max && !l; d++) if (frac(x0 - d, x0 - d + 1, top + 2, bot - 1) > 0.6) l = d;
    for (let d = 1; d < max && !r; d++) if (frac(x1 + d - 1, x1 + d, top + 2, bot - 1) > 0.6) r = d;
    if (!l || !r) return null;
    const left = x0 - l, right = x1 + r - 1;
    // verify it is a real rectangle: all four sides continuous along their full length
    if (!(edge(left, right, top - 1, top + 2) && edge(left, right, bot - 1, bot + 2) && edge(left - 1, left + 2, top, bot) && edge(right - 1, right + 2, top, bot))) return null;
    return { x: left - 3, y: top - 3, w: right - left + 7, h: bot - top + 7 };
  };
  const findIcon = (x0: number, y0: number, x1: number, y1: number): Box | null => {
    // look for a solid-ish blob right next to the label: above, left, right or below
    const cands: { dir: string; start: number; end: number }[] = [];
    const span = Math.max(x1 - x0, L * 2.5), cx = (x0 + x1) / 2, vs = Math.max(y1 - y0, L * 4.5), cy = (y0 + y1) / 2;
    const scan = (dir: string) => {
      let start = 0, end = 0, gap = 0;
      for (let d = 1; d < L * 8; d++) {
        let f: number;
        if (dir === "u") f = frac(cx - span / 2, cx + span / 2, y0 - d, y0 - d + 1);
        else if (dir === "d") f = frac(cx - span / 2, cx + span / 2, y1 + d - 1, y1 + d);
        else if (dir === "l") f = frac(x0 - d, x0 - d + 1, cy - vs / 2, cy + vs / 2);
        else f = frac(x1 + d - 1, x1 + d, cy - vs / 2, cy + vs / 2);
        if (f > (dir === "u" || dir === "d" ? 0.07 : 0.08)) { if (!start) start = d; end = d; gap = 0; }
        else if (start) { if (++gap > L * 0.6) break; }
        else if (d > (dir === "u" || dir === "d" ? L * 1.8 : L * 4)) break;
      }
      return start && end - start >= L * 0.6 ? { start, end } : null;
    };
    ["u", "l", "r", "d"].forEach((dir) => { const h = scan(dir); if (h) cands.push({ dir, ...h }); });
    if (!cands.length) return null;
    const c = cands.sort((a, b) => a.start - b.start || (a.dir === "u" ? -1 : 1))[0];
    if (c.dir === "u") return { x: Math.min(x0, cx - span / 2) - 3, y: y0 - c.end - 3, w: Math.max(x1 - x0, span) + 6, h: (y1 - (y0 - c.end)) + 6 };
    if (c.dir === "d") return { x: Math.min(x0, cx - span / 2) - 3, y: y0 - 3, w: Math.max(x1 - x0, span) + 6, h: (y1 + c.end - y0) + 6 };
    if (c.dir === "l") return { x: x0 - c.end - 3, y: Math.min(y0, cy - vs / 2) - 3, w: (x1 - (x0 - c.end)) + 6, h: Math.max(y1 - y0, vs) + 6 };
    return { x: x0 - 3, y: Math.min(y0, cy - vs / 2) - 3, w: (x1 + c.end - x0) + 6, h: Math.max(y1 - y0, vs) + 6 };
  };
  // 1) labels become areas; wire annotations (ports, VLANs) are skipped
  interface Pre { label: string; ly: number; b: Box; boxed: boolean }
  const pre: Pre[] = [];
  labels.forEach((lb) => {
    const first = lb.text.split("\n")[0].trim();
    if (lb.lines.length === 1 && WIRE_NOTE_RE.test(first)) return;
    const x0 = S(lb.x), y0 = S(lb.y), x1 = S(lb.x + lb.w), y1 = S(lb.y + lb.h);
    const box = findBox(x0, y0, x1, y1);
    const area = box || findIcon(x0, y0, x1, y1) || { x: x0 - L * 0.5, y: y0 - L * 0.5, w: (x1 - x0) + L, h: (y1 - y0) + L };
    pre.push({ label: lb.text, ly: lb.y, b: area, boxed: !!box });
  });
  // 2) text that sits in the same box is one device (e.g. name + IP + model inside a Visio rectangle)
  const merged: Pre[] = [];
  pre.sort((a, b) => a.ly - b.ly).forEach((n) => {
    const m = merged.find((o) => o.boxed && n.boxed && Math.abs(o.b.x - n.b.x) < 4 && Math.abs(o.b.y - n.b.y) < 4 && Math.abs(o.b.w - n.b.w) < 6 && Math.abs(o.b.h - n.b.h) < 6);
    if (m) m.label += "\n" + n.label; else merged.push(n);
  });
  const boxes = new Map<string, Box>();
  const nodes: DiagramNode[] = merged.map((n, i) => {
    const id = "p" + i; boxes.set(id, n.b);
    return { id, title: "", label: n.label, data: {}, x: n.b.x / scale, y: n.b.y / scale, w: n.b.w / scale, h: n.b.h / scale };
  });
  // 3) what is left after removing text and device areas is the cables (lightly thickened to bridge small gaps)
  const rest = noText.slice(); boxes.forEach((b) => clearRect(rest, b.x, b.y, b.x + b.w, b.y + b.h));
  const dil = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!rest[y * W + x]) continue;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) dil[yy * W + xx] = 1; } }
  }
  const seen = new Uint8Array(W * H), links: DiagramLink[] = [], tol = Math.max(4, L * 0.45);
  const near = (x: number, y: number) => {
    const hit: string[] = [];
    boxes.forEach((b, id) => { const dx = Math.max(b.x - x, 0, x - (b.x + b.w)), dy = Math.max(b.y - y, 0, y - (b.y + b.h)); if (dx * dx + dy * dy <= tol * tol) hit.push(id); });
    return hit;
  };
  const nodeOf = (id: string) => nodes.find((x) => x.id === id)!;
  const rankOf: Record<string, number> = { Router: 0, Firewall: 1, Switch: 2, "Patch panel": 3 };
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!dil[s0] || seen[s0]) continue;
    const stack = [s0]; seen[s0] = 1; let minx = W, miny = H, maxx = 0, maxy = 0; const touched = new Set<string>();
    while (stack.length) {
      const p = stack.pop()!; const x = p % W, y = (p - x) / W;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      near(x, y).forEach((id) => touched.add(id));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (dil[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (Math.max(maxx - minx, maxy - miny) < L * 1.6 || touched.size < 2) continue; // ignore dashes, bullets and tiny marks
    const ids = Array.from(touched);
    if (ids.length === 2) links.push({ a: ids[0], b: ids[1], text: "" });
    else if (ids.length <= 12) { // one branching connector: everything hangs off the most "core" device, else the top-most
      const rank = (id: string) => { const n = nodeOf(id); const t = guessType(n.label.split("\n")[0], n.label); return (t != null ? rankOf[t] : undefined) ?? 5; };
      const hub = ids.slice().sort((a, b) => rank(a) - rank(b) || boxes.get(a)!.y - boxes.get(b)!.y)[0];
      ids.filter((id) => id !== hub).forEach((id) => links.push({ a: hub, b: id, text: "" }));
    }
  }
  return { nodes, links };
}

// Tesseract skips text that sits inside or against drawn graphics (boxes joined by connectors).
// Erase long thin strokes (lines and box outlines) so only text (and solid icons) remain.
function eraseLineArt(cv: HTMLCanvasElement, byColor: boolean): number {
  const W = cv.width, H = cv.height, ctx = cv.getContext("2d", { willReadFrequently: true })!, id = ctx.getImageData(0, 0, W, H), px = id.data;
  const hist = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4 * 9) { const k = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4); hist.set(k, (hist.get(k) || 0) + 1); }
  let bk = 0, bn = -1; hist.forEach((n, k) => { if (n > bn) { bn = n; bk = k; } });
  const br = ((bk >> 8) & 15) * 16 + 8, bg = ((bk >> 4) & 15) * 16 + 8, bb = (bk & 15) * 16 + 8;
  const N = W * H, fg = new Uint8Array(N);
  for (let i = 0, p = 0; p < N; p++, i += 4) if (Math.abs(px[i] - br) + Math.abs(px[i + 1] - bg) + Math.abs(px[i + 2] - bb) > 90) fg[p] = 1;
  const lab = new Int32Array(N), big = Math.max(W, H) * 0.04; let next = 0; const stack = new Int32Array(N); const erase: number[] = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (!fg[s0] || lab[s0]) continue;
    next++; let sp = 0; stack[sp++] = s0; lab[s0] = next; let cnt = 0, minx = W, miny = H, maxx = 0, maxy = 0;
    while (sp) {
      const p = stack[--sp]; cnt++; const x = p % W, y = (p - x) / W;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && fg[p - 1] && !lab[p - 1]) { lab[p - 1] = next; stack[sp++] = p - 1; }
      if (x < W - 1 && fg[p + 1] && !lab[p + 1]) { lab[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && fg[p - W] && !lab[p - W]) { lab[p - W] = next; stack[sp++] = p - W; }
      if (y < H - 1 && fg[p + W] && !lab[p + W]) { lab[p + W] = next; stack[sp++] = p + W; }
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (Math.max(bw, bh) > big && cnt / (bw * bh) < 0.3) erase.push(next);
  }
  if (!erase.length) return 0;
  const kill = new Uint8Array(next + 1); erase.forEach((k) => kill[k] = 1);
  if (byColor) {
    // only remove pixels in the line colour, so letters a line passes through survive
    const ch = new Map<number, number>();
    for (let p = 0, i = 0; p < N; p += 3, i += 12) if (kill[lab[p]]) { const k = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4); ch.set(k, (ch.get(k) || 0) + 1); }
    const cols = Array.from(ch.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8]);
    const textLike = (c: number[]) => Math.abs(c[0] - c[1]) + Math.abs(c[1] - c[2]) < 40 && Math.abs(c[0] - br) + Math.abs(c[1] - bg) + Math.abs(c[2] - bb) > 300; // grey/black/white text colours stay
    const lineCols = cols.filter((c) => !textLike(c)); if (!lineCols.length) return 0;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      if (!kill[lab[p]]) continue;
      for (const c of lineCols) if (Math.abs(px[i] - c[0]) + Math.abs(px[i + 1] - c[1]) + Math.abs(px[i + 2] - c[2]) < 70) { px[i] = br; px[i + 1] = bg; px[i + 2] = bb; break; }
    }
    ctx.putImageData(id, 0, 0); return erase.length;
  }
  for (let p = 0, i = 0; p < N; p++, i += 4) if (kill[lab[p]]) { px[i] = br; px[i + 1] = bg; px[i + 2] = bb; }
  ctx.putImageData(id, 0, 0); return erase.length;
}

async function loadImageFile(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = "async";
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("not a readable picture")); img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
function drawTo(img: HTMLImageElement, scale: number): HTMLCanvasElement {
  const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(img.naturalWidth * scale)); cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; // theme-ok
  ctx.fillRect(0, 0, cv.width, cv.height); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
const canvasBlob = (cv: HTMLCanvasElement): Promise<Blob> => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("not a readable picture"))), "image/png"));

export const MAX_PICTURE_PIXELS = 50_000_000;

/** One recognize() call. A hang or any failure shuts the worker down and forgets it. Only a timeout is a reader failure; anything else is a problem with this picture. */
export async function recognizeWords(worker: TessWorker, blob: Blob, scale: number, ms: number = TESS_TIMEOUT_MS, forget: () => void = () => loadTesseract.reset()): Promise<Word[]> {
  try {
    const r = await withTimeout(worker.recognize(blob as unknown as HTMLCanvasElement, {}, { tsv: true }), ms);
    return parseTsv(r.data.tsv || "", scale);
  } catch (e) { // a dead or stuck worker must not stay cached
    worker.terminate().catch(() => {}); forget();
    throw isReaderError(e) ? e : new Error(String((e as Error)?.message || e));
  }
}

export async function parsePicture(file: Blob, name: string): Promise<DiagramModel> {
  const img = await loadImageFile(file); const W0 = img.naturalWidth, H0 = img.naturalHeight;
  if (!W0 || !H0) throw new Error("empty picture");
  if (W0 * H0 > MAX_PICTURE_PIXELS) throw new Error("the picture is too big");
  const worker = await loadTesseract();
  const s1 = Math.min(3, 2400 / Math.max(W0, H0)); // enlarge small exports so text is readable; scale big screenshots down
  // read as drawn (text crossed by lines), then with line art erased (text inside boxes); keep the best of each word.
  // The passes run one after another on the same worker.
  const pass = async (mode: "shape" | "color" | null): Promise<Word[] | null> => {
    const cv = drawTo(img, s1);
    try {
      if (mode && !eraseLineArt(cv, mode === "color")) return null;
      const blob = await canvasBlob(cv);
      return await recognizeWords(worker, blob, s1);
    } finally { cv.width = cv.height = 0; }
  };
  const a = (await pass(null)) || [];
  const b = [...((await pass("shape")) || []), ...((await pass("color")) || [])];
  const iou = (p: Word, q: Word) => { const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)), iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y)), i = ix * iy; return i / (p.w * p.h + q.w * q.h - i || 1); };
  const words = a.slice();
  b.forEach((w) => {
    const i = words.findIndex((o) => iou(o, w) > 0.25);
    if (i < 0) words.push(w);
    else { const o = words[i]; if (w.conf > o.conf + 3 || (Math.abs(w.conf - o.conf) <= 3 && w.text.length > o.text.length)) words[i] = Object.assign({}, w, { k: o.k }); }
  });
  // words from the second pass carry their own line keys: make them unique so lines don't mix passes
  b.forEach((w) => { if (words.includes(w)) w.k = "b" + w.k; });
  const { labels, lh } = wordsToLabels(words);
  const s2 = Math.min(1, 1400 / Math.max(W0, H0));
  const cv2 = drawTo(img, s2);
  let shapes: { nodes: DiagramNode[]; links: DiagramLink[] };
  try { shapes = analyseShapes(cv2, s2, words, labels, lh); } finally { cv2.width = cv2.height = 0; }
  const { nodes, links } = shapes;
  return { source: name, nodes, links, yUp: false, words: words.length };
}
