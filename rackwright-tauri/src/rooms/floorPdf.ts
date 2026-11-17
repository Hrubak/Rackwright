// Floor plan PDF: one Letter landscape page with the room name as the title. Light palette, vector output.
import { createElement } from "react";
import { backend } from "../backend";
import { withRendered, fixColors } from "../export/svg";
import { safeName } from "../export/data";
import { LIGHT, resolveSvgVars } from "../theme";
import type { Doc } from "../types";
import type { Units } from "../settings/types";
import { FloorPlan } from "./FloorPlan";
import type { Room } from "./types";

const PAGE_W = 792, PAGE_H = 612, MARGIN = 36, HEAD_H = 34;

export async function exportFloorPdf(room: Room, docs: Record<string, Doc | string>, units: Units, siteName: string): Promise<boolean> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  pdf.setTextColor(30, 30, 30);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text(room.name, MARGIN, MARGIN + 12);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(90, 90, 90);
  pdf.text(siteName, PAGE_W - MARGIN, MARGIN + 12, { align: "right" });
  pdf.text(new Date().toISOString().slice(0, 10), PAGE_W - MARGIN, MARGIN + 25, { align: "right" });
  pdf.setDrawColor(190, 190, 190); pdf.line(MARGIN, MARGIN + HEAD_H - 4, PAGE_W - MARGIN, MARGIN + HEAD_H - 4);

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:1600px;height:1200px;overflow:hidden;pointer-events:none";
  document.body.appendChild(host);
  try {
    const el = createElement(FloorPlan, { room, docs, units, onChange: () => {}, onOpenRack: () => {}, onSelect: () => {}, selected: null });
    const { svg, w, h } = await withRendered(el, host, (live) => {
      const svg = live.cloneNode(true) as SVGSVGElement;
      const vb = svg.viewBox.baseVal;
      svg.removeAttribute("style");
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      for (const [k, val] of Object.entries({ x: "0", y: "0", width: String(vb.width), height: String(vb.height), fill: LIGHT.bg })) bg.setAttribute(k, val);
      svg.insertBefore(bg, svg.firstChild);
      resolveSvgVars(svg, LIGHT);
      fixColors(svg);
      return { svg, w: vb.width, h: vb.height };
    });
    host.appendChild(svg); // svg2pdf needs the element to be in the document
    const availW = PAGE_W - 2 * MARGIN, availH = PAGE_H - 2 * MARGIN - HEAD_H;
    const s = Math.min(availW / w, availH / h);
    await svg2pdf(svg, pdf, { x: MARGIN + (availW - w * s) / 2, y: MARGIN + HEAD_H + (availH - h * s) / 2, width: w * s, height: h * s });
  } finally {
    host.remove();
  }
  return backend.saveBytes(`${safeName(room.name)}.pdf`, "application/pdf", new Uint8Array(pdf.output("arraybuffer")));
}
