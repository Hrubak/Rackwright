import { sanitizeSvgText } from "../src/imports/svg";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const dirty = `<svg onload="x()"><script>alert(1)</script><rect onclick='y()' width="5"/><foreignObject><div>hi</div></foreignObject><a href="javascript:bad()"/><image xlink:href="https://evil.example/x"/><use href="#local"/><text>EX-SW01</text></svg>`;
const s = sanitizeSvgText(dirty);
t("script removed", !/script|alert/.test(s));
t("onload removed", !/onload/.test(s));
t("onclick removed", !/onclick/.test(s));
t("foreignObject removed", !/foreignObject|hi</.test(s));
t("javascript href removed", !/javascript/.test(s));
t("external href removed", !/evil\.example/.test(s));
t("text kept", s.includes("<text>EX-SW01</text>"));
t("rect kept", /<rect [^>]*width="5"\/>/.test(s));
t("local href kept", s.includes('href="#local"'));
if (fails) process.exit(1);
