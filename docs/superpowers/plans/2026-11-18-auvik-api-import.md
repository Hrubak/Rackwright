# Auvik API Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the web app, import an Auvik multi-client tenant into a Rackwright client. Each client tenant becomes a site with its own "<Site> (Auvik)" rack document. There is a preview first, and re-imports are safe.

**Architecture:**
- The Rust server proxies Auvik (reqwest + rustls). The key stays in a server-side env file. The server follows pagination, retries when rate-limited and returns a trimmed JSON per tenant.
- The browser maps that JSON to the existing `AuvikDevice` shape and reuses `buildItems` → `resolvePlan` → `computeDiff` → `applyInPlace`.
- It then saves each site's document through the racks API.

**Tech Stack:** React 18 + TypeScript (Vite, `npx tsx` script tests), Rust axum 0.7 + rusqlite + reqwest 0.12 (rustls), bash install scripts.

**Spec:** `docs/superpowers/specs/2026-11-18-auvik-api-import-design.md` (approved 2026-11-18). Read it before any task.

**Start point:** branch `web` **after 3.18.0 (Word report) has shipped**. Pull first, because the bot commits `Rackwright.exe`.

## Global Constraints

- Release version is `3.19.0` (`node scripts/version.mjs 3.19.0`). CHANGELOG heading is `## 3.19.0 — <date>`.
- Web only. New UI code lives in `rackwright-tauri/src/auvik/api/` and is reached only behind `IS_WEB`. `grep -l tauri-apps web/dist/assets/*.js` must still find nothing, and the desktop build must not import `auvik/api/*` statically.
- `.rack.json`: every new field is optional. Older files load and save unchanged apart from the new fields.
- **The Auvik key** (`AUVIK_API_KEY`) never appears in any response, log line, error message, `Debug` output, test snapshot or the repo. The browser only ever gets `configured`, `region` and `username`.
- Env vars: `AUVIK_API_KEY`, `AUVIK_USERNAME`, `AUVIK_REGION` (must match `^[a-z]{2,3}[0-9]{1,2}$`), and `AUVIK_BASE_URL` (test-only override).
  - Base URL: `https://auvikapi.<region>.my.auvik.com/v1`.
  - Auth: HTTP Basic with username + key.
- Env file `/etc/rackwright/auvik.env`, owned by root, mode 600, never overwritten once it exists. The unit line is `EnvironmentFile=-/etc/rackwright/auvik.env`.
- **HTTP limits:**
  - 20 s per request;
  - `page[first]=1000`, following `links.next`, with a cap of 50 pages per endpoint;
  - on 429 or 503: `Retry-After`, else back off 1, 2, 4, 8, 16 s, at most 5 retries, then "Auvik is busy. Try again in a few minutes.";
  - one Auvik request at a time per process;
  - 3-minute cap per tenant inventory on the server, and the browser waits up to 4 minutes per site.
- **Test data:** made-up only. Tenants "Example IT", "EX Main Office", "EX Warehouse"; devices like "EX-SW01"; IPs 192.0.2.x / 198.51.100.x. The test key string is `TESTKEY-do-not-leak-7f3a`.
- UI copy is plain language. Colours go only through `v(token)`.
- Before every commit:
  - `cd rackwright-tauri && npm run build && npm run build:web && for t in scripts/*.test.ts; do npx tsx $t; done`;
  - then the customer-data scan from AGENTS.md/handoff, which must print only `rackwright-tauri/src/auvik/plan.ts:48`.
- No local Rust. CI is the first compile, so Rust tasks are verified by CI after the user says "Push it". Do not push without that.
- Commit with `git -c user.name=Hrubak -c user.email=hrubak@gmail.com commit`, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `web/API.md` changes before the server code (Task 4).

## Review Focus

1. **Auvik returns an error body that quotes the request** (for example the `Authorization` header echoed back). The response title must be filtered so the key never passes through. Tested in Task 5 ("mock echoes the auth header").
2. **A tenant whose device list is huge or paginates forever.** The 50-page cap stops it with a clear note, not a hang. Tested in Task 5 (`links.next` pointing to itself).
3. **Two Auvik devices share a serial or a MAC** (stack members, HA pairs). Matching must not merge them into one Rackwright device. Tested in Task 3 (`used` set honoured across id/serial/MAC fallbacks).
4. **Someone saves the site's rack while the import runs.** A 409 reload-and-retry once, otherwise "Skipped <rack>: someone is editing it", and other sites still import. Tested in Task 8.
5. **A tenant renamed in Auvik since the last import.** It is still found by `auvik.tenant`, not by name, so no second site or document appears. Tested in Task 8.

---

## File structure

| File | Responsibility |
|---|---|
| `rackwright-tauri/scripts/fixtures/auvikFixture.ts` (new) | The synthetic .xlsx device builder moved out of `auvik.test.ts`, so two tests share it |
| `rackwright-tauri/scripts/fixtures/auvik-xlsx-snapshot.json` (new) | Recorded pre-change result of the .xlsx import and re-import |
| `rackwright-tauri/scripts/auvik-xlsx-regress.test.ts` (new) | .xlsx regression test |
| `rackwright-tauri/src/source.ts` (new) | `FieldSource` type, `setSource`, `isManual` |
| `rackwright-tauri/src/types.ts` | `Device.source`, `AuvikMeta.tenant` / `source` |
| `rackwright-tauri/src/auvik/parse.ts` | `AuvikDevice.apiId?`, `hostname?` |
| `rackwright-tauri/src/auvik/plan.ts` | `auvikKey` prefers `api:<apiId>`; `Ident` and `matchesDevice` extended |
| `rackwright-tauri/src/auvik/diff.ts` | `computeDiff(..., opts?: DiffOpts)` with the fill rule |
| `rackwright-tauri/src/auvik/apply.ts` | writes `source: "auvik"`; passes `DiffOpts` through |
| `rackwright-tauri/src/imports/apply.ts` | writes `source: "csv"` |
| `rackwright-tauri/src/App.tsx` | `devSet` writes `source: "manual"` |
| `rackwright-tauri/src/auvik/api/map.ts` (new) | `AuvikApiDevice` → `AuvikDevice` + `specs`; type words |
| `rackwright-tauri/src/auvik/api/sync.ts` (new) | Per-site planning, columns, cross-document fill, layout auto-place, save |
| `rackwright-tauri/src/auvik/api/ImportAuvikApi.tsx` (new) | The stepper screen |
| `rackwright-tauri/src/api.ts` | `auvikStatus`, `auvikTest`, `auvikTenants`, `auvikInventory` |
| `rackwright-tauri/src/clients/ClientPage.tsx` | "Import from Auvik" button, web + configured only, lazy import |
| `rackwright-tauri/scripts/auvik-api.test.ts` (new) | Front-end tests for the above |
| `web/API.md` | The `/api/auvik*` contract |
| `web/server/Cargo.toml` | `reqwest` |
| `web/server/src/auvik.rs` (new) | Config, client, retry, pagination, routes |
| `web/server/src/lib.rs` | `AppState.auvik`, `build_app_with`, routes |
| `web/server/src/main.rs` | unchanged (uses `build_app`, which reads the env) |
| `web/server/tests/auvik.rs` (new) | Mock Auvik + server tests |
| `web/server/tests/fixtures/auvik/*.json` (new) | Recorded made-up Auvik responses + expected trimmed output |
| `proxmox/install/rackwright-install.sh` | Env file, unit line, update drop-in |
| `README.md`, `CHANGELOG.md`, `docs/roadmap.md` | Release docs |

---

### Task 1: .xlsx regression snapshot (before any matching change)

**Files:**
- Create: `rackwright-tauri/scripts/fixtures/auvikFixture.ts`, `rackwright-tauri/scripts/auvik-xlsx-regress.test.ts`, `rackwright-tauri/scripts/fixtures/auvik-xlsx-snapshot.json`
- Modify: `rackwright-tauri/scripts/auvik.test.ts:14-~60` (import the builder instead of defining it)

**Interfaces:**
- Produces: `export function fixtureSheets(extra?: D[], drop?: string[], ipChange?: Record<string,string>): Sheets` and `export type D` in `auvikFixture.ts`, moved unchanged from `auvik.test.ts`.
- Produces: `snapshotOf(doc: Doc, diff: Diff): object`, local to the test. It strips `source` from every device and endpoint, and keeps `changes` as `[id, cat, defaultOn]` tuples sorted by id.

- [ ] **Step 1: Move the builder.** Move the fixture section of `auvik.test.ts` (`HEAD`, `stable`, `mac`, `ipFor`, `D`, `row`, `devices` and the sheet builder) into `auvikFixture.ts` and import it back. Run `npx tsx scripts/auvik.test.ts`. Expected: same pass output as before.
- [ ] **Step 2: Write the regression test.**
  - Scenario A: first import into an empty doc with `applyPlan(..., {target:"new", ...})`.
  - Scenario B: a re-import of `fixtureSheets([{name:"EX-NEW", type:"Switch", model:"HP 2530-24G-PoE+", serial:"NEWser"}], ["EX-SW-02"], {"EX-CORE":"10.99.1.99"})` into A's doc. Hand-lock `ip` on EX-CORE (`locked:["ip"]`) before the re-import. Use `computeDiff` + `applyInPlace` with the default selection.
  - With `UPDATE_SNAPSHOT=1`, write `{A: snapshotOf(...), B: snapshotOf(...)}` to the JSON file. Otherwise `assert.deepStrictEqual` against it.
- [ ] **Step 3: Record the snapshot on today's code.** Run `UPDATE_SNAPSHOT=1 npx tsx scripts/auvik-xlsx-regress.test.ts`, then `npx tsx scripts/auvik-xlsx-regress.test.ts`. Expected: PASS. Check that the JSON contains no real names (scan).
- [ ] **Step 4: Commit** with the message "test(auvik): record .xlsx import/re-import snapshot before matching changes".

### Task 2: Field source and data-model fields

**Files:**
- Create: `rackwright-tauri/src/source.ts`
- Modify: `src/types.ts:2-26`, `src/auvik/parse.ts:5-14`, `src/auvik/apply.ts` (`fill`, and new-device creation around line 150-175), `src/imports/apply.ts` (wherever it sets device fields), `src/App.tsx:484-490` (`devSet`)
- Test: `rackwright-tauri/scripts/auvik-api.test.ts` (new; sections are added by later tasks)

**Interfaces:**
- Produces in `source.ts`:
  - `export type FieldSource = "auvik" | "asio" | "csv" | "manual"`;
  - `export function setSource(d: { source?: Record<string, FieldSource> }, field: string, src: FieldSource): void`;
  - `export const isManual = (d: Device, field: string) => d.locked?.includes(field) || d.source?.[field] === "manual"`.
- Produces in `types.ts`: `Device.source?: Record<string, FieldSource>`; `AuvikMeta.tenant?: string`; `AuvikMeta.source?: "api" | "xlsx"`.
- Produces in `parse.ts`: `AuvikDevice.apiId?: string`; `AuvikDevice.hostname?: string`.
- Field keys: `name type model serial ip mac notes manufacturer os hostname`, plus `specs.<key>` for spec entries.

- [ ] **Step 1: Write failing tests** in `auvik-api.test.ts`:
  - `setSource` creates the map and overwrites an entry;
  - `isManual` is true for `locked` and for `source.x === "manual"`;
  - **round trip:** an old doc JSON (from `Homelab.rack.json`) through `JSON.parse` → `applyInPlace` with an empty plan → `JSON.stringify` has no `source` key on untouched devices;
  - `applyInPlace` of the Task 1 fixture sets `source.serial === "auvik"` on EX-CORE;
  - `devSet`-equivalent logic: extract `markManual(x: Device, k: string)` into `source.ts`. Test that it sets `source[k]="manual"` and keeps today's rule of pushing `k` into `locked` only when `x.auvik_id`.
- [ ] **Step 2: Run** `npx tsx scripts/auvik-api.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Add `source.ts` and the type fields.
  - In `auvik/apply.ts` `fill()` and new-device creation, call `setSource(d, f, "auvik")` for each field written, and for each `specs` key written.
  - In `imports/apply.ts`, call `setSource(..., "csv")` where fields are set.
  - In `App.tsx` `devSet`, replace the inline `locked` line with `markManual(x, k)`.
  - Set `doc.auvik.source = "xlsx"` in the existing .xlsx apply path only where `doc.auvik` is already written.
- [ ] **Step 4: Run** the new test and `npx tsx scripts/auvik-xlsx-regress.test.ts`. Expected: both PASS (the snapshot strips `source`).
- [ ] **Step 5: Run** `npm run build && npm run build:web`. Expected: success.
- [ ] **Step 6: Commit** "feat: per-field source tracking (auvik, asio, csv, manual)".

### Task 3: Matching order and the fill rule

**Files:**
- Modify: `src/auvik/plan.ts:29-30` (`auvikKey`), `:629-639` (`Ident`, `identOf`, `matchesDevice`); `src/auvik/diff.ts:56-67` (`matchUnits`), `:83-94` (`deviceFields`), `:121-138` (`computeDiff`); `src/auvik/apply.ts:51` (`applyInPlace` signature)
- Test: `scripts/auvik-api.test.ts`, `scripts/auvik-xlsx-regress.test.ts`

**Interfaces:**
- `auvikKey(d) = d.apiId ? "api:" + d.apiId : d.serial || d.macs[0] || d.name`
- `Ident` gains `apiKey: string | null` (`"api:<id>"` or null), `ips: string[]` and `host: string` (hostname, else name, lower-cased).
- `matchesDevice(d, id)` tries, in order:
  1. `d.auvik_id === id.apiKey`;
  2. serial (`d.serial` or the `auvik_id` base);
  3. MAC (`auvik_macs` or `d.mac`);
  4. `id.ips.includes(d.ip)` AND (`d.hostname` or `d.name`, lower-cased) `=== id.host`;
  5. finally the existing Auvik-name rule, only when `d.auvik_id` is set.
  - Steps 2–4 now also apply to devices **without** `auvik_id` (added from CSV or by hand). `g:` and `vm:` devices are still excluded by `matchUnits`.
  - `matchUnits` keeps its `used` set, so one document device is never matched twice.
- `export interface DiffOpts { fill?: "empty" | "overwrite" }`
- `computeDiff(doc, plan, items, opts?: DiffOpts)`. With `opts.fill`, a `fld:` change gets:
  - `defaultOn = fill === "overwrite" ? !isManual(d, field) : (docValue === "" && !isManual(d, field))`;
  - `locked: isManual(d, field)`;
  - a `detail` that adds `kept (from <source>)` when it is off by default.
  - Without `opts`, behaviour is unchanged.
- `applyInPlace(doc, plan, opt, items, sel, diffOpts?: DiffOpts)` passes `diffOpts` to its internal `computeDiff`. On a match it rewrites `auvik_id` to `api:<id>` when the unit has an `apiId`.

- [ ] **Step 1: Write failing tests** in `auvik-api.test.ts`:
  - match by api id even when the serial changed;
  - fallback to serial on a CSV-added device (no `auvik_id`);
  - fallback to MAC;
  - IP + hostname matches, but IP alone does not;
  - **Review Focus 3:** two plan units with the same serial match two different doc devices or one plus a new device, never the same device;
  - `fill:"empty"`: serial empty → on, model set → off with "kept (from csv)";
  - `fill:"overwrite"`: model set → on, but a `source.model==="manual"` field stays off;
  - re-import keeps hand edits: a `locked:["name"]` device keeps its name under both modes by default.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `npx tsx scripts/auvik-api.test.ts`, `npx tsx scripts/auvik-xlsx-regress.test.ts` and `npx tsx scripts/auvik.test.ts`. Expected: all PASS. The regression snapshot must pass **without** re-recording. If it differs, stop and report the difference rather than updating the snapshot.
- [ ] **Step 5: Commit** "feat(auvik): match on Auvik id, then serial, MAC, IP+hostname; fill-empty rule".

### Task 4: Server config, client and status/test routes

**Files:**
- Modify first: `web/API.md` (new section "Auvik (web only)", copied from the spec's Server API table and `AuvikApiDevice`, plus the env vars in the runtime table, with `AUVIK_BASE_URL` marked test-only)
- Modify: `web/server/Cargo.toml` (`reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }`), `web/server/src/lib.rs:44-47, 684-692, 696-730`
- Create: `web/server/src/auvik.rs`, `web/server/tests/auvik.rs`, `web/server/tests/fixtures/auvik/verify-ok.json`, `verify-denied.json`

**Interfaces:**
- `pub struct AuvikCfg { base: String, username: String, region: String, key: Secret }` and `pub struct Secret(String)`, with a hand-written `Debug` printing `"***"` and no `Display`.
- `impl AuvikCfg { pub fn from_env() -> Option<AuvikCfg>; pub fn new(base: &str, username: &str, region: &str, key: &str) -> AuvikCfg }`.
  - `from_env` returns None unless key, username and region are all non-empty and the region matches the pattern.
  - When the region is invalid it prints `eprintln!("rackwright-server: AUVIK_REGION is not valid; Auvik import is off")`.
- `AppState` gains `auvik: Option<auvik::Auvik>`, where `pub struct Auvik { cfg: AuvikCfg, http: reqwest::Client, gate: tokio::sync::Mutex<()> }`.
- `pub fn build_app_with(data_dir, static_dir, auvik: Option<AuvikCfg>) -> Result<Router, String>`. `build_app` calls it with `AuvikCfg::from_env()`.
- `async fn get(&self, path_and_query: &str) -> Result<Value, AuvikErr>` handles the Basic auth, the 20 s timeout and retry. `enum AuvikErr { Denied(String), Busy, Failed(String) }`.
  - Each string is a sanitized title: `errors[0].title`, falling back to fixed text.
  - `sanitize(s, key)` returns the fixed text "Auvik refused the request." if `s` contains the key; otherwise it is cut to 200 characters.
  - reqwest error text is never used.
- Routes: `GET /api/auvik` and `POST /api/auvik/test`, both behind `auth(&st, &headers)?`.

- [ ] **Step 1: Write the failing tests** in `tests/auvik.rs`. Spawn a mock axum server on `127.0.0.1:0` (tokio `TcpListener`) and build the app with `build_app_with(tmp, tmp, Some(AuvikCfg::new(&mock_url, "api-user@example.com", "us1", "TESTKEY-do-not-leak-7f3a")))`. Sign up the first user as in `api.rs`.
  - `status_not_configured`: app built with `None` → `{configured:false, region:"", username:""}`; `POST /api/auvik/test` → 404 `"Auvik is not set up on this server."`.
  - `status_configured`: `{configured:true, region:"us1", username:"api-user@example.com"}`, and the body string does not contain `TESTKEY`.
  - `test_ok`: the mock returns 200 on `/authentication/verify` only when Basic auth decodes to `api-user@example.com:TESTKEY-do-not-leak-7f3a` → `{ok:true}`.
  - `test_denied`: the mock returns 401 with `{"errors":[{"title":"Invalid credentials"}]}` → `{ok:false, error:"Invalid credentials"}`.
  - `test_echo_filtered`: the mock returns 401 with a title containing the received `Authorization` header and key → `error == "Auvik refused the request."`.
  - `debug_redacts`: `format!("{:?}", cfg)` does not contain `TESTKEY`.
  - `region_check`: `pub fn valid_region(s: &str) -> bool`, which `from_env` uses. `us1`, `eu2` and `au1` → true; `evil.com/`, `US1`, `""` and `us` → false.
  - Signed out → 401.
- [ ] **Step 2: Implement** `auvik.rs` and wire up `lib.rs`.
- [ ] **Step 3: Self-check without Rust.** Re-read for E0597 (bind `query_map` results before ending a block), `Send` across `.await` (no `MutexGuard` from `std` held over an await; the gate is `tokio::sync::Mutex`) and the axum 0.7 handler signatures. CI compiles it on the next approved push.
- [ ] **Step 4: Commit** "feat(server): Auvik config, status and test connection (key never leaves the server)".

### Task 5: Server tenants and inventory

**Files:**
- Modify: `web/server/src/auvik.rs`, `web/server/src/lib.rs` (routes), `web/server/tests/auvik.rs`
- Create fixtures in `web/server/tests/fixtures/auvik/`:
  - `tenants.json` and `tenants-detail.json` (Example IT multiClient; EX Main Office, EX Warehouse, EX Denied, EX Empty as clients);
  - `device-info-main-p1.json`, `-p2.json`, `-p3.json` (`links.next` chain, about 12 devices including an "EX-UPS01" with no model or serial);
  - `device-detail-main.json`, `component-info-main.json`;
  - `device-info-warehouse.json` (3 devices);
  - `expected-inventory-main.json`, the exact trimmed response, also read by Task 7.
  - Pin the Auvik attribute names from Auvik's public API docs: `deviceName`, `deviceType`, `makeModel`, `vendorName`, `serialNumber`, `firmwareVersion`, `softwareVersion`, `ipAddresses`, `macAddress`, `onlineStatus`, `discoveryStatus`, `componentType`, and the relationship to the device. If a name differs, use Auvik's and note it in the fixture README line.

**Interfaces:**
- `GET /api/auvik/tenants` → `[{id, name, type, parent}]`, multiClient first, then by name.
- `GET /api/auvik/tenants/:id/inventory` → `{status, note, devices: [AuvikApiDevice]}`.
- `AuvikApiDevice = {id, name, type, makeModel, vendor, serial, firmware, software, ips, macs, status, discovery, components: [{type, name, detail}]}`. Missing values are `""` or `[]`.
- `async fn paged(&self, first_path: &str) -> Result<Vec<Value>, AuvikErr>` follows `links.next` and stops at 50 pages with `Failed("Auvik returned too many pages for this site.")`.
  - `links.next` may be absolute. Only its path and query are reused against `cfg.base`, so a `next` pointing at another host is never called.
- Retry: on 429/503, honour `Retry-After` in seconds, else 1, 2, 4, 8, 16 s; after 5 retries return `Busy`. Tests use `Retry-After: 0`.
- The whole inventory runs under `tokio::time::timeout(180 s)`, which maps to 502 "Reading this site from Auvik took too long."
- 401/403 on a tenant → 200 `{status:"denied", note:"Rackwright's Auvik key can't read this site.", devices:[]}`.
- Zero devices → `{status:"empty", note:"No devices found. The site may have no collector.", devices:[]}`.

- [ ] **Step 1: Write failing tests:**
  - `tenants_listed` (order and types);
  - `pagination_three_pages` (all devices; response equals `expected-inventory-main.json`);
  - `rate_limited_then_ok` (the mock returns two 429s with `Retry-After: 0`, then data);
  - `busy_after_retries` (always 429 → 502 with the fixed message);
  - `denied_site` and `empty_site` (200 with the status and note);
  - `missing_fields` (EX-UPS01 has `makeModel:""`, `serial:""`);
  - `next_loop_capped` (Review Focus 2: `links.next` points to itself → 502 "too many pages");
  - `next_other_host_ignored` (an absolute `next` on another host is fetched from the mock base);
  - `key_never_leaks`:
    - collect every response body from every test in this file through a shared helper, and assert none contains `TESTKEY`;
    - all of `auvik.rs`'s logging goes through `pub fn log(msg: &str)`, which `eprintln!`s and also appends to `static LOG: Mutex<Vec<String>>`. `pub fn log_lines() -> Vec<String>` exposes it, and the test asserts no line contains `TESTKEY`;
    - the mock also echoes the `Authorization` header in a 500 error body on the inventory route, to prove it is filtered there too.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Self-check** as in Task 4.
- [ ] **Step 4: Commit** "feat(server): Auvik tenants and per-site inventory with paging, retry and skips".

### Task 6: Install script, update path and README

**Files:**
- Modify: `proxmox/install/rackwright-install.sh` (unit at about line 134-150, and the `--functions-only` build function used by `update`), `README.md`

**Interfaces:**
- `ensure_auvik_env()` (bash, in the functions part, so `update` gets it too):
  - creates `/etc/rackwright` (755) and `/etc/rackwright/auvik.env` only if absent, mode 600, `root:root`, containing the commented lines `# AUVIK_USERNAME=`, `# AUVIK_REGION=us1` and `# AUVIK_API_KEY=`;
  - writes `/etc/systemd/system/rackwright.service.d/auvik.conf` with `[Service]` and `EnvironmentFile=-/etc/rackwright/auvik.env` if it is absent;
  - runs `systemctl daemon-reload`.
  - Running it twice changes nothing.
- Fresh installs also get the same `EnvironmentFile=` line in the unit, or rely on the drop-in. Choose one so the line is not duplicated; the drop-in alone is preferred.

- [ ] **Step 1: Implement** `ensure_auvik_env` and call it from both the install flow and the update build step.
- [ ] **Step 2: Verify.** Run `bash -n proxmox/install/rackwright-install.sh`, then `shellcheck` if available (CI runs it). Expected: no errors.
- [ ] **Step 3: README.** Add a "Connect Auvik (web)" section: edit `/etc/rackwright/auvik.env` with `nano`, uncomment the three lines, run `systemctl restart rackwright`, then use **Test connection** on a client's **Import from Auvik**. Say that the key stays on the server and is never shown in the app.
- [ ] **Step 4: Commit** "feat(install): Auvik env file (root, 600) for new and updated containers".

### Task 7: Mapping and placement (front end, pure)

**Files:**
- Create: `rackwright-tauri/src/auvik/api/map.ts`
- Modify: `src/edit.ts:269-274` (add `setOffColumn`), `scripts/auvik-api.test.ts`

**Interfaces:**
- `export interface AuvikApiDevice` exactly as in Task 5.
- `export function toAuvikDevice(a: AuvikApiDevice, org: string): AuvikDevice`:
  - `apiId=a.id`, `name=rawName=a.name`, `model=a.makeModel`, `type=TYPE_WORDS[a.type] ?? "Unknown"`;
  - `macs`, `ips`, `serial`, `firmware`, `software` copied over;
  - `status=a.status`, `networks=""`, `neighbors=[]`, `unnamed=false`, `rows=1`;
  - `description = a.discovery ? "discovery " + a.discovery : ""`.
- `export const TYPE_WORDS: Record<string,string>`. At least: `switch` "Switch", `l3Switch` "Layer 3 Switch", `stack` "Switch", `router` "Router", `firewall` "Firewall", `server` "Server", `hypervisor` "Hypervisor", `storage` "Storage", `ups` "UPS", `pdu` "PDU", `accessPoint` "Access Point", `wirelessController` "Controller", `virtualMachine` "Virtual Machine", `workstation` "Workstation", `printer` "Printer", `voipPhone` "IP Phone", `ipmi` "Intelligent Platform Management Interface", `unknown` "Unknown". Extend it from the Task 5 fixtures.
- `export function specsOf(c: AuvikApiDevice["components"]): Record<string,string>`. Keys: `"CPU"` ("2 × <name>"), `"Memory"` (sum, or the single detail), `"Disks"` ("<n>: <sizes>"), `"Power supplies"` (count). Keys with no components are left out.
- `export function apiItems(devs: AuvikApiDevice[], org: string, ctx?: HostCtx): { parsed: ParsedAuvik; items: PlanItem[] }`. It calls `buildItems`, then every `mode:"rack"` item gets `setMode(..., "off")`.
- `PlanItem` gains `hostGuessed?: boolean`. `apiItems` sets it true on VM rows whose `host` came from `guessHost`.
- `export const TO_PLACE_KINDS: Kind[] = ["firewall","router","switch","server","storage","ups","pdu"]`. Stack and hypervisor already classify as switch and server.
- In `edit.ts`: `export function setOffColumn(doc: Doc, d: Device, col: 0 | 1): void`. Column 0 is at `min(rack x) - RW - 160`, column 1 is a further `RW + 80` left. `fy` stacks below the lowest existing off-rack device whose `fx` equals that column's x. Existing devices are never moved.

- [ ] **Step 1: Write failing tests:**
  - each fixture type in `expected-inventory-main.json` (read with `fs` from `../web/server/tests/fixtures/auvik/`) maps to the right `classify()` kind and column;
  - EX-UPS01 with no model gets the generic UPS template;
  - `specsOf` strings;
  - no item has `mode:"rack"`;
  - a VM named like its host gets `host` set and `hostGuessed:true`;
  - `setOffColumn` keeps an existing off-rack device's `fx`/`fy` unchanged.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all `scripts/*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** "feat(auvik): map Auvik API devices to the import plan, to-place and inventory columns".

### Task 8: Per-site sync (front end, pure + API calls)

**Files:**
- Create: `rackwright-tauri/src/auvik/api/sync.ts`
- Modify: `src/api.ts` (four new calls), `scripts/auvik-api.test.ts`

**Interfaces:**
- In `api.ts`:
  - `auvikStatus() → {configured, region, username}`;
  - `auvikTest() → {ok, error?}`;
  - `auvikTenants() → AuvikTenant[]`, where `AuvikTenant = {id, name, type: "multiClient"|"client", parent: string|null}`;
  - `auvikInventory(id: string, signal?: AbortSignal) → {status: "ok"|"denied"|"empty", note: string, devices: AuvikApiDevice[]}`, with a 4-minute `AbortSignal.timeout` combined with the caller's signal.
- `export interface SiteDocs { siteId: number; racks: { id: number; name: string; version: number; doc: Doc }[] }`
- `export function findAuvikDoc(s: SiteDocs, tenantId: string): { id: number; legacy: boolean } | null`. It matches by `doc.auvik.tenant`. Otherwise, if exactly one rack has `doc.auvik` and no `tenant`, it returns that rack with `legacy: true`.
- `export function mapTenantToSite(t: AuvikTenant, client: ClientItem, docsBySite: Map<number, SiteDocs>): { siteId: number | null; name: string; isNew: boolean }`. The order is: tenant link, then trimmed case-insensitive name, then new.
- `export interface SitePlan { tenant: AuvikTenant; target: {...}; parsed; items; plan: ImportPlan; diff: Diff | null; other: { rackId: number; rackName: string; diff: Diff }[]; layoutRows?: Row[] }`
- `export function planSite(inv, tenant, siteDocs, defaults: {model: string; u: number}, fill: "empty"|"overwrite", layout?: ImportSpec): SitePlan`:
  - it builds the items;
  - it diffs against the "(Auvik)" document if one exists;
  - it diffs fill-only against each **other** rack document of the site, so only `fld:` changes are kept;
  - with `layout`, it runs `planImport` from `imports/plan.ts` on the would-be document to find placements.
- `export function applySite(p: SitePlan, sel: Set<string>): { auvikDoc: Doc; others: { rackId: number; doc: Doc }[] }`:
  - a new document starts as `{v:1,nid:1,racks:[],devices:[],cables:[]}` with `addRack(doc, "Rack 1", defaults.u, specOf(modelById(defaults.model)))`;
  - then `applyInPlace(..., {target:"current", rackId}, items, sel, {fill})`;
  - then every device created by this run goes through `setOffColumn` (column 0 for `TO_PLACE_KINDS`, column 1 otherwise);
  - then layout placements are applied with `applyImport`;
  - finally it sets `doc.auvik = {...doc.auvik, tenant: tenant.id, source: "api", site: tenant.name, imported: <ISO date>}`.
- `export async function saveSite(...)` creates the site if needed (`clientStore().addSite`) and creates or updates the documents with `A.createRack(name + " (Auvik)", doc, siteId)` / `A.updateRack`. On a 409 it reloads with `A.getRack`, re-plans that one document and retries once, otherwise returning `Skipped <rack>: someone is editing it`. It returns a per-site result line.

- [ ] **Step 1: Write failing tests** (pure parts, made-up data):
  - `findAuvikDoc` finds by tenant even after a rename (**Review Focus 5**), and finds a legacy .xlsx document;
  - `mapTenantToSite` order;
  - `planSite` on a fresh site produces one rack with all rack-kind devices in column 0;
  - a re-import into a document where EX-SW01 was moved into the rack keeps its `rack`/`u` and fills only its empty firmware;
  - a device matched in a second rack document appears in `other` with a fill-only change;
  - `fill:"overwrite"` ticks set values but not manual ones;
  - with a small RackMap text layout naming EX-SW01 at U40, that device ends at U40 and the others stay off-rack;
  - `saveSite` with a mocked `A` (inject an `api` param, defaulting to `A`): a first 409 then success saves once; two 409s return the "Skipped" line, and the next site is still saved (**Review Focus 4**).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all `scripts/*.test.ts` plus both builds. Expected: PASS.
- [ ] **Step 5: Commit** "feat(auvik): per-site plan, fill rules across the site's racks, safe save".

### Task 9: The Import from Auvik screen

**Files:**
- Create: `rackwright-tauri/src/auvik/api/ImportAuvikApi.tsx`
- Modify: `src/clients/ClientPage.tsx:~187` (button and lazy `import("../auvik/api/ImportAuvikApi")` behind `IS_WEB`; status fetched once with `auvikStatus()`)

**Interfaces:**
- `export default function ImportAuvikApi({ client, onDone, onClose }: { client: ClientItem; onDone: () => Promise<unknown> | void; onClose: () => void })`
- Steps and copy follow the spec's "Front end" section:
  - "Connected to Auvik (<region>, <username>)" and **Test connection**;
  - choose the Auvik client, then tick sites with the site drop-down ("(new site)", "Update <legacy name>");
  - "Reading site N of M: <name>…" with a progress bar and **Stop**;
  - preview tabs per site: the device table with tickboxes, kind, model, template, height, destination ("To place" / "Inventory"); the Changes view reusing the `ImportAuvik.tsx` change list rendering; **Overwrite existing values**; **Add rack layout**; "Guessed host — check" next to a VM's host drop-down when `hostGuessed`; skipped sites as a greyed tab with their note;
  - **Import**, then the summary.
- Reuse `ImportAuvik.tsx`'s `btn`/`inp` styles and change-group rendering. If the change list must be shared, extract it to `auvik/ChangeList.tsx` with no behaviour change.

- [ ] **Step 1: Implement** the screen and the button.
- [ ] **Step 2: Builds.** Run `npm run build && npm run build:web`, then `grep -l tauri-apps ../web/dist/assets/*.js` (expected: nothing) and `grep -l ImportAuvikApi dist/assets/*.js` on the desktop build (expected: nothing, or only a lazy chunk not referenced by the desktop entry).
- [ ] **Step 3: Browser check without the live server.**
  - Start `RW_API=http://127.0.0.1:9 npx vite --mode web --port 1421 --strictPort` in the background.
  - In the built-in browser, inject a `fetch` mock that serves `/api/me`, the clients and the four `/api/auvik*` routes from the Task 5 fixtures, and records the PUT/POST bodies.
  - Walk the steps: Test connection ok and failed; tick three sites including EX Denied; watch the progress; untick one device; Import.
  - Confirm the recorded POST/PUT has "EX Main Office (Auvik)" with the to-place devices off-rack and no `TESTKEY`.
  - Check the dark and light themes. Take a screenshot of the preview.
  - Never sign in to or write to the live server.
- [ ] **Step 4: Commit** "feat(auvik): Import from Auvik screen (web)".

### Task 10: Release 3.19.0

**Files:**
- Modify: `CHANGELOG.md`, the version files via the script, `docs/roadmap.md`, `README.md` (if Task 6 left anything)

- [ ] **Step 1:** Run `node scripts/version.mjs 3.19.0` and `node scripts/version.mjs --check`. Expected: OK.
- [ ] **Step 2: CHANGELOG** `## 3.19.0 — <date>`, in plain sentences:
  - web only: Import from Auvik on a client;
  - admins set the key in `/etc/rackwright/auvik.env`;
  - one "(Auvik)" rack per site, with "to place" and inventory columns;
  - re-imports fill empty fields only unless you pick Overwrite;
  - each field remembers where it came from;
  - cables come in 3.20.0;
  - desktop unchanged.
- [ ] **Step 3: Roadmap.** Add an "Integrations" section: 3.19.0 Auvik API import, 3.20.0 Auvik cables, then the VM migration plan, then Fill from Asio. Link the spec.
- [ ] **Step 4:** Run the full pre-commit checks (Global Constraints) and the scan. Expected: everything passes, and the scan prints only `plan.ts:48`.
- [ ] **Step 5: Commit** "Release 3.19.0: Auvik API import (web)".
- [ ] **Step 6:** Stop. Ask the user to push. Do not push until they say "Push it". After pushing, watch CI and Desktop exe (`gh run watch <id> -R Hrubak/Rackwright`). The first Rust compile happens here, so fix any CI failures in follow-up commits (asking before each push), then pull the bot's exe commit.

---

## Follow-up release 3.20.0: Auvik cables (separate plan, written after 3.19.0 ships)

Outline only. Brainstorm and write its own plan when 3.19.0 is out.

- Server: `GET /api/auvik/tenants/:id/links`, which pulls `/inventory/interface/info` and Auvik's network topology/neighbour data, with the same paging, retry, cap and key rules. It returns `[{device_id, iface, neighbor_device_id, neighbor_iface}]`.
- Front end: fill `AuvikDevice.neighbors` (`name` + `iface`) from that, so `buildLinks`, the port mapping, endpoint groups attached to switches and the cable diff work unchanged.
- Re-import: the existing `cn:` / `mv:` / `gone:` cable changes. Cables in other rack documents are touched only when both ends are matched there.
- Tests: made-up interface and topology fixtures, a re-import that keeps hand-moved cables, and the key-leak check extended to the new route.
- Then the VM migration plan, then Fill from Asio.
