// Packaging for the Word export: opens a .docx template with jszip, fills its markers, adds the report body
// and pictures, and returns a valid .docx. Pure TypeScript: no DOM, no backend.
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import type { ReportModel } from "./model";
import { markerValues, replaceMarkers, scanMarkers } from "./docxMarkers";
import { buildBodyXml, pageBox, styleIds, type BodyPic, type PageBox } from "./docxBody";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const NOT_WORD = "This file isn't a Word document.";
const NOTE_SHARED = "The {{RACKWRIGHT}} marker shared a paragraph with other text. That paragraph was replaced by the report.";
const NOTE_MISSING = "The template has no {{RACKWRIGHT}} marker, so the report was added at the end.";
const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const NS: [string, string][] = [
  ["w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main"],
  ["r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"],
  ["wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"],
  ["a", "http://schemas.openxmlformats.org/drawingml/2006/main"],
  ["pic", "http://schemas.openxmlformats.org/drawingml/2006/picture"],
];
const RELS_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

async function open(bytes: Uint8Array): Promise<JSZip | null> {
  try { return await JSZip.loadAsync(bytes); } catch { return null; }
}

/** null when usable; else a message. Not a zip, no word/document.xml, or document.xml is not well-formed XML. */
export async function checkDocxTemplate(bytes: Uint8Array): Promise<string | null> {
  const z = await open(bytes);
  const f = z?.file("word/document.xml");
  if (!z || !f) return NOT_WORD;
  try { return XMLValidator.validate(await f.async("string")) === true ? null : NOT_WORD; } catch { return NOT_WORD; }
}

/** Minimal valid .docx with the report markers and a few styles. */
export async function blankTemplate(): Promise<Uint8Array> {
  const W = NS[0][1];
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  z.file("_rels/.rels", `${RELS_HEAD}<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/_rels/document.xml.rels", `${RELS_HEAD}<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  const style = (type: string, id: string, name: string, extra = "", def = "") =>
    `<w:style w:type="${type}"${def} w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;
  z.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
    style("paragraph", "Normal", "Normal", "<w:qFormat/>", ' w:default="1"') +
    style("paragraph", "Title", "Title", `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr>`) +
    style("paragraph", "Heading1", "heading 1", `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr>`) +
    style("paragraph", "Heading2", "heading 2", `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr>`) +
    style("table", "TableGrid", "Table Grid", `<w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>`) +
    `</w:styles>`);
  const p = (t: string, style = "") => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
    p("{{REPORT_TITLE}}", "Title") + p("Prepared for {{PREPARED_FOR}}") + p("Prepared by {{PREPARED_BY}}") + p("{{DATE}}") +
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` + p("{{RACKWRIGHT}}") +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function templatePage(template: Uint8Array): Promise<PageBox> {
  const z = await open(template);
  const xml = await z?.file("word/document.xml")?.async("string");
  return pageBox(xml ?? "");
}

export interface DocxPicture { key: string; png: Uint8Array; wPx: number; hPx: number; dpi: number }

const EMU_IN = 914400;

function addNamespaces(xml: string): string {
  const m = /<w:document\b[^>]*>/.exec(xml);
  if (!m) return xml;
  const add = NS.filter(([p]) => !new RegExp(`\\sxmlns:${p}=`).test(m[0])).map(([p, u]) => ` xmlns:${p}="${u}"`).join("");
  if (!add) return xml;
  const tag = m[0].replace(/(\/?>)$/, `${add}$1`);
  return xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
}

export async function buildDocx(input: { template: Uint8Array; model: ReportModel; pictures: DocxPicture[] }): Promise<{ bytes: Uint8Array; notes: string[] }> {
  const { model, pictures } = input;
  const zip = await JSZip.loadAsync(input.template);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (docXml === undefined) throw new Error(NOT_WORD);
  const notes: string[] = [];

  const found = scanMarkers(docXml);
  const styles = styleIds(await zip.file("word/styles.xml")?.async("string"));
  const box = pageBox(docXml);

  // Highest drawing id across every part that can hold one.
  const idParts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  let maxId = 0;
  for (const n of idParts) {
    const xml = n === "word/document.xml" ? docXml : await zip.file(n)!.async("string");
    for (const m of xml.matchAll(/<(?:\w+:)?docPr\b[^>]*?\sid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  }

  // Pictures: media parts and relationships.
  const relsPath = "word/_rels/document.xml.rels";
  let rels = await zip.file(relsPath)?.async("string");
  const hadRels = rels !== undefined;
  const usedRel = new Set([...(rels ?? "").matchAll(/\bId="([^"]*)"/g)].map((m) => m[1]));
  const pics = new Map<string, BodyPic>();
  const relXml: string[] = [];
  let n = 0;
  for (const pic of pictures) {
    let name: string;
    do { n++; name = `word/media/rackwright-${n}.png`; } while (zip.file(name));
    let id = n;
    while (usedRel.has(`rIdRw${id}`)) id++;
    const relId = `rIdRw${id}`;
    usedRel.add(relId);
    zip.file(name, pic.png, { compression: "DEFLATE" });
    relXml.push(`<Relationship Id="${relId}" Type="${REL_IMAGE}" Target="${name.slice(5)}"/>`);
    let w = (pic.wPx / pic.dpi) * EMU_IN, h = (pic.hPx / pic.dpi) * EMU_IN;
    const k = Math.min(1, box.textWidthEmu / w, box.textHeightEmu / h);
    if (k < 1) { w *= k; h *= k; }
    pics.set(pic.key, { relId, docPrId: ++maxId, wEmu: Math.round(w), hEmu: Math.round(h), name: `Rackwright ${n}` });
  }
  if (relXml.length) {
    const add = relXml.join("");
    rels = hadRels ? rels!.replace(/<\/Relationships>\s*$/, `${add}</Relationships>`) : `${RELS_HEAD}${add}</Relationships>`;
    zip.file(relsPath, rels);
    const ct = await zip.file("[Content_Types].xml")?.async("string");
    if (ct !== undefined && !/<Default\b[^>]*\bExtension="png"/i.test(ct)) {
      zip.file("[Content_Types].xml", ct.replace(/<\/Types>\s*$/, `<Default Extension="png" ContentType="image/png"/></Types>`));
    }
  }

  const body = buildBodyXml(model, pics, { styles, skipSummary: found.has("SUMMARY"), skipRecommendations: found.has("RECOMMENDATIONS") });
  const values = markerValues(model);
  const res = replaceMarkers(docXml, values, body);
  if (res.rackwright === "shared") notes.push(NOTE_SHARED);
  else if (res.rackwright === "missing") notes.push(NOTE_MISSING);
  zip.file("word/document.xml", addNamespaces(res.xml));

  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    const out = replaceMarkers(xml, values).xml;
    if (out !== xml) zip.file(name, out);
  }

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, notes };
}

