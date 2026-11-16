// Rack model catalog. Every rack is still drawn as a 19" rack with the same RW/RAIL/UH geometry;
// kind, model and dimensions are descriptive extra fields saved in the .rack.json (older apps ignore them).
//
// Dimensions are the manufacturer's outer cabinet size where known. Entries with `approx: true` have
// dimensions (or an exact part-number/height match) could not be fully confirmed from manufacturer or retailer spec sheets, so treat them as rough.

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
  m("apc-ar3307", "cabinet", "APC NetShelter SX AR3307", 48, 600, 1200),
  m("eaton-raa42610psb13u", "cabinet", "Eaton RA Series RAA42610PSB13U", 42, 600, 1060),
  m("eaton-raa48610psb13u", "cabinet", "Eaton RA Series RAA48610PSB13U", 48, 600, 1060, true),
  m("eaton-raa42812psb13u", "cabinet", "Eaton RA Series RAA42812PSB13U", 42, 800, 1260),
  m("tl-sr42ub", "cabinet", "Tripp Lite SmartRack SR42UB", 42, 600, 1092),
  m("tl-sr45ub", "cabinet", "Tripp Lite SmartRack SR45UB", 45, 600, 1092),
  m("tl-sr48ub", "cabinet", "Tripp Lite SmartRack SR48UB", 48, 600, 1092),
  // Open 4-post frames
  m("st-4postrack42", "open4", "StarTech 4POSTRACK42", 42, 600, 1128),
  m("st-4postrack25", "open4", "StarTech 4POSTRACK25", 25, 600, 1128, true),
  m("tl-sr4post25", "open4", "Tripp Lite SmartRack SR4POST25", 25, 513, 998),
  // 2-post relay racks
  m("tl-sr2post", "twopost", "Tripp Lite SmartRack SR2POST", 45, 516, 343),
  m("tl-sr2post25", "twopost", "Tripp Lite SmartRack SR2POST25", 25, 516, 343),
  m("st-2postrack12", "twopost", "StarTech 2POSTRACK12", 12, 518, 305),
  // Wall mount
  m("apc-ar112", "wall", "APC NetShelter WX AR112", 12, 600, 600),
  m("apc-ar100", "wall", "APC NetShelter WX AR100", 13, 584, 631, true),
  m("tl-srw6u", "wall", "Tripp Lite SmartRack SRW6U", 6, 600, 445),
  m("tl-srw9u", "wall", "Tripp Lite SmartRack SRW9U", 9, 600, 449),
  m("tl-srw12us", "wall", "Tripp Lite SmartRack SRW12US", 12, 623, 548, true),
  m("tl-srw18usdp", "wall", "Tripp Lite SmartRack SRW18USDP", 18, 597, 660),
  m("st-rk12walloa", "wall", "StarTech RK12WALLOA (open frame)", 12, 504, 305, true),
  // Desktop
  m("st-rk4od", "desktop", "StarTech RK4OD", 4, 500, 293),
  m("st-rk8od", "desktop", "StarTech RK8OD", 8, 503, 292),
  m("st-rk12od", "desktop", "StarTech RK12OD", 12, 504, 292),
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
