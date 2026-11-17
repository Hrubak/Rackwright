// npx tsx scripts/settings.test.ts — units formatting and accent colour helpers
import { fmtDims, fmtLen } from "../src/units";
import { startScreen } from "../src/settings/startScreen";
import { isHex6, mixHex } from "../src/theme";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

eq("mm", fmtLen(600, "mm"), "600 mm");
eq("in", fmtLen(600, "in"), "23.6 in");
eq("dims mm", fmtDims(600, 1070, "mm"), "600 x 1070 mm");
eq("dims in", fmtDims(600, 1070, "in"), "23.6 x 42.1 in");
eq("wide", fmtDims(600, undefined, "mm"), "600 mm wide");
eq("varies", fmtDims(undefined, undefined, "in"), "size varies");
eq("hex ok", isHex6("#336699"), true);
eq("hex bad", isHex6("blue"), false);
eq("mix", mixHex("#000000", "#ffffff", 0.5), "#808080");

eq("start default", startScreen({}), "clients");
eq("start last", startScreen({ start: "last" }), "last");
eq("start new", startScreen({ start: "new" }), "new");
console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
