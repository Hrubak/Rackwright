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
const re1 = sanitizeSvgText("<scr<script></script>ipt>alert(1)</scr<script></script>ipt>");
t("re-formed script", !/<script/i.test(re1), re1);
const re2 = sanitizeSvgText('<a onc onclick="x"lick="alert(1)"/>');
t("re-formed onclick", !/onclick/i.test(re2), re2);
t("tab in javascript href", !/javascript|java	script/.test(sanitizeSvgText('<a href="java	script:alert(1)"/>')));
t("protocol-relative href", !/evil/.test(sanitizeSvgText('<image href="//evil.example/p.png"/>')));
t("data href", !/data:/.test(sanitizeSvgText('<image href="data:image/png;base64,AAAA"/>')));
t("local href kept 2", sanitizeSvgText('<use href="#local"/>').includes('href="#local"'));
const up = sanitizeSvgText('<SCRIPT>x()</SCRIPT><rect ONLOAD="x()"/>');
t("uppercase script/onload", !/script|onload/i.test(up), up);
if (fails) process.exit(1);
