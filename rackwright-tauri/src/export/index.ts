// Entry points used by the toolbar. The heavy libraries (jspdf, svg2pdf.js, jszip) live in ./pdf and ./vsdx, which are
// only imported on first use so they stay out of the main bundle.
import { backend } from "../backend";
import { Doc } from "../types";
import { ExportData, safeName } from "./data";

export async function gatherData(doc: Doc): Promise<ExportData> {
  const [front, rear, ports] = await Promise.all([backend.routeCables(doc, "front"), backend.routeCables(doc, "rear"), backend.portPositions(doc)]);
  return { front, rear, ports };
}

export async function exportPdf(doc: Doc, name?: string): Promise<boolean> {
  const data = await gatherData(doc);
  const { buildPdf } = await import("./pdf");
  const bytes = await buildPdf(doc, data, name);
  return backend.saveBytes(`${safeName(name || "rack")}.pdf`, "application/pdf", bytes);
}

export async function exportVisio(doc: Doc, name?: string): Promise<boolean> {
  const data = await gatherData(doc);
  const { buildVsdx } = await import("./vsdx");
  const bytes = await buildVsdx(doc, data, name);
  return backend.saveBytes(`${safeName(name || "rack")}.vsdx`, "application/vnd.ms-visio.drawing", bytes);
}
