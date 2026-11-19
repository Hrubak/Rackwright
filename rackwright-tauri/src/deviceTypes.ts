// The app's device types, shared by the Device panel and the Auvik import. Pure: no backend import.
import { CATALOG } from "./edit";

export const DEVICE_TYPES: string[] = [...new Set([...CATALOG.map((t) => t.type), "Endpoints", "Virtual machines"])]
  .sort((a, b) => a.localeCompare(b));

// A type that is not in the list (older files, the Python app) is kept as an extra first option.
export function typeOptions(current: string): string[] {
  return !current || DEVICE_TYPES.includes(current) ? DEVICE_TYPES : [current, ...DEVICE_TYPES];
}
