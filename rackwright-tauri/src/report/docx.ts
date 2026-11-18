// Word export: draws the report diagrams offscreen, rasterises them to PNG, builds the .docx and saves it.
import { backend } from "../backend";
import { safeName } from "../export/data";
import { settingsStore } from "../settings/store";
import type { SystemSettings } from "../settings/types";
import { clearRackData, infraSvg, linksSvg, rackFaceSvg } from "./diagrams";
import { picKey } from "./docxBody";
import { DOCX_MIME, blankTemplate, buildDocx, templatePage, type DocxPicture } from "./docxPackage";
import { loadReport } from "./index";
import type { ReportOptions } from "./types";

const DPI = 200, EMU_IN = 914400, FONT = '"Noto Sans", Arial, sans-serif';

async function rasterise(d: { svg: SVGSVGElement; w: number; h: number }, key: string, maxWEmu: number, maxHEmu: number): Promise<DocxPicture> {
  const naturalW = d.w / 96 * EMU_IN, naturalH = d.h / 96 * EMU_IN;
  const s = Math.min(2, maxWEmu / naturalW, maxHEmu / naturalH);
  const wIn = naturalW * s / EMU_IN, hIn = naturalH * s / EMU_IN;
  const wPx = Math.max(1, Math.round(wIn * DPI)), hPx = Math.max(1, Math.round(hIn * DPI));
  for (const t of Array.from(d.svg.querySelectorAll("text"))) {
    t.setAttribute("font-family", FONT);
    const st = t.getAttribute("style");
    if (st) t.setAttribute("style", st.replace(/font-family:[^;]*;?/g, ""));
  }
  d.svg.setAttribute("font-family", FONT);
  d.svg.setAttribute("width", String(d.w)); d.svg.setAttribute("height", String(d.h));
  const xml = new XMLSerializer().serializeToString(d.svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const im = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not draw the diagram")); i.src = url;
    });
    const c = document.createElement("canvas"); c.width = wPx; c.height = hPx;
    const g = c.getContext("2d");
    if (!g) throw new Error("No canvas");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, wPx, hPx); // theme-ok
    g.drawImage(im, 0, 0, wPx, hPx);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    if (!blob) throw new Error("No image");
    return { key, png: new Uint8Array(await blob.arrayBuffer()), wPx, hPx, dpi: DPI };
  } finally { URL.revokeObjectURL(url); }
}

export async function exportClientWord(clientKey: string, options: ReportOptions, settings: SystemSettings): Promise<{ saved: boolean; notes: string[] }> {
  const model = await loadReport(clientKey, options, settings);
  const asset = await settingsStore().getAsset("word_template").catch(() => null);
  const template = asset ? new Uint8Array(await asset.arrayBuffer()) : await blankTemplate();
  const page = await templatePage(template);
  const maxW = page.textWidthEmu, maxH = page.textHeightEmu * 0.85;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:1600px;height:1200px;overflow:hidden;pointer-events:none";
  document.body.appendChild(host);
  const pictures: DocxPicture[] = [];
  const skip: string[] = [];
  const add = async (key: string, draw: () => Promise<{ svg: SVGSVGElement; w: number; h: number } | null>) => {
    try {
      const d = await draw();
      if (d) pictures.push(await rasterise(d, key, maxW, maxH)); else skip.push(key);
    } catch { /* the body prints the fallback line */ }
  };
  clearRackData();
  try {
    if (model.links.length) await add(picKey.links, () => linksSvg(model, host));
    for (const s of model.sites) for (const r of s.racks) {
      if (!r.doc) continue;
      const doc = r.doc;
      if (doc.devices.length > 0) await add(picKey.infra(r.key), () => infraSvg(doc, host));
      for (const face of model.level === "detailed" ? (["front", "rear"] as const) : (["front"] as const)) {
        await add(picKey.face(r.key, face), () => rackFaceSvg(r.key, doc, face, host));
      }
    }
  } finally { host.remove(); clearRackData(); }
  const { bytes, notes } = await buildDocx({ template, model, pictures, skip });
  const saved = await backend.saveBytes(`${safeName(model.client.name)} network review ${options.date}.docx`, DOCX_MIME, bytes);
  return { saved, notes };
}
