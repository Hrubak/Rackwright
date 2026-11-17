// Offscreen SVG helpers shared by the rack PDF and the client report.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createElement } from "react";
import type { ReactElement } from "react";
import RackView from "../RackView";
import { LIGHT, resolveSvgVars } from "../theme";
import { Doc } from "../types";
import { Bounds, ExportData, Face, contentBounds } from "./data";

const SVG_NS = "http://www.w3.org/2000/svg";
const BG = LIGHT.panel; // white page

/** Render a React element into a hidden container, hand its first <svg> to `use`, then unmount. */
export async function withRendered<T>(element: ReactElement, host: HTMLElement, use: (live: SVGSVGElement, slot: HTMLElement) => T | Promise<T>): Promise<T> {
  const slot = document.createElement("div");
  slot.style.cssText = "width:1600px;height:1200px;position:absolute;left:0;top:0";
  host.appendChild(slot);
  const root = createRoot(slot);
  try {
    flushSync(() => root.render(element));
    await new Promise((r) => setTimeout(r, 0));
    const live = slot.querySelector("svg");
    if (!live) throw new Error("Could not draw the diagram");
    return await use(live as SVGSVGElement, slot);
  } finally {
    flushSync(() => root.unmount());
    slot.remove();
  }
}

/** Standalone copy of a live SVG, fitted to `b` (content bounds in the pan/zoom group's coordinates) plus `pad`. */
export function svgOf(live: SVGSVGElement, b: Bounds, pad = 24): { svg: SVGSVGElement; w: number; h: number } {
  const w = Math.ceil(b.r - b.l + 2 * pad), h = Math.ceil(b.b - b.t + 2 * pad);
  const svg = live.cloneNode(true) as SVGSVGElement;
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w)); svg.setAttribute("height", String(h));
  svg.removeAttribute("style");
  const g = svg.querySelector(":scope > g") as SVGGElement; // the pan/zoom group: swap its transform for a fit-to-content one
  g.setAttribute("transform", `translate(${pad - b.l} ${pad - b.t})`);
  const bg = document.createElementNS(SVG_NS, "rect");
  for (const [k, v] of Object.entries({ x: "0", y: "0", width: String(w), height: String(h), fill: BG })) bg.setAttribute(k, v);
  svg.insertBefore(bg, svg.firstChild);
  resolveSvgVars(svg, LIGHT);
  fixColors(svg);
  return { svg, w, h };
}

/** Render RackView for one face into a hidden container and return a standalone, fitted copy of its SVG. */
export async function faceSvg(doc: Doc, data: ExportData, face: Face, host: HTMLElement): Promise<{ svg: SVGSVGElement; w: number; h: number }> {
  const routes = face === "front" ? data.front : data.rear;
  const el = createElement(RackView, {
    doc, face, routes, ports: data.ports, selected: null, onSelect: () => {}, pendingPort: null, onPort: () => {},
    onMoveDevice: () => {}, onReject: () => {}, drag: null, resolveRef: { current: () => ({ kind: "none" as const }) }, fitTick: 0,
  });
  return withRendered(el, host, (live) => svgOf(live, contentBounds(doc, routes, face)));
}

/** svg2pdf does not understand #rgba / #rrggbbaa; turn them into a 6-digit color plus an opacity attribute. */
export function fixColors(svg: SVGSVGElement) {
  for (const el of Array.from(svg.querySelectorAll("*"))) {
    for (const a of ["fill", "stroke"]) {
      const v = el.getAttribute(a);
      const m = v && /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(v);
      if (!m) continue;
      const h = m[1].length === 4 ? m[1].split("").map((c) => c + c).join("") : m[1];
      el.setAttribute(a, "#" + h.slice(0, 6));
      el.setAttribute(a + "-opacity", String(parseInt(h.slice(6, 8), 16) / 255));
    }
  }
  for (const t of Array.from(svg.querySelectorAll("title"))) t.remove();
}
