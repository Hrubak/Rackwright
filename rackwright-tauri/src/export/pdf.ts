// PDF export: Front view, Rear view, cable schedule, device list. Vector output via jsPDF + svg2pdf.js.
import { faceSvg } from "./svg";
import { Doc } from "../types";
import { CableRow, DeviceRow, ExportData, Face, cableRows, deviceRows, docTitle } from "./data";

const PAGE_W = 792, PAGE_H = 612, MARGIN = 36, HEAD_H = 34; // US Letter landscape, points

type Col<T> = { head: string; w: number; get: (r: T) => string };

export async function buildPdf(doc: Doc, data: ExportData, name?: string): Promise<Uint8Array> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const title = docTitle(doc, name);
  const date = new Date().toISOString().slice(0, 10);
  const contentW = PAGE_W - 2 * MARGIN;

  const header = (sub: string) => {
    pdf.setTextColor(30, 30, 30);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text(title, MARGIN, MARGIN + 12);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(90, 90, 90);
    pdf.text(sub, PAGE_W - MARGIN, MARGIN + 12, { align: "right" });
    pdf.text(date, PAGE_W - MARGIN, MARGIN + 25, { align: "right" });
    pdf.setDrawColor(190, 190, 190); pdf.line(MARGIN, MARGIN + HEAD_H - 4, PAGE_W - MARGIN, MARGIN + HEAD_H - 4);
  };

  // Views
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:1600px;height:1200px;overflow:hidden;pointer-events:none";
  document.body.appendChild(host);
  try {
    let first = true;
    for (const face of ["front", "rear"] as Face[]) {
      if (!first) pdf.addPage("letter", "landscape");
      first = false;
      header(`${face === "front" ? "Front" : "Rear"} view`);
      const { svg, w, h } = await faceSvg(doc, data, face, host);
      host.appendChild(svg); // svg2pdf needs the element to be in the document
      const availW = contentW, availH = PAGE_H - 2 * MARGIN - HEAD_H;
      const s = Math.min(availW / w, availH / h);
      await svg2pdf(svg, pdf, { x: MARGIN + (availW - w * s) / 2, y: MARGIN + HEAD_H + (availH - h * s) / 2, width: w * s, height: h * s });
      svg.remove();
    }
  } finally {
    host.remove();
  }

  // Tables
  const table = <T,>(heading: string, cols: Col<T>[], rows: T[], swatch?: (r: T) => string) => {
    const scale = contentW / cols.reduce((s, c) => s + c.w, 0);
    const widths = cols.map((c) => c.w * scale);
    const RH = 15;
    const fit = (s: string, w: number) => {
      if (pdf.getTextWidth(s) <= w - 6) return s;
      let t = s; while (t.length > 1 && pdf.getTextWidth(t + "...") > w - 6) t = t.slice(0, -1);
      return t + "...";
    };
    let page = 0, i = 0;
    do {
      pdf.addPage("letter", "landscape");
      page++;
      header(page === 1 ? heading : `${heading} (cont.)`);
      let y = MARGIN + HEAD_H + 6;
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(30, 30, 30);
      pdf.setFillColor(232, 234, 237); pdf.rect(MARGIN, y - 10, contentW, RH, "F");
      let x = MARGIN; cols.forEach((c, k) => { pdf.text(c.head, x + 3, y + 1); x += widths[k]; });
      y += RH; pdf.setFont("helvetica", "normal");
      while (i < rows.length && y < PAGE_H - MARGIN) {
        const r = rows[i];
        if (i % 2) { pdf.setFillColor(246, 247, 248); pdf.rect(MARGIN, y - 10, contentW, RH, "F"); }
        x = MARGIN;
        cols.forEach((c, k) => {
          let tx = x + 3;
          const sw = swatch && c.head === "Color" ? swatch(r) : "";
          if (sw && /^#[0-9a-f]{6}$/i.test(sw)) {
            pdf.setFillColor(parseInt(sw.slice(1, 3), 16), parseInt(sw.slice(3, 5), 16), parseInt(sw.slice(5, 7), 16));
            pdf.rect(tx, y - 7, 10, 8, "F"); tx += 14;
          }
          pdf.setTextColor(30, 30, 30);
          pdf.text(fit(c.get(r), widths[k] - (tx - x - 3)), tx, y + 1);
          x += widths[k];
        });
        y += RH; i++;
      }
    } while (i < rows.length);
  };

  table<CableRow>("Cable schedule", [
    { head: "Label", w: 14, get: (r) => r.label }, { head: "From (device:port)", w: 20, get: (r) => r.from },
    { head: "To (device:port)", w: 20, get: (r) => r.to }, { head: "Type", w: 9, get: (r) => r.type },
    { head: "Color", w: 10, get: (r) => r.color }, { head: "Length", w: 8, get: (r) => r.length },
  ], cableRows(doc), (r) => r.color);
  table<DeviceRow>("Device list", [
    { head: "Rack", w: 16, get: (r) => r.rack }, { head: "U", w: 7, get: (r) => r.u },
    { head: "Name", w: 22, get: (r) => r.name }, { head: "Model", w: 24, get: (r) => r.model }, { head: "Face", w: 8, get: (r) => r.face },
  ], deviceRows(doc));

  return new Uint8Array(pdf.output("arraybuffer"));
}
