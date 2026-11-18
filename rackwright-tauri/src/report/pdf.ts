// Client report PDF: lays a ReportModel out page by page with jsPDF; diagrams are drawn offscreen and placed with svg2pdf.js.
import { groupInfo } from "../attention/model";
import { fmtW } from "../power/model";
import type { ReportModel, SiteSection } from "./model";
import type { Doc } from "../types";
import { LIGHT } from "../theme";
import { clearRackData, infraSvg, linksSvg, rackFaceSvg } from "./diagrams";

export interface ReportBrand {
  primary: string; secondary: string; address: string; company: string;
  logo?: Blob; cover?: Blob; header?: Blob; footer?: Blob;
  fontRegular?: ArrayBuffer; fontBold?: ArrayBuffer;
}

const PW = 612, PH = 792, M = 54, CW = PW - 2 * M;
const DEFAULT_PRIMARY = "#2a6fdb"; // theme-ok
const DEFAULT_SECONDARY = "#1f2328"; // theme-ok
const FAMILY = "ReportFont";
const NO_DIAGRAM = "This diagram could not be drawn.";

type RGB = [number, number, number];
const rgb = (hex: string, fallback: string): RGB => {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
};
const mixWhite = (c: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(c[i] * (1 - t) + 255 * t)) as RGB;

function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Img { data: string; fmt: "PNG" | "JPEG"; w: number; h: number }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("Could not read the image"));
    im.src = url;
  });
}
const readUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(new Error("Could not read the image"));
  r.readAsDataURL(b);
});

/** PNG and JPEG go in as they are; SVG and anything else is rasterised to PNG at 2x. Returns undefined when it can't be read. */
async function prepImage(blob?: Blob): Promise<Img | undefined> {
  if (!blob) return undefined;
  try {
    const url = await readUrl(blob);
    const im = await loadImage(url);
    let w = im.naturalWidth, h = im.naturalHeight;
    if ((blob.type === "image/png" || blob.type === "image/jpeg") && w && h) {
      return { data: url, fmt: blob.type === "image/png" ? "PNG" : "JPEG", w, h };
    }
    if (!w || !h) { w = 600; h = 300; } // SVG without a size
    const c = document.createElement("canvas");
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext("2d");
    if (!g) return undefined;
    g.drawImage(im, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/png"), fmt: "PNG", w, h };
  } catch { return undefined; }
}

export async function buildReportPdf(model: ReportModel, brand: ReportBrand): Promise<Uint8Array> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter", compress: true });
  const primary = rgb(brand.primary, DEFAULT_PRIMARY), secondary = rgb(brand.secondary, DEFAULT_SECONDARY);
  const ink = rgb(LIGHT.text, DEFAULT_SECONDARY), grey = rgb(LIGHT["text-muted"], DEFAULT_SECONDARY);
  const rule = rgb(LIGHT["border-subtle"], DEFAULT_SECONDARY), band = rgb(LIGHT["panel-2"], DEFAULT_SECONDARY);

  // Fonts: uploaded ones when they load, else the bundled Noto Sans.
  const addFonts = (reg: ArrayBuffer, bold: ArrayBuffer) => {
    pdf.addFileToVFS("report-regular.ttf", b64(reg)); pdf.addFont("report-regular.ttf", FAMILY, "normal");
    pdf.addFileToVFS("report-bold.ttf", b64(bold)); pdf.addFont("report-bold.ttf", FAMILY, "bold");
    pdf.setFont(FAMILY, "normal"); pdf.getTextWidth("Ae"); // throws now rather than mid-report when a file is not a usable font
    pdf.setFont(FAMILY, "bold"); pdf.getTextWidth("Ae");
  };
  const bundled = async () => {
    const [r, b] = await Promise.all([
      import("@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url"),
      import("@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url"),
    ]);
    const get = async (u: string) => (await fetch(u)).arrayBuffer();
    return [await get(r.default), await get(b.default)] as const;
  };
  let fontsDone = false;
  if (brand.fontRegular) {
    try { addFonts(brand.fontRegular, brand.fontBold ?? brand.fontRegular); fontsDone = true; } catch { /* use the bundled font */ }
  }
  if (!fontsDone) { const [r, b] = await bundled(); addFonts(r, b); }

  const [logo, cover, headerArt, footerArt] = await Promise.all([prepImage(brand.logo), prepImage(brand.cover), prepImage(brand.header), prepImage(brand.footer)]);

  // Header and footer artwork are full-width bands at the page edges (at most 110 / 80 pt tall, aspect kept); the text area sits between them.
  const artBand = (a: typeof headerArt, max: number) => { if (!a) return null; const h = Math.min(PW * a.h / a.w, max); const w = h * a.w / a.h; return { w, h, x: (PW - w) / 2 }; };
  const hb = artBand(headerArt, 110), fb = artBand(footerArt, 80);
  const TOP = hb ? Math.max(M, hb.h + 22) : M;
  const FOOT_TEXT = fb ? PH - fb.h - 10 : PH - 20;
  const BOTTOM = fb ? Math.min(PH - M, FOOT_TEXT - 18) : PH - M;
  let y = M;
  const newPage = () => { pdf.addPage("letter", "portrait"); y = TOP; };
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage(); };
  const setText = (size: number, bold: boolean, c: RGB) => { pdf.setFont(FAMILY, bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(c[0], c[1], c[2]); };
  const fitText = (s: string, w: number) => {
    if (pdf.getTextWidth(s) <= w) return s;
    let t = s;
    while (t.length > 1 && pdf.getTextWidth(t + "…") > w) t = t.slice(0, -1);
    return t + "…";
  };

  const h1 = (s: string) => { ensure(60); y += 6; setText(16, true, primary); pdf.text(s, M, y + 12); y += 26; };
  const h2 = (s: string, keep = 40) => { ensure(keep); setText(12.5, true, secondary); pdf.text(fitText(s, CW), M, y + 10); y += 20; };
  const paragraph = (text: string, size = 10, c: RGB = ink) => {
    setText(size, false, c);
    const lh = size * 1.4;
    for (const para of text.replace(/\r/g, "").split("\n")) {
      if (!para.trim()) { y += lh * 0.6; continue; }
      for (const line of pdf.splitTextToSize(para, CW) as string[]) { ensure(lh); pdf.text(line, M, y + size); y += lh; }
      y += 2;
    }
    y += 4;
  };

  const RH = 14;
  /** Header row repeats on each new page; cell text is clipped with an ellipsis. */
  const table = (cols: { head: string; w: number }[], rows: string[][], width = CW) => {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const ws = cols.map((c) => (c.w / total) * width);
    const head = () => {
      ensure(RH * 2);
      pdf.setFillColor(band[0], band[1], band[2]); pdf.rect(M, y, width, RH, "F");
      setText(8.5, true, ink);
      let x = M; cols.forEach((c, k) => { pdf.text(fitText(c.head, ws[k] - 6), x + 3, y + 10); x += ws[k]; });
      y += RH;
    };
    head();
    rows.forEach((r, i) => {
      if (y + RH > BOTTOM) { newPage(); head(); }
      if (i % 2) { pdf.setFillColor(248, 249, 250); pdf.rect(M, y, width, RH, "F"); }
      setText(8.5, false, ink);
      let x = M; cols.forEach((_c, k) => { pdf.text(fitText(r[k] ?? "", ws[k] - 6), x + 3, y + 10); x += ws[k]; });
      y += RH;
    });
    pdf.setDrawColor(rule[0], rule[1], rule[2]); pdf.line(M, y, M + width, y);
    y += 10;
  };

  // Offscreen diagrams
  let host: HTMLElement | null = null;
  const getHost = () => {
    if (!host) {
      host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-100000px;top:0;width:1600px;height:1200px;overflow:hidden;pointer-events:none";
      document.body.appendChild(host);
    }
    return host;
  };
  const place = async (svg: SVGSVGElement, w: number, h: number, minH = 0) => {
    for (const t of Array.from(svg.querySelectorAll("text"))) {
      t.setAttribute("font-family", FAMILY);
      const st = t.getAttribute("style");
      if (st) t.setAttribute("style", st.replace(/font-family:[^;]*;?/g, ""));
    }
    svg.setAttribute("font-family", FAMILY);
    if (y + Math.max(minH, 120) > BOTTOM) newPage();
    const availH = BOTTOM - y;
    const s = Math.min(CW / w, availH / h);
    getHost().appendChild(svg); // svg2pdf needs the element to be in the document
    try { await svg2pdf(svg, pdf, { x: M + (CW - w * s) / 2, y, width: w * s, height: h * s }); } finally { svg.remove(); }
    y += h * s + 12;
  };
  const noDiagram = () => paragraph(NO_DIAGRAM, 10, grey);

  clearRackData();

  try {
    // ---- Cover ----
    let cy = 0;
    if (cover) {
      const s = Math.min(PW / cover.w, (PH * 0.4) / cover.h), w = cover.w * s, h = cover.h * s;
      pdf.addImage(cover.data, cover.fmt, (PW - w) / 2, 0, w, h, "cover", "FAST"); cy = h;
    }
    cy += 48;
    if (logo) {
      const s = Math.min(1, 48 / logo.h, CW / logo.w), w = logo.w * s, h = logo.h * s;
      pdf.addImage(logo.data, logo.fmt, M, cy, w, h, "logo", "FAST"); cy += h + 28;
    }
    setText(26, true, primary);
    for (const line of pdf.splitTextToSize(model.title, CW) as string[]) { pdf.text(line, M, cy + 26); cy += 32; }
    cy += 14;
    setText(12, false, secondary);
    const by = model.preparedBy || brand.company;
    const meta = [model.preparedFor && `Prepared for ${model.preparedFor}`, by && `Prepared by ${by}`, model.date].filter(Boolean) as string[];
    for (const l of meta) { pdf.text(l, M, cy + 12); cy += 20; }

    // ---- Overview ----
    newPage();
    if (model.summary.trim()) { h1("Executive summary"); paragraph(model.summary); }
    h1("Totals");
    const t = model.totals;
    table([{ head: "Measure", w: 2 }, { head: "Total", w: 1 }], [
      ["Sites", String(t.sites)], ["Racks", String(t.racks)], ["U used / total", `${t.usedU} / ${t.totalU}`], ["Devices", String(t.devices)],
    ], 260);
    if (t.byType.length) table([{ head: "Devices by type", w: 2 }, { head: "Count", w: 1 }], t.byType.map(([k, n]) => [k || "Other", String(n)]), 260);

    h1("Needs attention");
    {
      const { shown, staleRacks } = groupInfo(model.attention);
      const LV = { critical: "Critical", warning: "Warning", info: "Info" } as const;
      const rows = shown.map((a) => [LV[a.level], a.rackName && a.devName ? `${a.rackName} › ${a.devName}` : a.devName ?? a.rackName ?? "", a.msg]);
      if (staleRacks) rows.push([LV.info, "", `${staleRacks} ${staleRacks === 1 ? "rack" : "racks"} not checked on site in 90 days`]);
      if (rows.length) table([{ head: "Level", w: 1 }, { head: "Where", w: 2.4 }, { head: "Issue", w: 4 }], rows);
      else paragraph("Nothing needs attention.");
    }

    if (model.links.length) {
      h1("Site links");
      try {
        const r = await linksSvg(model, getHost());
        if (r) await place(r.svg, r.w, r.h);
      } catch { noDiagram(); }
    }

    const siteBlock = async (s: SiteSection) => {
      newPage();
      h1(s.name || "Site");
      if (s.address) paragraph(s.address, 10, grey);
      if (!s.racks.length) { paragraph("No racks in this site."); return; }
      const infraDocs = s.racks.filter((r) => r.doc && r.doc.devices.length > 0);
      if (infraDocs.length) {
        h2("Infrastructure");
        for (const r of infraDocs) {
          if (infraDocs.length > 1) { setText(9.5, true, grey); ensure(16); pdf.text(r.name, M, y + 9); y += 14; }
          try {
            const res = await infraSvg(r.doc!, getHost());
            if (!res) continue;
            await place(res.svg, res.w, res.h, 200);
          } catch { noDiagram(); }
        }
      }
      for (const r of s.racks) {
        if (!r.doc) { newPage(); paragraph(`Could not load ${r.name}.`); continue; }
        for (const face of model.level === "detailed" ? (["front", "rear"] as const) : (["front"] as const)) {
          newPage();
          h2(`${r.name} - ${face} view`);
          try {
            const f = await rackFaceSvg(r.key, r.doc, face, getHost());
            await place(f.svg, f.w, f.h);
          } catch { noDiagram(); }
        }
      }
    };

    for (const s of model.sites) {
      await siteBlock(s);
      if (model.level !== "detailed") continue;
      // Switch port maps: 18 x 14 pt boxes, then a table of the used ports.
      const BWd = 18, BHt = 14, GAP = 2;
      for (const sw of s.switches) {
        h2(`Switch ${sw.name}`, 70);
        const perRow = Math.max(1, Math.floor((CW + GAP) / (BWd + GAP)));
        ensure(BHt + GAP);
        const tint = mixWhite(primary, 0.75);
        sw.ports.forEach((p, i) => {
          const col = i % perRow;
          if (col === 0 && i > 0) { y += BHt + GAP; ensure(BHt + GAP); }
          const x = M + col * (BWd + GAP);
          const c = p.used ? tint : band;
          pdf.setFillColor(c[0], c[1], c[2]); pdf.setDrawColor(rule[0], rule[1], rule[2]); pdf.rect(x, y, BWd, BHt, "FD");
          setText(5, false, ink);
          let label = p.name;
          if (pdf.getTextWidth(label) > BWd - 2) label = p.name.match(/\d+$/)?.[0] ?? p.name;
          pdf.text(fitText(label, BWd - 2), x + BWd / 2, y + 9, { align: "center" });
        });
        y += BHt + 12;
        const used = sw.ports.filter((p) => p.used);
        if (used.length) table([{ head: "Port", w: 1.2 }, { head: "Connected to", w: 3 }, { head: "Type", w: 1.2 }, { head: "IP", w: 1.6 }], used.map((p) => [p.name, p.to, p.type, p.ip]));
      }
      if (s.devices.length) {
        h2(`Devices at ${s.name}`, 60);
        table([{ head: "Name", w: 2.2 }, { head: "Type", w: 1.4 }, { head: "Model", w: 2.2 }, { head: "IP", w: 1.5 }, { head: "Where", w: 1.6 }], s.devices.map((d) => [d.name, d.type, d.model, d.ip, d.where]));
      }
      const pw = model.power.filter((p) => p.siteId === s.id);
      if (pw.length) {
        h2(`Power at ${s.name}`, 60);
        table([{ head: "Rack", w: 2 }, { head: "Power", w: 2.6 }, { head: "Circuit", w: 1.6 }, { head: "Amps", w: 1 }], pw.map((p) => [p.rack, fmtW(p.w, p.unknown), p.circuit, p.w > 0 ? String(p.amps) : ""]));
      }
    }

    if (model.recommendations.trim()) { newPage(); h1("Recommendations"); paragraph(model.recommendations); }

    if (model.level === "detailed") {
      newPage();
      h1("Full inventory");
      if (model.inventory.length) table([{ head: "Site", w: 1.5 }, { head: "Name", w: 2 }, { head: "Type", w: 1.2 }, { head: "Model", w: 2 }, { head: "IP", w: 1.4 }, { head: "Serial", w: 1.5 }, { head: "Where", w: 1.4 }],
        model.inventory.map((d) => [d.site, d.name, d.type, d.model, d.ip, d.serial, d.where]));
      else paragraph("No devices.");
      h1("Links");
      if (model.links.length) table([{ head: "From", w: 1.6 }, { head: "To", w: 1.6 }, { head: "Kind", w: 1 }, { head: "Provider", w: 1.5 }, { head: "Circuit", w: 1.3 }, { head: "Bandwidth", w: 1.2 }],
        model.links.map((l) => [l.from, l.to, l.kind, l.provider, l.circuit, l.bandwidth]));
      else paragraph("No links.");
    }
  } finally {
    (host as HTMLElement | null)?.remove();
  }

  // ---- Page furniture, every page except the cover ----
  const n = pdf.getNumberOfPages();
  for (let p = 2; p <= n; p++) {
    pdf.setPage(p);
    if (headerArt && hb) pdf.addImage(headerArt.data, headerArt.fmt, hb.x, 0, hb.w, hb.h, "header", "FAST");
    if (footerArt && fb) pdf.addImage(footerArt.data, footerArt.fmt, fb.x, PH - fb.h, fb.w, fb.h, "footer", "FAST");
    setText(8.5, false, grey);
    if (brand.address) pdf.text(fitText(brand.address, CW - 90), M, FOOT_TEXT);
    pdf.text(`Page ${p} of ${n}`, PW - M, FOOT_TEXT, { align: "right" });
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
