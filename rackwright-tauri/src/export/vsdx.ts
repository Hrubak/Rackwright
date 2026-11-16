// Native Visio (.vsdx) export, built by hand (Visio 2013+ schema). Pages: Front, Rear, Logical.
// Units: Visio works in inches with the origin at the bottom left; the app works in px (96/in) with the origin top left.
import { Device, Doc } from "../types";
import { Bounds, ExportData, Face, contentBounds, devRect, docTitle, portInfo, rackBox, visibleOn } from "./data";

const NS = "http://schemas.microsoft.com/office/visio/2012/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.microsoft.com/visio/2010/relationships";
const PX = 96;
const PAD = 24; // px around the content

const esc = (s: string) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => String(Math.round(v * 1e5) / 1e5);
const hex = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : c && /^#[0-9a-f]{3}$/i.test(c) ? "#" + c.slice(1).split("").map((x) => x + x).join("") : fallback);
/** Pick black or white text for a background. */
const textOn = (bg: string) => { const v = parseInt(bg.slice(1), 16); return ((v >> 16) * 299 + ((v >> 8) & 255) * 587 + (v & 255) * 114) / 1000 > 140 ? "#101113" : "#ffffff"; };

interface Pt { x: number; y: number }
/** One drawing page: collects shapes with unique IDs, mapping app px to page inches. */
class Page {
  shapes: string[] = [];
  private id = 0;
  readonly wIn: number; readonly hIn: number;
  constructor(readonly name: string, private b: Bounds) {
    this.wIn = (b.r - b.l + 2 * PAD) / PX; this.hIn = (b.b - b.t + 2 * PAD) / PX;
  }
  /** px (app space) -> inches (page space, Y up). */
  X(x: number) { return (x - this.b.l + PAD) / PX; }
  Y(y: number) { return this.hIn - (y - this.b.t + PAD) / PX; }

  private xform(pinX: number, pinY: number, w: number, h: number) {
    return `<Cell N="PinX" V="${n(pinX)}"/><Cell N="PinY" V="${n(pinY)}"/><Cell N="Width" V="${n(w)}"/><Cell N="Height" V="${n(h)}"/>`
      + `<Cell N="LocPinX" V="${n(w / 2)}" F="Width*0.5"/><Cell N="LocPinY" V="${n(h / 2)}" F="Height*0.5"/><Cell N="Angle" V="0"/>`;
  }
  private text(txt: string, w: number, h: number, color: string, sizePt: number, bold: boolean, vAlign: number): [string, string] {
    if (!txt) return ["", ""];
    return [`<Cell N="VerticalAlign" V="${vAlign}"/><Cell N="TxtPinX" V="${n(w / 2)}" F="Width*0.5"/><Cell N="TxtPinY" V="${n(h / 2)}" F="Height*0.5"/>`
      + `<Cell N="TxtWidth" V="${n(w)}" F="Width*1"/><Cell N="TxtHeight" V="${n(h)}" F="Height*1"/>`
      + `<Cell N="TxtLocPinX" V="${n(w / 2)}" F="TxtWidth*0.5"/><Cell N="TxtLocPinY" V="${n(h / 2)}" F="TxtHeight*0.5"/><Cell N="TxtAngle" V="0"/>`
      + `<Section N="Character"><Row IX="0"><Cell N="Font" V="Calibri"/><Cell N="Color" V="${color}"/><Cell N="Style" V="${bold ? 1 : 0}"/><Cell N="Size" V="${n(sizePt / 72)}" U="PT"/></Row></Section>`, `<Text>${esc(txt)}</Text>`];
  }
  private open(label: string) {
    this.id++;
    return `<Shape ID="${this.id}" NameU="Sheet.${this.id}" Name="${esc(label.slice(0, 60)) || "Sheet." + this.id}" Type="Shape">`;
  }

  /** Rectangle from app px (l, t, w, h). */
  rect(label: string, l: number, t: number, w: number, h: number, fill: string, line: string, text: string, opt: { size?: number; top?: boolean; weight?: number } = {}) {
    const wi = w / PX, hi = h / PX;
    const pinX = this.X(l) + wi / 2, pinY = this.Y(t) - hi / 2;
    const [tx, tt] = this.text(text, wi, hi, textOn(fill), opt.size ?? 8, !opt.top, opt.top ? 0 : 1);
    this.shapes.push(
      this.open(label) + this.xform(pinX, pinY, wi, hi)
      + `<Cell N="FillForegnd" V="${fill}"/><Cell N="FillPattern" V="1"/><Cell N="LineColor" V="${line}"/><Cell N="LinePattern" V="1"/><Cell N="LineWeight" V="${n((opt.weight ?? 1) / PX)}"/>`
      + tx
      + `<Section N="Geometry" IX="0"><Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/><Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/>`
      + `<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>`
      + `<Row T="LineTo" IX="2"><Cell N="X" V="${n(wi)}" F="Width*1"/><Cell N="Y" V="0"/></Row>`
      + `<Row T="LineTo" IX="3"><Cell N="X" V="${n(wi)}" F="Width*1"/><Cell N="Y" V="${n(hi)}" F="Height*1"/></Row>`
      + `<Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="${n(hi)}" F="Height*1"/></Row>`
      + `<Row T="LineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>`
      + `</Section>${tt}</Shape>`);
  }

  /** Open polyline through app-px points. */
  line(label: string, pts: [number, number][], color: string, widthPx: number, dashed: boolean) {
    const P: Pt[] = pts.map((p) => ({ x: this.X(p[0]), y: this.Y(p[1]) }));
    const minX = Math.min(...P.map((p) => p.x)), minY = Math.min(...P.map((p) => p.y));
    const w = Math.max(0.001, Math.max(...P.map((p) => p.x)) - minX), h = Math.max(0.001, Math.max(...P.map((p) => p.y)) - minY);
    const rows = P.map((p, i) => `<Row T="${i ? "LineTo" : "MoveTo"}" IX="${i + 1}"><Cell N="X" V="${n(p.x - minX)}"/><Cell N="Y" V="${n(p.y - minY)}"/></Row>`).join("");
    this.id++;
    this.shapes.push(
      `<Shape ID="${this.id}" NameU="Sheet.${this.id}" Name="${esc(label.slice(0, 60)) || "Sheet." + this.id}" Type="Shape">`
      + `<Cell N="PinX" V="${n(minX)}"/><Cell N="PinY" V="${n(minY)}"/><Cell N="Width" V="${n(w)}"/><Cell N="Height" V="${n(h)}"/>`
      + `<Cell N="LocPinX" V="0"/><Cell N="LocPinY" V="0"/><Cell N="Angle" V="0"/>`
      + `<Cell N="LineColor" V="${color}"/><Cell N="LinePattern" V="${dashed ? 2 : 1}"/><Cell N="LineWeight" V="${n(widthPx / PX)}"/><Cell N="FillPattern" V="0"/>`
      + `<Section N="Geometry" IX="0"><Cell N="NoFill" V="1"/><Cell N="NoLine" V="0"/><Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/>${rows}</Section></Shape>`);
  }

  contentXml() {
    return `<?xml version="1.0" encoding="utf-8"?>\n<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Shapes>${this.shapes.join("")}</Shapes></PageContents>`;
  }
  sheetXml() {
    return `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0"><Cell N="PageWidth" V="${n(this.wIn)}"/><Cell N="PageHeight" V="${n(this.hIn)}"/>`
      + `<Cell N="ShdwOffsetX" V="0.125"/><Cell N="ShdwOffsetY" V="-0.125"/><Cell N="PageScale" V="1" U="IN"/><Cell N="DrawingScale" V="1" U="IN"/>`
      + `<Cell N="DrawingSizeType" V="3"/><Cell N="DrawingScaleType" V="0"/><Cell N="InhibitSnap" V="0"/></PageSheet>`;
  }
}

const deviceFill = (d: Device) => hex(d.color, "#3b6ea8");

function rackPage(doc: Doc, data: ExportData, face: Face): Page {
  const routes = face === "front" ? data.front : data.rear;
  const pg = new Page(face === "front" ? "Front" : "Rear", contentBounds(doc, routes, face));
  for (const r of doc.racks) {
    const b = rackBox(r);
    pg.rect(r.name, b.l, b.t, b.r - b.l, b.b - b.t, "#1d2025", "#3a3d42", r.name, { size: 14, top: true });
  }
  for (const d of doc.devices) {
    if (!visibleOn(d, face)) continue;
    const q = devRect(doc, d), fill = deviceFill(d);
    pg.rect(d.name, q.l, q.t, q.w, q.h, fill, "#222222", q.h >= 22 && d.model ? `${d.name}\n${d.model}` : d.name, { size: q.h >= 22 ? 8 : 7 });
  }
  const cab = new Map(doc.cables.map((c) => [c.id, c]));
  for (const rt of routes.routes) {
    if (rt.pts.length < 2) continue;
    const c = cab.get(rt.cable);
    pg.line(c?.label || `Cable ${rt.cable}`, rt.pts, hex(c?.color, "#999999"), 2.2, c?.style === "dashed");
  }
  return pg;
}

function logicalPage(doc: Doc): Page {
  const W = 170, H = 52, GX = 70, GY = 50;
  const cols = Math.max(1, Math.ceil(Math.sqrt(doc.devices.length)));
  const rows = Math.max(1, Math.ceil(doc.devices.length / cols));
  const pos = new Map<number, { l: number; t: number }>();
  doc.devices.forEach((d, i) => pos.set(d.id, { l: (i % cols) * (W + GX), t: Math.floor(i / cols) * (H + GY) }));
  const pg = new Page("Logical", { l: 0, t: 0, r: cols * (W + GX) - GX, b: rows * (H + GY) - GY });
  // Cables first so the device boxes sit on top of the line ends.
  const pair = new Map<string, number>();
  for (const c of doc.cables) {
    const a = portInfo(doc, c.a)?.dev, b = portInfo(doc, c.b)?.dev;
    if (!a || !b || a.id === b.id) continue;
    const pa = pos.get(a.id)!, pb = pos.get(b.id)!;
    const key = [a.id, b.id].sort().join("-"), k = pair.get(key) ?? 0; pair.set(key, k + 1);
    const off = k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 6 : 0; // spread parallel cables
    const ax = pa.l + W / 2 + off, ay = pa.t + H / 2, bx = pb.l + W / 2 + off, by = pb.t + H / 2;
    pg.line(c.label || `Cable ${c.id}`, [[ax, ay], [bx, by]], hex(c.color, "#999999"), 1.6, c.style === "dashed");
  }
  for (const d of doc.devices) {
    const p = pos.get(d.id)!;
    pg.rect(d.name, p.l, p.t, W, H, deviceFill(d), "#222222", d.model ? `${d.name}\n${d.model}` : d.name, { size: 9 });
  }
  return pg;
}

const XML = '<?xml version="1.0" encoding="utf-8"?>\n';
const rels = (items: [string, string, string][]) => XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("") + `</Relationships>`;

export async function buildVsdx(doc: Doc, data: ExportData, name?: string): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const pages = [rackPage(doc, data, "front"), rackPage(doc, data, "rear"), logicalPage(doc)];
  const title = docTitle(doc, name);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const zip = new JSZip();

  const overrides = [
    ["/visio/document.xml", "application/vnd.ms-visio.drawing.main+xml"],
    ["/visio/pages/pages.xml", "application/vnd.ms-visio.pages+xml"],
    ...pages.map((_, i) => [`/visio/pages/page${i + 1}.xml`, "application/vnd.ms-visio.page+xml"]),
    ["/visio/windows.xml", "application/vnd.ms-visio.windows+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
  ];
  zip.file("[Content_Types].xml", XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join("") + `</Types>`);

  zip.file("_rels/.rels", rels([
    ["rId1", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
    ["rId2", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", "docProps/app.xml"],
    ["rId3", `${REL}/document`, "visio/document.xml"],
  ]));
  zip.file("docProps/core.xml", XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(title)}</dc:title><dc:creator>Rackwright</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", XML + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Rackwright</Application><Template></Template></Properties>`);

  zip.file("visio/document.xml", XML + `<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">`
    + `<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions><SnapAngles/><DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes><ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings>`
    + `<Colors/><FaceNames><FaceName ID="0" Name="Calibri" UnicodeRanges="-536870145 1073786111 1 0" CharSets="1073741823 0" Panose="2 15 5 2 2 2 4 3 2 4" Flags="325"/></FaceNames>`
    + `<StyleSheets><StyleSheet ID="0" Name="No Style" NameU="No Style"><Cell N="EnableLineProps" V="1"/><Cell N="EnableFillProps" V="1"/><Cell N="EnableTextProps" V="1"/>`
    + `<Cell N="LineWeight" V="0.01041666666666667"/><Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="FillForegnd" V="1"/><Cell N="FillBkgnd" V="0"/><Cell N="FillPattern" V="1"/>`
    + `<Cell N="TxtPinX" V="0" F="Width*0.5"/><Cell N="TxtPinY" V="0" F="Height*0.5"/><Cell N="TxtWidth" V="0" F="Width*1"/><Cell N="TxtHeight" V="0" F="Height*1"/>`
    + `<Section N="Character"><Row IX="0"><Cell N="Font" V="Calibri"/><Cell N="Color" V="0"/><Cell N="Size" V="0.1666666666666667" U="PT"/></Row></Section>`
    + `<Section N="Paragraph"><Row IX="0"><Cell N="HorzAlign" V="1"/></Row></Section></StyleSheet></StyleSheets>`
    + `</VisioDocument>`);
  zip.file("visio/_rels/document.xml.rels", rels([
    ["rId1", `${REL}/pages`, "pages/pages.xml"],
    ["rId2", `${REL}/windows`, "windows.xml"],
  ]));

  zip.file("visio/pages/pages.xml", XML + `<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">`
    + pages.map((p, i) => `<Page ID="${i}" NameU="${p.name}" Name="${p.name}" ViewScale="-1" ViewCenterX="${n(p.wIn / 2)}" ViewCenterY="${n(p.hIn / 2)}">${p.sheetXml()}<Rel r:id="rId${i + 1}"/></Page>`).join("")
    + `</Pages>`);
  zip.file("visio/pages/_rels/pages.xml.rels", rels(pages.map((_, i) => [`rId${i + 1}`, `${REL}/page`, `page${i + 1}.xml`] as [string, string, string])));
  pages.forEach((p, i) => zip.file(`visio/pages/page${i + 1}.xml`, p.contentXml()));

  zip.file("visio/windows.xml", XML + `<Windows xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve" ClientWidth="1280" ClientHeight="720">`
    + `<Window ID="0" WindowType="Drawing" WindowState="1073741860" WindowLeft="0" WindowTop="0" WindowWidth="1280" WindowHeight="720" ContainerType="Page" Page="0" ViewScale="-1" ViewCenterX="${n(pages[0].wIn / 2)}" ViewCenterY="${n(pages[0].hIn / 2)}"/></Windows>`);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.ms-visio.drawing" });
}
