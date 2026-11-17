// npx tsx scripts/version.test.ts — version comparison for update banners
import { adminOffer, cmpVer, due, newestDesktop, serverNewer } from "../src/version/check";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

eq("newer", cmpVer("3.10.0", "3.9.0") > 0, true);
eq("v and missing parts", cmpVer("v3.9", "3.9.0"), 0);
eq("older", cmpVer("3.9.0", "3.10.0") < 0, true);
const rel = (tag: string, pre = false, draft = false) => ({ tag_name: tag, draft, prerelease: pre, html_url: "u/" + tag, published_at: "2026-01-01T00:00:00Z" });
const rs = [rel("desktop-v3.9.0"), rel("desktop-v3.11.0", true), rel("desktop-v3.10.0"), rel("web-v9.0.0")];
eq("newest", newestDesktop(rs, "3.9.0", null)?.version, "3.10.0");
eq("skip", newestDesktop(rs, "3.9.0", "3.10.0"), null);
eq("skip older lets newer through", newestDesktop([...rs, rel("desktop-v3.12.0")], "3.9.0", "3.10.0")?.version, "3.12.0");
eq("current", newestDesktop(rs, "3.10.0", null), null);
eq("draft ignored", newestDesktop([rel("desktop-v4.0.0", false, true)], "3.9.0", null), null);
eq("server older", serverNewer("3.9.0", "3.10.0"), false);
eq("server newer", serverNewer("3.10.0", "3.9.0"), true);
eq("admin same", adminOffer({ version: "3.10.0", latest_version: "3.10.0", update_available: true }), null);
eq("admin newer", adminOffer({ version: "3.9.0", latest_version: "3.10.0", update_available: true }), "3.10.0");
eq("admin none", adminOffer({ version: "3.9.0", latest_version: "3.10.0", update_available: false }), null);
const now = new Date("2026-11-17T12:00:00Z");
eq("due null", due(null, now), true);
eq("due 23h", due(new Date(now.getTime() - 23 * 3600e3).toISOString(), now), false);
eq("due 25h", due(new Date(now.getTime() - 25 * 3600e3).toISOString(), now), true);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
