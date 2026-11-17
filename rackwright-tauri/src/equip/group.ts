// Grouping and filtering for the equipment sidebar. No backend imports: tests load this under Node.
export type Chip = "all" | "firewall" | "switch" | "server" | "storage" | "ups" | "power" | "other";
export interface EquipItem { name: string; type: string; group?: string; model?: string }
export interface EquipGroup<T extends EquipItem> { group: string; items: { c: T; i: number }[] }

export const CHIPS: { id: Chip; label: string }[] = [
  { id: "all", label: "All" }, { id: "firewall", label: "Firewall" }, { id: "switch", label: "Switch" },
  { id: "server", label: "Server" }, { id: "storage", label: "Storage" }, { id: "ups", label: "UPS" },
  { id: "power", label: "Power" }, { id: "other", label: "Other" },
];

export function chipOf(type: string): Exclude<Chip, "all"> {
  switch (type) {
    case "Firewall": case "Router": case "Modem/ISP": return "firewall";
    case "Switch": return "switch";
    case "Server": return "server";
    case "Storage": return "storage";
    case "UPS": return "ups";
    case "PDU": return "power";
    default: return "other";
  }
}

export function groupCatalog<T extends EquipItem>(items: T[], q: string, chip: Chip, tab: "catalog" | "generic"): EquipGroup<T>[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const by = new Map<string, { c: T; i: number }[]>();
  items.forEach((c, i) => {
    if (tab === "catalog" ? !c.group : !!c.group) return;
    if (chip !== "all" && chipOf(c.type) !== chip) return;
    const hay = `${c.name} ${c.model || ""} ${c.type} ${c.group || ""}`.toLowerCase().replace(/[-_]/g, " ");
    if (!words.every((w) => hay.includes(w))) return;
    const g = c.group || "Generic";
    if (!by.has(g)) by.set(g, []);
    by.get(g)!.push({ c, i });
  });
  return Array.from(by, ([group, its]) => ({ group, items: its.sort((a, b) => a.c.name.localeCompare(b.c.name)) }))
    .sort((a, b) => a.group.localeCompare(b.group));
}
