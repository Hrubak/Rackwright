// Report body for the Word export: WordprocessingML paragraphs and tables built from the report model.
// Pure TypeScript: no DOM, no backend. Pictures arrive already added to the package (see BodyPic).
import { groupInfo } from "../attention/model";
import { fmtW } from "../power/model";
import type { ReportModel, SiteSection } from "./model";
import { xmlText } from "./docxMarkers";

export interface BodyStyles { h1?: string; h2?: string; title?: string; table?: string }
export interface PageBox { textWidthEmu: number; textHeightEmu: number }
export interface BodyPic { relId: string; docPrId: number; wEmu: number; hEmu: number; name: string }
export interface BodyOptions { styles: BodyStyles; skipSummary: boolean; skipRecommendations: boolean; skip?: Set<string> }

export const picKey = {
  links: "links",
  infra: (rackKey: string) => `infra:${rackKey}`,
  face: (rackKey: string, face: "front" | "rear") => `face:${rackKey}:${face}`,
};

const NO_DIAGRAM = "This diagram could not be drawn.";
const GREY = "666666"; // theme-ok (Word report text colour)
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="(-?\\d+)"`).exec(tag)?.[1];

/** Ids of the paragraph styles named "heading 1", "heading 2", "Title" and the table style named "Table Grid". */
export function styleIds(stylesXml: string | undefined): BodyStyles {
  const out: BodyStyles = {};
  if (!stylesXml) return out;
  for (const m of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const type = /\bw:type="([^"]*)"/.exec(m[1])?.[1], id = /\bw:styleId="([^"]*)"/.exec(m[1])?.[1];
    const name = /<w:name\s+w:val="([^"]*)"/.exec(m[2])?.[1]?.toLowerCase();
    if (!id || !name) continue;
    if (type === "paragraph") {
      if (name === "heading 1") out.h1 ??= id;
      else if (name === "heading 2") out.h2 ??= id;
      else if (name === "title") out.title ??= id;
    } else if (type === "table" && name === "table grid") out.table ??= id;
  }
  return out;
}

/** Text area of the body-level section (page size minus margins), in EMU. Falls back to 6.5 x 9 in. */
export function pageBox(documentXml: string): PageBox {
  const fallback = { textWidthEmu: 5943600, textHeightEmu: 8229600 };
  const end = documentXml.lastIndexOf("</w:body>");
  const start = end < 0 ? -1 : documentXml.lastIndexOf("<w:sectPr", end);
  if (start < 0) return fallback;
  const close = documentXml.indexOf("</w:sectPr>", start);
  if (close < 0 || documentXml.slice(close + 11, end).trim() !== "") return fallback;
  const sect = documentXml.slice(start, close);
  const sz = /<w:pgSz\b[^>]*>/.exec(sect)?.[0] ?? "", mar = /<w:pgMar\b[^>]*>/.exec(sect)?.[0] ?? "";
  const [w, h, l, r, t, b] = [attr(sz, "w:w"), attr(sz, "w:h"), attr(mar, "w:left"), attr(mar, "w:right"), attr(mar, "w:top"), attr(mar, "w:bottom")].map((v) => (v === undefined ? NaN : +v));
  const tw = w - l - r, th = h - t - b;
  if (!(tw > 0) || !(th > 0)) return fallback;
  return { textWidthEmu: tw * 635, textHeightEmu: th * 635 };
}

const run = (text: string, o: { bold?: boolean; sz?: number; color?: string } = {}) => {
  const pr = (o.bold ? "<w:b/>" : "") + (o.color ? `<w:color w:val="${o.color}"/>` : "") + (o.sz ? `<w:sz w:val="${o.sz}"/>` : "");
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
};
/** One paragraph per line of text. */
const paras = (text: string, o: { bold?: boolean; color?: string } = {}) =>
  text.replace(/\r/g, "").split("\n").map((l) => (l.trim() ? `<w:p>${run(l, o)}</w:p>` : "<w:p/>")).join("");
const PAGE_BREAK = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

function picture(pics: Map<string, BodyPic>, key: string, skip?: Set<string>): string {
  const b = pics.get(key);
  if (!b && skip?.has(key)) return "";
  if (!b) return paras(NO_DIAGRAM, { color: GREY });
  const cx = Math.round(b.wEmu), cy = Math.round(b.hEmu), nm = xmlText(b.name);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${b.docPrId}" name="${nm}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${b.docPrId}" name="${nm}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${xmlText(b.relId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export function buildBodyXml(model: ReportModel, pics: Map<string, BodyPic>, opt: BodyOptions): string {
  const { styles } = opt;
  const heading = (level: 1 | 2, text: string) => {
    const id = level === 1 ? styles.h1 : styles.h2;
    if (id) return `<w:p><w:pPr><w:pStyle w:val="${xmlText(id)}"/><w:keepNext/></w:pPr>${run(text)}</w:p>`;
    return `<w:p><w:pPr><w:keepNext/></w:pPr>${run(text, { bold: true, sz: level === 1 ? 32 : 26 })}</w:p>`;
  };
  const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  /** frac: share of the text width the table takes. A blank paragraph follows so neighbouring tables do not merge. */
  const table = (cols: { head: string; w: number }[], rows: string[][], frac = 1) => {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const pct = cols.map((c) => Math.round((c.w / total) * 5000 * frac));
    const tw = cols.map((c) => Math.round((c.w / total) * 9000 * frac));
    const pr = (styles.table ? `<w:tblStyle w:val="${xmlText(styles.table)}"/>` : "") + `<w:tblW w:type="pct" w:w="${Math.round(5000 * frac)}"/>` +
      (styles.table ? "" : `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>`) + `<w:tblLook w:val="04A0" w:firstRow="1"/>`;
    const cell = (text: string, k: number, bold: boolean) =>
      `<w:tc><w:tcPr><w:tcW w:type="pct" w:w="${pct[k]}"/></w:tcPr>${text ? `<w:p>${run(text, { bold, sz: 18 })}</w:p>` : "<w:p/>"}</w:tc>`;
    return `<w:tbl><w:tblPr>${pr}</w:tblPr><w:tblGrid>${tw.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cols.map((c, k) => cell(c.head, k, true)).join("")}</w:tr>` +
      rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cols.map((_c, k) => cell(r[k] ?? "", k, false)).join("")}</w:tr>`).join("") +
      `</w:tbl><w:p/>`;
  };

  const out: string[] = [];
  if (!opt.skipSummary && model.summary.trim()) out.push(heading(1, "Executive summary"), paras(model.summary));
  out.push(heading(1, "Totals"));
  const t = model.totals;
  out.push(table([{ head: "Measure", w: 2 }, { head: "Total", w: 1 }], [
    ["Sites", String(t.sites)], ["Racks", String(t.racks)], ["U used / total", `${t.usedU} / ${t.totalU}`], ["Devices", String(t.devices)],
  ], 0.5));
  if (t.byType.length) out.push(table([{ head: "Devices by type", w: 2 }, { head: "Count", w: 1 }], t.byType.map(([k, n]) => [k || "Other", String(n)]), 0.5));

  out.push(heading(1, "Needs attention"));
  {
    const { shown, staleRacks } = groupInfo(model.attention);
    const LV = { critical: "Critical", warning: "Warning", info: "Info" } as const;
    const rows = shown.map((a) => [LV[a.level], a.rackName && a.devName ? `${a.rackName} › ${a.devName}` : a.devName ?? a.rackName ?? "", a.msg]);
    if (staleRacks) rows.push([LV.info, "", `${staleRacks} ${staleRacks === 1 ? "rack" : "racks"} not checked on site in 90 days`]);
    out.push(rows.length ? table([{ head: "Level", w: 1 }, { head: "Where", w: 2.4 }, { head: "Issue", w: 4 }], rows) : paras("Nothing needs attention."));
  }

  if (model.links.length) out.push(heading(1, "Site links"), picture(pics, picKey.links, opt.skip));

  const detailed = model.level === "detailed";
  const siteBlock = (s: SiteSection) => {
    out.push(PAGE_BREAK, heading(1, s.name || "Site"));
    if (s.address) out.push(paras(s.address, { color: GREY }));
    if (!s.racks.length) { out.push(paras("No racks in this site.")); return; }
    const infra = s.racks.filter((r) => r.doc && r.doc.devices.length > 0);
    if (infra.length) {
      out.push(heading(2, "Infrastructure"));
      for (const r of infra) {
        if (infra.length > 1) out.push(paras(r.name, { bold: true, color: GREY }));
        out.push(picture(pics, picKey.infra(r.key), opt.skip));
      }
    }
    for (const r of s.racks) {
      if (!r.doc) { out.push(paras(`Could not load ${r.name}.`)); continue; }
      for (const face of detailed ? (["front", "rear"] as const) : (["front"] as const)) {
        out.push(heading(2, `${r.name} - ${face} view`), picture(pics, picKey.face(r.key, face), opt.skip));
      }
    }
  };

  const migrationBlock = (m: NonNullable<SiteSection["migration"]>) => {
    out.push(heading(2, m.title), paras(m.clusterLine));
    out.push(table(m.capacity[0].map((head, i) => ({ head, w: i === 0 ? 1.8 : 1.2 })), m.capacity.slice(1)));
    out.push(paras(m.result, { bold: true }));
    if (detailed && m.vms.length) out.push(table([{ head: "VM", w: 2 }, { head: "Now on", w: 1.6 }, { head: "Platform", w: 1.5 }, { head: "vCPU", w: 0.8 }, { head: "RAM (GB)", w: 1 }, { head: "Disk (GB)", w: 1 }, { head: "Used (GB)", w: 1 }], m.vms));
  };

  for (const s of model.sites) {
    siteBlock(s);
    if (!detailed) { if (s.migration) migrationBlock(s.migration); continue; }
    for (const sw of s.switches) {
      const used = sw.ports.filter((p) => p.used);
      out.push(heading(2, `Switch ${sw.name}`), paras(`${used.length} of ${sw.ports.length} ports used`));
      if (used.length) out.push(table([{ head: "Port", w: 1.2 }, { head: "Connected to", w: 3 }, { head: "Type", w: 1.2 }, { head: "IP", w: 1.6 }], used.map((p) => [p.name, p.to, p.type, p.ip])));
    }
    if (s.devices.length) {
      out.push(heading(2, `Devices at ${s.name}`), table([{ head: "Name", w: 2.2 }, { head: "Type", w: 1.4 }, { head: "Model", w: 2.2 }, { head: "IP", w: 1.5 }, { head: "Where", w: 1.6 }], s.devices.map((d) => [d.name, d.type, d.model, d.ip, d.where])));
    }
    if (s.migration) migrationBlock(s.migration);
    const pw = model.power.filter((p) => p.siteId === s.id);
    if (pw.length) {
      out.push(heading(2, `Power at ${s.name}`), table([{ head: "Rack", w: 2 }, { head: "Power", w: 2.6 }, { head: "Circuit", w: 1.6 }, { head: "Amps", w: 1 }], pw.map((p) => [p.rack, fmtW(p.w, p.unknown), p.circuit, p.w > 0 ? String(p.amps) : ""])));
    }
  }

  if (!opt.skipRecommendations && model.recommendations.trim()) out.push(PAGE_BREAK, heading(1, "Recommendations"), paras(model.recommendations));

  if (detailed) {
    out.push(PAGE_BREAK, heading(1, "Full inventory"));
    out.push(model.inventory.length
      ? table([{ head: "Site", w: 1.5 }, { head: "Name", w: 2 }, { head: "Type", w: 1.2 }, { head: "Model", w: 2 }, { head: "IP", w: 1.4 }, { head: "Serial", w: 1.5 }, { head: "Where", w: 1.4 }],
        model.inventory.map((d) => [d.site, d.name, d.type, d.model, d.ip, d.serial, d.where]))
      : paras("No devices."));
    out.push(heading(1, "Links"));
    out.push(model.links.length
      ? table([{ head: "From", w: 1.6 }, { head: "To", w: 1.6 }, { head: "Kind", w: 1 }, { head: "Provider", w: 1.5 }, { head: "Circuit", w: 1.3 }, { head: "Bandwidth", w: 1.2 }],
        model.links.map((l) => [l.from, l.to, l.kind, l.provider, l.circuit, l.bandwidth]))
      : paras("No links."));
  }
  const xml = out.join("");
  return xml.endsWith("</w:p>") || xml.endsWith("<w:p/>") ? xml : xml + "<w:p/>";
}
