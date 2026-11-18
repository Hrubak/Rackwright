#!/usr/bin/env node
// One version for the web server and the desktop app.
//   node scripts/version.mjs            print the version of every file
//   node scripts/version.mjs --check    exit 1 if they differ (CI runs this)
//   node scripts/version.mjs 3.1.0      set every file to 3.1.0
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Each spot: file, a regex whose group 2 is the version, and a label. */
const spots = [
  ["web/server/Cargo.toml", /(\[package\][^[]*?\nversion = ")([^"]+)/],
  ["web/server/Cargo.lock", /(\nname = "rackwright-server"\r?\nversion = ")([^"]+)/],
  ["rackwright-tauri/package.json", /(^\{[^{]*?"version": ")([^"]+)/],
  ["rackwright-tauri/package-lock.json", /(^\{[^{]*?"version": ")([^"]+)/],
  ["rackwright-tauri/package-lock.json", /("packages": \{\s*"": \{[^{]*?"version": ")([^"]+)/],
  ["rackwright-tauri/src-tauri/tauri.conf.json", /("version": ")([^"]+)/],
  ["rackwright-tauri/src-tauri/Cargo.toml", /(\[package\][^[]*?\nversion = ")([^"]+)/],
  ["rackwright-tauri/src-tauri/Cargo.lock", /(\nname = "rackwright"\r?\nversion = ")([^"]+)/],
];

const arg = process.argv[2];
const found = [];
const files = new Map();
for (const [file, re] of spots) {
  // A missing Cargo.lock is allowed: CI then builds one and keeps it as an artifact.
  if (file.endsWith("Cargo.lock") && !files.has(file) && !existsSync(join(root, file))) continue;
  const text = files.get(file) ?? readFileSync(join(root, file), "utf8");
  const m = re.exec(text);
  if (!m) { console.error(`No version found in ${file}`); process.exit(1); }
  found.push([file, m[2]]);
  if (arg && arg !== "--check") {
    if (!/^\d+\.\d+\.\d+$/.test(arg)) { console.error(`Not a version: ${arg} (use x.y.z)`); process.exit(1); }
    files.set(file, text.replace(re, `$1${arg}`));
  } else files.set(file, text);
}

if (arg && arg !== "--check") {
  for (const [file, text] of files) writeFileSync(join(root, file), text);
  console.log(`Set ${found.length} spots to ${arg}. Add "## ${arg} — YYYY-MM-DD" to CHANGELOG.md.`);
  process.exit(0);
}
for (const [file, v] of found) console.log(`${v}\t${file}`);
const all = new Set(found.map(([, v]) => v));
if (all.size > 1) {
  console.error(`Versions differ. Run: node scripts/version.mjs <x.y.z>`);
  process.exit(arg === "--check" ? 1 : 0);
}
