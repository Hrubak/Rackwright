// npx tsx scripts/theme.test.ts — theme tokens and the no-stray-hex scan
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DARK, resolveVars, resolveSvgVars, v } from "../src/theme";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

eq("v", v("bg"), "var(--rw-bg)");
eq("resolve", resolveVars("fill:var(--rw-bg);stroke:var(--rw-border)", DARK), "fill:#14161a;stroke:#3a3d42");
eq("fallback", resolveVars("var(--rw-nope, #123456)", DARK), "#123456");
eq("unknown kept", resolveVars("var(--rw-nope)", DARK), "var(--rw-nope)");
eq("values are hex", Object.values(DARK).every((c) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)), true);

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const skip = new Set(["src/theme.ts", "src/Plate.tsx", "src/catalog.json", "src/export/vsdx.ts", "src/export/pdf.ts"]);
const files: string[] = [join(root, "index.html")];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
};
walk(join(root, "src"));
eq("style attr", resolveVars("background:var(--rw-bg);color:var(--rw-text)", DARK), "background:#14161a;color:#e6e8eb");
eq("4-digit kept for fixColors", resolveVars("var(--rw-overlay)", DARK), "#000a");
eq("resolveSvgVars exported", typeof resolveSvgVars, "function");
const offenders: string[] = [];
for (const f of files) {
  const rel = relative(root, f).split("\\").join("/");
  if (skip.has(rel)) continue;
  readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
    if (!/#[0-9a-fA-F]{3,8}\b/.test(line)) return;
    if (/(\/\/ theme-ok|\/\* theme-ok \*\/)\s*$/.test(line.trimEnd())) return;
    offenders.push(`${rel}:${i + 1}`);
  });
}
if (offenders.length) console.log(offenders.slice(0, 15).join("\n") + (offenders.length > 15 ? `\n... ${offenders.length} total` : ""));
eq("no stray hex", offenders, []);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
