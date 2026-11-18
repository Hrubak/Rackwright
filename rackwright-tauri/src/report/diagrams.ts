// Offscreen report diagrams shared by the PDF and Word exports. Each returns null when there is nothing to draw and throws when drawing fails.
import type { ReportModel } from "./model";
import type { Doc } from "../types";

type Drawn = { svg: SVGSVGElement; w: number; h: number };

export async function linksSvg(model: ReportModel, host: HTMLElement): Promise<Drawn | null> {
  if (!model.links.length) return null;
  const [{ createElement }, { default: LinksDiagram, W, H }, { withRendered, svgOf }] = await Promise.all([import("react"), import("../clients/LinksDiagram"), import("../export/svg")]);
  return withRendered(createElement(LinksDiagram, { client: model.client, docs: model.docs }), host, (live) => svgOf(live, { l: 0, t: 0, r: W, b: H }, 0));
}

export async function infraSvg(doc: Doc, host: HTMLElement): Promise<Drawn | null> {
  const [{ createElement }, { default: InfraView }, { infraLayout }, { withRendered, svgOf }] = await Promise.all([import("react"), import("../views/InfraView"), import("../views/infra"), import("../export/svg")]);
  const lay = infraLayout(doc);
  const nodes = [...lay.nodes, ...lay.extras];
  if (!nodes.length) return null;
  const b = { l: Math.min(...nodes.map((n) => n.x)), t: Math.min(...nodes.map((n) => n.y)), r: Math.max(...nodes.map((n) => n.x + n.w)), b: Math.max(...nodes.map((n) => n.y + n.h)) + 50 };
  return withRendered(createElement(InfraView, { doc, selected: null, onSelect: () => {} }), host, (live) => svgOf(live, b, 12));
}

type Routes = Awaited<ReturnType<typeof import("../export/index")["gatherData"]>>;
const rackData = new Map<string, Routes | Error>();
/** Route data is cached per rack key for one export; call this at the start and end of each export. */
export function clearRackData() { rackData.clear(); }

export async function rackFaceSvg(key: string, doc: Doc, face: "front" | "rear", host: HTMLElement): Promise<Drawn> {
  let d = rackData.get(key);
  if (!d) {
    try { const { gatherData } = await import("../export/index"); d = await gatherData(doc); } catch (e) { d = e instanceof Error ? e : new Error(String(e)); }
    rackData.set(key, d);
  }
  if (d instanceof Error) throw d;
  const { faceSvg } = await import("../export/svg");
  return faceSvg(doc, d, face, host);
}
