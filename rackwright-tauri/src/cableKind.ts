// Cable kinds from the cable type text (pure, shared by the editor and the client cabling table).
export type Kind = "rj45" | "fiber" | "dac" | "power" | "console" | "other";
export function cableKind(type?: string): Kind {
  const t = (type || "").toLowerCase();
  if (/^cat\s?\d|rj45|copper|ethernet/.test(t)) return "rj45";
  if (/om\d|os\d|fib|\blc\b|\bsc\b|\bmpo\b/.test(t)) return "fiber";
  if (/dac|twinax|sfp|aoc|qsfp/.test(t)) return "dac";
  if (/power|iec|c13|c14|mains/.test(t)) return "power";
  if (/console|rollover|serial/.test(t)) return "console";
  return "other";
}
