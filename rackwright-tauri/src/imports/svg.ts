// SVG reader (Visio-exported or any drawing tool). Port of RackMap parseSvg/svgModel; no picture rendering.
import type { DiagramLink, DiagramModel, DiagramNode, Pt } from "./diagram";
import { nearestNode } from "./diagram";

const VNS = "http://schemas.microsoft.com/visio/2003/SVGExtensions/";

const hrefOk = (v: string) => v.replace(/[\u0000-\u0020]/g, "").startsWith("#");

/** String-level clean-up that works without a DOM. Pre-filter only; the DOM pass is the real one. */
export function sanitizeSvgText(svg: string): string {
  const once = (x: string) => x
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<foreignObject\b[^>]*>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<iframe\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*"([^"]*)"/gi, (m, v) => (hrefOk(v) ? m : ""))
    .replace(/\s(?:xlink:)?href\s*=\s*'([^']*)'/gi, (m, v) => (hrefOk(v) ? m : ""));
  let cur = svg;
  for (let i = 0; i < 10; i++) { const n = once(cur); if (n === cur) break; cur = n; }
  return cur;
}

const BAD_ELEMENTS = new Set(["script", "foreignobject", "iframe", "object", "embed", "link", "animate", "animatemotion", "animatetransform", "set", "feimage"]);

function sanitizeSvgDom(root: Element): void {
  Array.from(root.querySelectorAll("*")).forEach((e) => {
    const ln = e.localName.toLowerCase();
    if (BAD_ELEMENTS.has(ln)) { e.remove(); return; }
    if (ln === "style" && /url\(|@import/i.test(e.textContent || "")) { e.remove(); return; }
    Array.from(e.attributes).forEach((a) => {
      const n = a.name.toLowerCase(), local = (a.localName || n).toLowerCase();
      if (/^on/.test(local) || /^on/.test(n)) e.removeAttribute(a.name);
      else if (local === "href" && !hrefOk(a.value)) e.removeAttribute(a.name);
      else if (local === "style" && /url\(|@import|expression\(/i.test(a.value)) e.removeAttribute(a.name);
    });
  });
  [root.localName.toLowerCase() === "svg" ? root : null].forEach((r) => {
    if (r) Array.from(r.attributes).forEach((a) => {
      const l = (a.localName || a.name).toLowerCase();
      if (/^on/.test(l) || (l === "href" && !hrefOk(a.value)) || (l === "style" && /url\(|@import|expression\(/i.test(a.value))) r.removeAttribute(a.name);
    });
  });
}

export async function parseSvg(text: string, fileName: string): Promise<DiagramModel> {
  const d = new DOMParser().parseFromString(sanitizeSvgText(text), "image/svg+xml");
  if (d.getElementsByTagName("parsererror").length || d.documentElement.localName !== "svg") throw new Error("not a readable SVG");
  sanitizeSvgDom(d.documentElement);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;";
  try {
    const svg = document.importNode(d.documentElement, true) as unknown as SVGSVGElement;
    host.appendChild(svg);
    document.body.appendChild(host);
    return svgModel(svg, fileName);
  } finally { host.remove(); }
}

const kids = (el: Element, name: string): Element[] => Array.from(el.children).filter((c) => c.localName === name);

type Box = { x: number; y: number; w: number; h: number };

function svgModel(svg: SVGSVGElement, source: string): DiagramModel {
  const va = (el: Element, n: string) => el.getAttribute("v:" + n) ?? el.getAttributeNS(VNS, n);
  const R = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const pt = (el: Element, x: number, y: number): Pt | null => {
    const m = (el as SVGGraphicsElement).getScreenCTM(); if (!m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m); return { x: p.x, y: p.y };
  };
  const endsOf = (el: Element): (Pt | null)[] | null => {
    try {
      if (el.localName === "line") return [pt(el, +el.getAttribute("x1")!, +el.getAttribute("y1")!), pt(el, +el.getAttribute("x2")!, +el.getAttribute("y2")!)];
      if (el.localName === "polyline") {
        const ps = (el as SVGPolylineElement).points; if (ps.numberOfItems < 2) return null;
        const a = ps.getItem(0), b = ps.getItem(ps.numberOfItems - 1); return [pt(el, a.x, a.y), pt(el, b.x, b.y)];
      }
      if (el.localName === "path") {
        if (/z\s*$/i.test(el.getAttribute("d") || "")) return null;
        const pe = el as SVGPathElement, L = pe.getTotalLength(); if (!(L > 0)) return null;
        const a = pe.getPointAtLength(0), b = pe.getPointAtLength(L); return [pt(el, a.x, a.y), pt(el, b.x, b.y)];
      }
    } catch { /* unmeasurable shape */ }
    return null;
  };
  const textOf = (g: Element) => Array.from(g.querySelectorAll("text")).map((t) => {
    const sp = t.querySelectorAll("tspan");
    return sp.length ? Array.from(sp).map((s) => (s.textContent || "").trim()).filter(Boolean).join("\n") : (t.textContent || "").trim();
  }).filter(Boolean).join("\n");

  type RawLink = { p: (Pt | null)[]; text: string };
  type Work = DiagramNode & { el?: Element | null };
  const nodes: Work[] = [], links: RawLink[] = [];
  const visioShapes = Array.from(svg.querySelectorAll("g")).filter((g) => /^(shape|group)$/.test(va(g, "groupContext") || ""));
  if (visioShapes.length) {
    // top-level Visio shapes = shape groups not nested in another shape group
    const tops = visioShapes.filter((g) => !visioShapes.some((o) => o !== g && o.contains(g)));
    tops.forEach((g, i) => {
      const title = (kids(g, "title")[0]?.textContent || "").trim(), desc = (kids(g, "desc")[0]?.textContent || "").trim();
      const data: Record<string, string> = {};
      Array.from(g.getElementsByTagNameNS(VNS, "cp")).forEach((cp) => {
        const lbl = cp.getAttributeNS(VNS, "lbl") || cp.getAttribute("v:lbl") || cp.getAttributeNS(VNS, "nameU") || cp.getAttribute("v:nameU");
        let val = cp.getAttributeNS(VNS, "val") || cp.getAttribute("v:val") || "";
        const m = val.match(/^VT\d+\((.*)\)$/); if (m) val = m[1];
        if (lbl && val && val !== "0") data[lbl] = val;
      });
      const label = (desc || textOf(g)).split("\n").map((t) => t.trim()).filter(Boolean).join("\n");
      if (/connector|\bline\b|arrow/i.test(title)) {
        const p = Array.from(g.querySelectorAll("path,line,polyline")).map(endsOf).find(Boolean);
        if (p) links.push({ p, text: label });
        return;
      }
      const r = R(g); if (!r.w && !r.h) return;
      nodes.push({ id: "v" + i, title: title.replace(/\.\d+$/, ""), label, data, ...r });
    });
  } else {
    // any SVG: labels -> the closest enclosing group or shape box; stray lines/paths -> connections
    const all = R(svg), area = Math.max(1, all.w * all.h);
    const boxes = new Map<Element, { r: Box; lines: string[]; el: Element | null }>();
    Array.from(svg.querySelectorAll("text")).forEach((t) => {
      if (t.parentElement?.closest("text")) return;
      const tr = R(t); if (!tr.w) return;
      const c = { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 };
      let box: { el: Element; r: Box } | null = null, el: Element | null = t.parentElement;
      while (el && el !== svg) {
        if (el.localName === "g") {
          const r = R(el), hasShape = el.querySelector("rect,ellipse,circle,polygon,image,use,path");
          if (hasShape && r.w * r.h < area * 0.2 && r.w * r.h > tr.w * tr.h * 1.05) { box = { el, r }; break; }
          if (r.w * r.h >= area * 0.2) break;
        }
        el = el.parentElement;
      }
      if (!box) {
        let best: { el: Element; r: Box } | null = null;
        svg.querySelectorAll("rect,ellipse,circle,polygon,image,use").forEach((s) => {
          const r = R(s); if (r.w * r.h >= area * 0.2 || r.w * r.h <= tr.w * tr.h * 0.5) return;
          if (c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h && (!best || r.w * r.h < best.r.w * best.r.h)) best = { el: s, r };
        });
        box = best;
      }
      const key: Element = box ? box.el : t;
      if (!boxes.has(key)) boxes.set(key, { r: box ? box.r : tr, lines: [], el: box ? box.el : null });
      const tx = t.querySelectorAll("tspan").length ? Array.from(t.querySelectorAll("tspan")).map((s) => (s.textContent || "").trim()) : [(t.textContent || "").trim()];
      boxes.get(key)!.lines.push(...tx.filter(Boolean));
    });
    let i = 0;
    boxes.forEach((b) => {
      const label = b.lines.join("\n"); if (!label) return;
      const title = b.el && b.el.localName === "image" ? "" : "";
      nodes.push({ id: "s" + i++, title, label, data: {}, ...b.r, el: b.el });
    });
    const inNode = (el: Element) => nodes.some((n) => n.el && n.el !== el && n.el.contains(el));
    svg.querySelectorAll("line,polyline,path").forEach((el) => {
      if (inNode(el)) return;
      const p = endsOf(el); if (!p || !p[0] || !p[1]) return;
      if (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) < 15) return;
      links.push({ p, text: "" });
    });
    nodes.forEach((n) => delete n.el);
  }
  const all = R(svg), tol = Math.max(12, Math.hypot(all.w, all.h) * 0.02);
  const out: DiagramLink[] = [];
  links.forEach((l) => {
    const a = nearestNode(nodes, l.p[0]!, tol), b = nearestNode(nodes, l.p[1]!, tol);
    if (a && b && a !== b) out.push({ a, b, text: l.text });
  });
  return { source, nodes, links: out, yUp: false };
}
