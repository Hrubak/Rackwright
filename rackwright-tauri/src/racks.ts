// Rack model catalog. Every rack is still drawn as a 19" rack with the same RW/RAIL/UH geometry;
// kind, model and dimensions are descriptive extra fields saved in the .rack.json (older apps ignore them).
//
// Dimensions are the manufacturer's outer cabinet size where known. Entries with `approx: true` have
// dimensions (or an exact part-number/height match) I could not confirm, so treat them as rough.

export type RackKind = "cabinet" | "open4" | "twopost" | "wall" | "desktop";

export const KINDS: { id: RackKind; label: string; blurb: string }[] = [
  { id: "cabinet", label: "Cabinet", blurb: "4-post enclosed cabinet" },
  { id: "open4", label: "Open 4-post", blurb: "4-post open frame" },
  { id: "twopost", label: "2-post", blurb: "2-post relay rack" },
  { id: "wall", label: "Wall mount", blurb: "Wall-mount or swing-out cabinet" },
  { id: "desktop", label: "Desktop", blurb: "Small 19\" desktop rack" },
];
export const kindLabel = (k?: string) => KINDS.find((x) => x.id === k)?.label ?? "";

export interface RackModel {
  id: string; kind: RackKind; name: string; u: number;
  width_mm?: number; depth_mm?: number;
  generic?: boolean;   // U is chosen by the user
  approx?: boolean;    // dimensions are approximate
}

export interface RackSpec { kind: RackKind; model: string; model_name: string; width_mm?: number; depth_mm?: number }

export const GENERIC_MIN_U = 4, GENERIC_MAX_U = 52;
const GENERIC_DEFAULT_U: Record<RackKind, number> = { cabinet: 42, open4: 42, twopost: 42, wall: 12, desktop: 8 };
export const genericDefaultU = (k: RackKind) => GENERIC_DEFAULT_U[k];

const m = (id: string, kind: RackKind, name: string, u: number, width_mm: number, depth_mm: number, approx = false): RackModel =>
  ({ id, kind, name, u, width_mm, depth_mm, ...(approx ? { approx: true } : {}) });

export const RACK_MODELS: RackModel[] = [
  // Cabinets
  m("apc-ar3100", "cabinet", "APC NetShelter SX AR3100", 42, 600, 1070),
  m("apc-ar3150", "cabinet", "APC NetShelter SX AR3150", 42, 750, 1070),
  m("apc-ar3300", "cabinet", "APC NetShelter SX AR3300", 42, 600, 1200),
  m("apc-ar3350", "cabinet", "APC NetShelter SX AR3350", 42, 750, 1200),
  m("apc-ar3307", "cabinet", "APC NetShelter SX AR3307", 48, 600, 1200, true),
  m("eaton-ra-42u", "cabinet", "Eaton RA Series 42U", 42, 600, 1070, true),
  m("eaton-ra-45u", "cabinet", "Eaton RA Series 45U", 45, 600, 1070, true),
  m("tl-sr42ub", "cabinet", "Tripp Lite SmartRack SR42UB", 42, 600, 1070, true),
  m("tl-sr45ub", "cabinet", "Tripp Lite SmartRack SR45UB", 45, 600, 1070, true),
  m("tl-sr48ub", "cabinet", "Tripp Lite SmartRack SR48UB", 48, 600, 1070, true),
  // Open 4-post frames
  m("st-4postrack42", "open4", "StarTech 4POSTRACK42", 42, 600, 900, true),
  m("st-4postrack25", "open4", "StarTech 4POSTRACK25", 25, 600, 900, true),
  m("tl-sr25ub", "open4", "Tripp Lite SmartRack SR25UB", 25, 600, 900, true),
  // 2-post relay racks
  m("tl-sr2post", "twopost", "Tripp Lite SmartRack SR2POST", 45, 560, 600, true),
  m("st-2postrack12", "twopost", "StarTech 2POSTRACK12", 12, 560, 450, true),
  m("st-2postrack25", "twopost", "StarTech 2POSTRACK25", 25, 560, 450, true),
  // Wall mount
  m("apc-ar112", "wall", "APC NetShelter WX AR112", 12, 600, 600, true),
  m("apc-ar100", "wall", "APC NetShelter WX AR100", 13, 600, 600, true),
  m("tl-srw6u", "wall", "Tripp Lite SmartRack SRW6U", 6, 530, 500, true),
  m("tl-srw12us", "wall", "Tripp Lite SmartRack SRW12US", 12, 530, 500, true),
  m("tl-srw18usdp", "wall", "Tripp Lite SmartRack SRW18USDP", 18, 530, 700, true),
  m("st-rk12walloa", "wall", "StarTech RK12WALLOA (open frame)", 12, 560, 400, true),
  m("np-wall-9u", "wall", "NavePoint 9U wall-mount cabinet", 9, 600, 450, true),
  m("np-wall-12u", "wall", "NavePoint 12U wall-mount cabinet", 12, 600, 450, true),
  // Desktop
  m("st-rk4od", "desktop", "StarTech RK4OD", 4, 520, 400, true),
  m("st-rk8od", "desktop", "StarTech RK8OD", 8, 520, 400, true),
  m("st-rk12od", "desktop", "StarTech RK12OD", 12, 520, 400, true),
  // Generic (U chosen by the user)
  ...KINDS.map((k): RackModel => ({ id: `generic-${k.id}`, kind: k.id, name: `Generic ${k.label.toLowerCase()}`, u: GENERIC_DEFAULT_U[k.id], generic: true })),
];

export const modelById = (id?: string) => RACK_MODELS.find((x) => x.id === id);

/** The fields to store on a rack for a catalog model (u only matters for generic models). */
export function specOf(mod: RackModel): RackSpec {
  const s: RackSpec = { kind: mod.kind, model: mod.id, model_name: mod.name };
  if (mod.width_mm) s.width_mm = mod.width_mm;
  if (mod.depth_mm) s.depth_mm = mod.depth_mm;
  return s;
}

export const dimsText = (w?: number, d?: number) => (w && d ? `${w} x ${d} mm` : w ? `${w} mm wide` : "size varies");
