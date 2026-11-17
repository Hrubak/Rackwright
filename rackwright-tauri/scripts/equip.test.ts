// npx tsx scripts/equip.test.ts — equipment sidebar grouping (synthetic data only)
import { chipOf, groupCatalog } from "../src/equip/group";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const items = [
  { name: "Example 48-port PoE switch", type: "Switch", group: "Example Net" },
  { name: "Example 1500VA UPS", type: "UPS", group: "Example Power" },
  { name: "Example blank panel", type: "Blank" },
];
const names = (g: ReturnType<typeof groupCatalog>) => g.map((x) => ({ group: x.group, items: x.items.map((y) => y.c.name) }));
eq("catalog groups", names(groupCatalog(items, "", "all", "catalog")), [
  { group: "Example Net", items: ["Example 48-port PoE switch"] },
  { group: "Example Power", items: ["Example 1500VA UPS"] },
]);
eq("generic only", names(groupCatalog(items, "", "all", "generic")), [{ group: "Generic", items: ["Example blank panel"] }]);
eq("chip ups", names(groupCatalog(items, "", "ups", "catalog")), [{ group: "Example Power", items: ["Example 1500VA UPS"] }]);
eq("query", names(groupCatalog(items, "48 poe", "all", "catalog")), [{ group: "Example Net", items: ["Example 48-port PoE switch"] }]);
eq("index kept", groupCatalog(items, "", "all", "generic")[0].items[0].i, 2);
eq("chip map", ["Router", "Modem/ISP", "PDU", "Shelf", "Storage"].map(chipOf), ["firewall", "firewall", "power", "other", "storage"]);

if (fail) process.exit(1);
console.log("equip tests passed");
