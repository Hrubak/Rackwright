// PDF text for the import dialog: the first pages, top to bottom, left to right. Port of RackMap parsePdf (text only).
import { loadPdfJs, type PdfTextItem } from "./readers";

/** Items → text lines: sorted top-to-bottom then left-to-right; items within 3 units of height share a line. */
export function itemsToLines(items: PdfTextItem[]): string[] {
  const its = items.filter((t) => t.str && t.str.trim()).map((t) => ({ s: t.str.trim(), x: t.transform[4], y: t.transform[5] })).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; p: { s: string; x: number }[] }[] = [];
  its.forEach((t) => { const l = lines[lines.length - 1]; if (l && Math.abs(l.y - t.y) < 3) l.p.push(t); else lines.push({ y: t.y, p: [t] }); });
  return lines.map((l) => l.p.sort((a, b) => a.x - b.x).map((t) => t.s).join("   "));
}

export async function pdfText(data: ArrayBuffer): Promise<string> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
    const page = await doc.getPage(i);
    out.push(...itemsToLines((await page.getTextContent()).items));
  }
  return out.join("\n");
}
