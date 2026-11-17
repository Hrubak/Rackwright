// npx tsx scripts/shortcuts.test.ts — shortcut table and key matching
import { commandFor, matches } from "../src/shortcuts";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

eq("ctrl s", matches({ key: "s", ctrlKey: true, shiftKey: false }, "Ctrl+S"), true);
eq("ctrl shift s is not save", commandFor({ key: "S", ctrlKey: true, shiftKey: true }), "saveAs");
eq("meta z", commandFor({ key: "z", ctrlKey: false, metaKey: true, shiftKey: false }), "undo");
eq("ctrl shift z", commandFor({ key: "Z", ctrlKey: true, shiftKey: true }), "redo");
eq("ctrl y", commandFor({ key: "y", ctrlKey: true, shiftKey: false }), "redo");
eq("plain z", commandFor({ key: "z", ctrlKey: false, shiftKey: false }), null);
eq("delete", commandFor({ key: "Delete", ctrlKey: false, shiftKey: false }), "delete");
eq("home", commandFor({ key: "Home", ctrlKey: false, shiftKey: false }), "fit");
eq("ctrl z not shift z", matches({ key: "z", ctrlKey: true, shiftKey: true }, "Ctrl+Z"), false);

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
