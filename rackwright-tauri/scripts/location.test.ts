// npx tsx scripts/location.test.ts — rack location lookup (synthetic data only)
import { findRackLocation, sameFile } from "../src/location";
import type { ClientItem } from "../src/clients/store";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const cs: ClientItem[] = [
  { key: "acme", name: "Acme", notes: "", links: [], sites: [
    { id: 1, name: "North", address: "", notes: "", racks: [{ key: "1", name: "MDF", path: "C:\\Acme\\North\\mdf.rack.json" }] },
    { id: 2, name: "South", address: "", notes: "", racks: [] },
  ] },
  { key: "globex", name: "Globex", notes: "", links: [], sites: [] },
];
eq("found", findRackLocation(cs, (r) => r.key === "1"), { clientKey: "acme", client: "Acme", siteId: 1, site: "North" });
eq("none", findRackLocation(cs, (r) => r.key === "x"), null);
eq("same file", sameFile("C:\\Acme\\North\\MDF.rack.json", "c:/acme/north/mdf.rack.json"), true);
eq("other file", sameFile("C:\\a.rack.json", "C:\\b.rack.json"), false);

console.log(fail ? `${fail} failed` : "location: all passed");
process.exit(fail ? 1 : 0);
