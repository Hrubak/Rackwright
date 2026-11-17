// Client report: loads the client and its racks, builds the model and PDF, and saves it.
import { clientStore } from "../clients/store";
import type { Doc } from "../types";
import { backend } from "../backend";
import { safeName } from "../export/data";
import { settingsStore } from "../settings/store";
import type { AssetName, SystemSettings } from "../settings/types";
import { buildReportModel } from "./model";
import { buildReportPdf } from "./pdf";
import type { ReportOptions } from "./types";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function exportClientReport(clientKey: string, options: ReportOptions, settings: SystemSettings): Promise<boolean> {
  const store = clientStore();
  const client = await store.get(clientKey);
  const docs: Record<string, Doc | string> = {};
  await Promise.all(client.sites.flatMap((s) => s.racks).map(async (r) => {
    try { docs[r.key] = await store.loadDoc(r); } catch (e) { docs[r.key] = errText(e); }
  }));
  const ss = settingsStore();
  const asset = async (n: AssetName): Promise<Blob | undefined> => { try { return (await ss.getAsset(n)) ?? undefined; } catch { return undefined; } };
  const [logo, cover, header, footer, fr, fb] = await Promise.all((["logo", "cover_art", "header_art", "footer_art", "font_regular", "font_bold"] as AssetName[]).map(asset));
  const company = settings.company_name ?? "";
  const model = buildReportModel({ client, docs, options, company });
  const bytes = await buildReportPdf(model, {
    primary: settings.accent || "#2a6fdb", // theme-ok
    secondary: settings.report_secondary || "#1f2328", // theme-ok
    address: settings.address_line ?? "", company,
    logo, cover, header, footer,
    fontRegular: fr ? await fr.arrayBuffer() : undefined,
    fontBold: fb ? await fb.arrayBuffer() : undefined,
  });
  return backend.saveBytes(`${safeName(client.name)} network review ${options.date}.pdf`, "application/pdf", bytes);
}
