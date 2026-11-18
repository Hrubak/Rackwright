// Reads a set of chosen files (Visio, SVG, PDF, pictures, text) into one ImportSpec for the import dialog.
import type { ImportDevice, ImportLink, ImportSpec } from "./spec";
import { nk } from "./spec";
import type { DiagramModel } from "./diagram";
import { diagramToSpec } from "./diagram";
import { parseVsdx } from "./vsdx";
import { parseSvg } from "./svg";
import { parsePicture } from "./picture";
import { pdfText } from "./pdf";
import { isReaderError } from "./readers";
import { readImport } from "./read";
import type { ReadMode } from "./read";

export type FileKind = "Visio" | "Visio (old)" | "SVG" | "PDF" | "Picture" | "Text" | null;

const EXT: Record<string, Exclude<FileKind, null>> = {
  vsdx: "Visio", vsd: "Visio (old)", vdx: "Visio (old)", vsdm: "Visio (old)", svg: "SVG", pdf: "PDF",
  png: "Picture", jpg: "Picture", jpeg: "Picture", webp: "Picture", gif: "Picture", bmp: "Picture",
  txt: "Text", csv: "Text", tsv: "Text", md: "Text",
};
export const DIAGRAM_ACCEPT = ".vsdx,.vsd,.vdx,.vsdm,.svg,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.txt,.csv,.tsv,.md";

export function kindOf(name: string): FileKind {
  const base = name.split(/[\\/]/).pop() || "";
  const i = base.lastIndexOf(".");
  return i < 0 ? null : EXT[base.slice(i + 1).toLowerCase()] ?? null;
}
/** True for the kinds that go through the diagram reading (everything but plain text and unknown files). */
export const isDiagramKind = (k: FileKind): boolean => k === "Visio" || k === "Visio (old)" || k === "SVG" || k === "PDF" || k === "Picture";

export function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1000) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export interface FileLike { name: string; size: number; webkitRelativePath?: string; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }
/** The name shown to the user: the path inside the chosen folder when there is one. */
export const pathOf = (f: { name: string; webkitRelativePath?: string }): string => f.webkitRelativePath || f.name;

export interface Readers {
  svg?: (text: string, name: string) => Promise<DiagramModel>;
  picture?: (blob: Blob, name: string) => Promise<DiagramModel>;
  pdf?: (data: ArrayBuffer) => Promise<string>;
}
/** `web` picks the wording of the reader-download warnings; `mode` is how PDF and text files are read. */
export interface DiagramOpts { endUsers: boolean; say: (s: string) => void; web?: boolean; mode?: ReadMode; readers?: Readers }

const MAX_SKIP_WARNINGS = 10;

/** An error that also carries the per-file warnings collected so far, so the dialog can list them. */
export class ImportFilesError extends Error { constructor(message: string, public warnings: string[]) { super(message); } }

export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

let pictureReady = false, pdfReady = false; // the first use of each reader downloads it

function mergeDevice(ex: ImportDevice, d: ImportDevice) {
  for (const [k, v] of Object.entries(d.fields)) if (v && !(ex.fields as Record<string, unknown>)[k]) (ex.fields as Record<string, unknown>)[k] = v;
  for (const [k, v] of Object.entries(d.specs)) if (!ex.specs[k]) ex.specs[k] = v;
  if (ex.rack === undefined && d.rack !== undefined) { ex.rack = d.rack; ex.u = d.u; ex.height = d.height; ex.offRackIfNew = false; }
  if ((!ex.type || ex.type === "Other") && d.type && d.type !== "Other") ex.type = d.type;
  if (!ex.ports && d.ports) ex.ports = d.ports;
}
const sameLink = (x: ImportLink, y: ImportLink) =>
  (nk(x.a) === nk(y.a) && nk(x.b) === nk(y.b) && nk(x.ap) === nk(y.ap) && nk(x.bp) === nk(y.bp)) ||
  (nk(x.a) === nk(y.b) && nk(x.b) === nk(y.a) && nk(x.ap) === nk(y.bp) && nk(x.bp) === nk(y.ap));

/** Appends `b` to `a`: racks, devices and links, names deduplicated by `nk`. */
function mergeSpecs(a: ImportSpec, b: ImportSpec): ImportSpec {
  b.racks.forEach((r) => { if (!a.racks.some((x) => nk(x.name) === nk(r.name))) a.racks.push(r); });
  b.devices.forEach((d) => {
    const ex = (d.kind || "device") === "device" ? a.devices.find((x) => (x.kind || "device") === "device" && nk(x.name) === nk(d.name)) : undefined;
    if (ex) mergeDevice(ex, d); else a.devices.push(d);
  });
  b.links.forEach((l) => { if (!a.links.some((x) => sameLink(x, l))) a.links.push(l); });
  a.notes.push(...b.notes);
  a.warnings.push(...b.warnings);
  return a;
}

export async function readDiagramFiles(files: FileLike[], opts: DiagramOpts): Promise<ImportSpec> {
  const { say } = opts;
  const rd = opts.readers ?? {};
  const svgRead = rd.svg ?? parseSvg, pictureRead = rd.picture ?? ((b: Blob, n: string) => parsePicture(b, n)), pdfRead = rd.pdf ?? pdfText;
  const mode = opts.mode ?? "auto";
  const warnings: string[] = [];
  const models: DiagramModel[] = [];
  const textSpecs: ImportSpec[] = [];
  let readable = 0, unknown = 0;
  const readerWarn = (name: string, what: string) =>
    `${name}: the ${what} couldn't load. ${opts.web ? "Try again." : "Check the internet connection and try again."}`;

  for (const f of files) {
    const name = pathOf(f);
    const kind = kindOf(f.name);
    try {
      if (!kind) { if (++unknown <= MAX_SKIP_WARNINGS) warnings.push(`${name}: this kind of file can't be read — skipped.`); continue; }
      if (kind === "Visio (old)") { warnings.push(`${name}: old Visio file — open it in Visio and save it as .vsdx first.`); continue; }
      if (f.size > MAX_FILE_BYTES) { warnings.push(`${name}: the file is over 50 MB — skipped.`); continue; }
      if (kind === "Text" && f.size > MAX_TEXT_BYTES) { warnings.push(`${name}: the file is over 5 MB — skipped.`); continue; }

      say(`Reading ${name}…`);
      if (kind === "Visio") {
        const ms = (await parseVsdx(await f.arrayBuffer(), name)).filter((m) => m.nodes.length);
        if (!ms.length) warnings.push(`${name}: no shapes found.`);
        models.push(...ms); readable++;
      } else if (kind === "SVG") {
        const m = await svgRead(await f.text(), name);
        if (!m.nodes.length) warnings.push(`${name}: no shapes found.`); else models.push(m);
        readable++;
      } else if (kind === "Picture") {
        if (!pictureReady) say("Loading the picture reader (first time only, about 10 MB)…");
        const m = await pictureRead(f as unknown as Blob, name);
        pictureReady = true;
        if (!m.nodes.length) warnings.push(m.words === 0 ? `${name}: no readable text was found.` : `${name}: no shapes found.`);
        else models.push(m);
        readable++;
      } else {
        let text: string;
        if (kind === "PDF") {
          if (!pdfReady) say("Loading the PDF reader (first time only)…");
          text = await pdfRead(await f.arrayBuffer());
          pdfReady = true;
        } else text = await f.text();
        if (!text.trim()) { warnings.push(`${name}: no readable text was found.`); readable++; continue; }
        const s = readImport(text, mode);
        s.warnings = s.warnings.map((w) => `${name}: ${w}`);
        textSpecs.push(s); readable++;
      }
    } catch (e) {
      if (isReaderError(e)) warnings.push(readerWarn(name, kind === "PDF" ? "PDF reader" : "picture reader"));
      else warnings.push(`${name}: couldn't be read (${e instanceof Error ? e.message : String(e)}) — skipped.`);
    }
  }

  if (unknown > MAX_SKIP_WARNINGS) warnings.push(`${unknown - MAX_SKIP_WARNINGS} other ${unknown - MAX_SKIP_WARNINGS === 1 ? "file was" : "files were"} skipped.`);
  if (!readable) throw new ImportFilesError("None of these files can be read — add a .vsdx, .svg, .pdf or picture file.", warnings);

  const specs: ImportSpec[] = [];
  if (models.length) specs.push(diagramToSpec(models, { endUsers: opts.endUsers }));
  specs.push(...textSpecs);
  let out: ImportSpec = { kind: "diagram", racks: [], devices: [], links: [], notes: [], warnings: [] };
  if (specs.length) {
    out = specs[0];
    for (const s of specs.slice(1)) mergeSpecs(out, s);
    // each source numbers its devices from 1: one running counter keeps "Same device as line N" pointing at the right row
    if (specs.length > 1) out.devices.forEach((d, i) => { d.line = i + 1; });
  }
  if (models.length) out.kind = "diagram";
  out.warnings = [...warnings, ...out.warnings];
  const nothing = out.links.length === 0 && !out.devices.some((d) => (d.kind || "device") === "device");
  if (nothing && files.some((f) => isDiagramKind(kindOf(f.name)))) throw new ImportFilesError("No equipment was found in these files.", out.warnings);
  return out;
}
