// Picks the right reader for pasted or loaded text, or runs the one the user chose.
import type { ImportSpec } from "./spec";
import { parseRackmapText } from "./rackmap";
import { csvToSpec, looksDelimited } from "./csv";
import { parseLayout } from "./layout";

export type ReadMode = "auto" | "layout" | "rackmap" | "csv";

const foundNothing = (s: ImportSpec) => s.links.length === 0 && !s.devices.some((d) => (d.kind || "device") === "device");

function withWarning(spec: ImportSpec, text: string): ImportSpec {
  if (foundNothing(spec)) spec.warnings.push(text);
  return spec;
}

export function readImport(text: string, mode: ReadMode): ImportSpec {
  if (mode === "csv") return csvToSpec(text);
  if (mode === "rackmap") return withWarning(parseRackmapText(text), "Nothing in the RackMap text format was found.");
  if (mode === "layout") return withWarning(parseLayout(text), "No devices were found in the list.");
  if (looksDelimited(text)) return csvToSpec(text);
  const rm = parseRackmapText(text);
  if (rm.ratio >= 0.5 && !foundNothing(rm)) return rm;
  return parseLayout(text);
}
