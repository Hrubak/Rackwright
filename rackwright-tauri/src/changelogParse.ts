/** Split a changelog into its `## ` entries (the intro before the first is skipped) and return the first n. */
export function latestEntries(md: string, n: number): { heading: string; lines: string[] }[] {
  const out: { heading: string; lines: string[] }[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("## ")) out.push({ heading: line.slice(3).trim(), lines: [] });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  return out.slice(0, n);
}
