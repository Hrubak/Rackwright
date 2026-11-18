# Auvik API import — design

Status: approved 2026-11-18. Release: 3.19.0, the first release after 3.18.0 (Word report). Web only.

## Why

The web app should pull a client's devices straight from Auvik, so techs no longer export an .xlsx for each site and upload it. The result has to be accurate for the techs and clean enough to show the client, like the rest of Rackwright. Later work builds on the same foundations: the VM migration plan, and "Fill from Asio", which reuses the per-field source tracking and the "fill empty fields only" rule.

## Goals

- On the web, import an Auvik **multi-client tenant** into a Rackwright **Client**. Each child **client tenant** becomes a **Site**.
- For each site, pull device info, device detail (discovery status) and components (CPUs, memory, disks, power supplies).
- Show a preview before anything is written. The user can untick sites and devices.
- Put rack-mountable gear in a "to place" column and everything else in a non-rack inventory column. Place devices automatically only when a RackMap layout is supplied for that site.
- Make re-importing safe: fill empty fields only unless the user picks overwrite, record which source each field came from, and never wipe placements, hand edits or (later) the migration plan.

## Non-goals (this release)

- **Cables.** The device, detail and component endpoints carry no neighbour data. Cables come in the follow-up release (see "Follow-up: cables").
- **Desktop.** The desktop app keeps the CSV/.xlsx import unchanged.
- **Typing the key into the web app.** The key is set on the server only (see "Credentials").
- **A site-level inventory separate from racks** (option B in the conversation). It can come later if one site ends up with several racks.

## Anti-goals (failure even if it "works")

- The Auvik key appears anywhere outside the server process: a response, a log line, an error message, debug output, a test snapshot or the repository.
- A re-import overwrites a hand edit, moves a placed device back off-rack, or deletes something the user added.
- One unreadable or empty Auvik site fails the whole import.
- Real customer data ends up in tests, fixtures or commits.

## Constraints

- One React front end for desktop and web. The new screen is web-only code in its own files and is reached only behind `IS_WEB`. Desktop builds must not pull in any of it.
- `.rack.json` stays one format. Every new field is optional, and older files load and save unchanged. `model.rs` already keeps unknown fields through `#[serde(flatten)]`, and the server stores the document text as received.
- `web/API.md` changes first, before the server code.
- No Rust on the dev PC: CI is the first compile and the first `cargo test`.
- UI copy is plain language. Colours go only through `v(token)`.
- Run the customer-data scan before every commit. Tests use made-up names such as "Example IT", "EX-SW01" and 192.0.2.x/198.51.100.x addresses.

## Approaches considered

1. **The server proxies Auvik; the browser builds the plan (chosen).** The server makes the HTTPS calls, follows pagination, retries when rate-limited and returns a trimmed JSON of only the fields we use. The browser maps that JSON to the existing `AuvikDevice` shape and runs the existing `buildItems` → `resolvePlan` → `computeDiff` → `applyInPlace` pipeline. It then saves each site's rack document through the existing racks API.
   - Pro: reuses all of the CSV import's classification, catalog matching, diff, locks and review UI. The server stays small and keeps the key.
   - Con: the browser holds a whole site's device list in memory. That is fine at around 120 devices per site.
2. **The server builds the plan and writes the documents.** Rejected. It would mean porting `plan.ts`, `apply.ts` and `diff.ts` to Rust, two copies of the logic would drift, and there would be no preview without sending the plan back to the browser anyway.
3. **The browser calls Auvik directly.** Rejected. Auvik doesn't allow cross-origin calls, and the key would be exposed in the browser.

Where it lands (chosen in the conversation): **option A**. There is one rack document per Auvik site, named "<Site> (Auvik)" (for example "Main office (Auvik)"), stored in that site. It holds one empty rack, the "to place" column of rack-mountable gear off-rack beside it, and a non-rack inventory column. It reuses the existing matching, locks, diff and Inventory screen.

## Credentials (server)

- Environment variables: `AUVIK_API_KEY`, `AUVIK_USERNAME` and `AUVIK_REGION` (for example `us1`, `eu1`).
  - Base URL: `https://auvikapi.<region>.my.auvik.com/v1`.
  - Auth: HTTP Basic with the username and API key.
  - The feature is "configured" only when all three are set and non-empty.
- `AUVIK_REGION` must match `^[a-z]{2,3}[0-9]{1,2}$`, since it goes into the host name. Otherwise Auvik counts as not configured, and the server prints a start-up line naming the variable only.
- `AUVIK_BASE_URL` (optional) overrides the base URL. It exists for the tests, which point it at a local mock server. It is documented as test-only in `web/API.md`.
- **Install script** (`proxmox/install/rackwright-install.sh`):
  - It creates `/etc/rackwright/auvik.env`, owned by root with mode 600. The file holds commented placeholder lines and is never overwritten if it already exists.
  - It adds `EnvironmentFile=-/etc/rackwright/auvik.env` to `rackwright.service`. The leading `-` means a missing file is not an error.
- **Containers that update instead of reinstalling:** `update` does not rewrite the unit. The build step that `update` sources (the `--functions-only` part) therefore also ensures:
  - the drop-in `/etc/systemd/system/rackwright.service.d/auvik.conf` with the same `EnvironmentFile=` line;
  - the env file itself (600, root);
  - a `systemctl daemon-reload`.
  - Running it twice changes nothing.
- The admin sets the key by editing that file and restarting the service. The README gets a short "Connect Auvik" section with the exact commands.
- **Never exposed:**
  - The key is read once at start-up into a struct whose `Debug` impl redacts it.
  - It is only ever used to build the `Authorization` header.
  - No log line, error or response contains it, and no error carries reqwest's internal error text either. Every error is mapped to a fixed message. Auvik's JSON:API `errors[0].title` is passed through only after a check that it does not contain the key.

## Server API (`web/API.md` first)

All routes need a signed-in user. When Auvik is not configured, every route except `GET /api/auvik` returns 404 `{"error":"Auvik is not set up on this server."}`.

| Method & path | Result |
|---|---|
| `GET /api/auvik` | `{"configured": bool, "region": str, "username": str}`. Never the key. `region` and `username` are `""` when not configured. |
| `POST /api/auvik/test` | Calls `GET /authentication/verify`. Returns `{"ok": true}` or `{"ok": false, "error": "<Auvik's error title, or a fixed message>"}`. Always 200, so the UI shows the message as-is. |
| `GET /api/auvik/tenants` | `/tenants` plus `/tenants/detail`. Returns `[{"id", "name", "type": "multiClient"\|"client", "parent": id\|null}]`, multi-client tenants first, by name. |
| `GET /api/auvik/tenants/:id/inventory` | One client tenant: device info, device detail and component info, each paged through `links.next`. Returns `{"status": "ok"\|"denied"\|"empty", "note": str, "devices": [AuvikApiDevice]}`. `denied` covers 401/403 for this tenant. `empty` means no devices came back, and the note reads "No devices found. The site may have no collector." Both are 200, so the browser skips the site with that note. Other Auvik failures return 502 with a fixed message. |

`AuvikApiDevice` is trimmed to what we use:

`{id, name, type, makeModel, vendor, serial, firmware, software, ips: [str], macs: [str], status, discovery: str, components: [{type, name, detail}]}`

Missing attributes become `""` or `[]`.

**HTTP behaviour:**
- `reqwest` with `rustls-tls`; no OpenSSL.
- A 20 s timeout per request.
- `page[first]=1000`, following `links.next` until it is absent. A hard cap of 50 pages per endpoint protects against a loop.
- **On 429 or 503:** honour `Retry-After` when present, otherwise back off 1, 2, 4, 8 and 16 s. Give up after 5 retries with "Auvik is busy. Try again in a few minutes."
- **Concurrency:** one Auvik request at a time per server process (a `tokio::sync::Mutex`), to stay inside Auvik's rate limits.
- **Call budget:** a site is about 3 to 6 calls (three endpoints, usually one page each), so 12 sites is about 50 calls.
- **Time limit per site:** a whole inventory read has a 3-minute cap on the server, and the browser waits up to 4 minutes per site. Hitting the cap counts as a failed site, not a failed import.

## Front end (web only)

**Entry point.** The client page gets an **Import from Auvik** button next to the existing **Import Auvik** (.xlsx) button. It appears only when `IS_WEB` and `GET /api/auvik` says `configured`. The new screen lives in `rackwright-tauri/src/auvik/api/`:
- `ImportAuvikApi.tsx` — the screen;
- `map.ts` — `AuvikApiDevice` → `AuvikDevice` and component specs;
- `sync.ts` — matching and the "fill empty only" field rule.

**Steps:**

1. **Connect.** Shows "Connected to Auvik (<region>, <username>)" with a **Test connection** button, which shows the result line.
2. **Choose the Auvik client.** A list of multi-client tenants. A standalone `client` tenant with no parent is also offered as its own client.
   - Choosing one lists its client tenants, each with a tickbox. Each tenant maps to a Rackwright site:
     - the site already linked to that tenant id (from an existing "(Auvik)" document's `auvik.tenant`);
     - else a site with the same name;
     - else a new site.
   - The user can change each mapping in a drop-down.
   - The Rackwright client is the one whose page the user started from.
3. **Read.** The browser fetches each ticked tenant's inventory **one at a time**, so progress shows naturally: "Reading site 3 of 12: Warehouse…", with a progress bar and a **Stop** button. Denied and empty sites are listed with their note and skipped.
4. **Preview, one tab per site.** This is the existing review table:
   - every device with a tickbox, plus its kind, model, catalog match, height and destination ("To place" or "Inventory");
   - for a site that already has an "(Auvik)" document, the existing **Changes** view from `computeDiff`, with the field rule below;
   - optionally, **Add rack layout** to attach a RackMap layout (text or file, read by the 3.15.0 readers) for that site. When one is attached, the tab also shows where each matched device will be placed.
   - Sites skipped at step 3 appear as a greyed-out tab with the note.
5. **Import.**
   - A new site is created with its name only and shown as "(new site)" in the preview.
   - Name matching against existing sites is trimmed and case-insensitive.
   - Each site is independent. If one fails, the others still import and the summary lists it. Running the import again is safe, because re-import matching makes it idempotent.
   - For each site, in order, the browser creates or updates "<Site> (Auvik)" through the racks API. It reloads and resaves on a 409 version conflict, re-running the merge. It finishes with a summary: added, updated, kept, skipped sites.

**Mapping (`map.ts`).**
- Auvik `deviceType` values become the human type words `classify()` already understands. For example, `switch`, `l3Switch` and `stack` → "Switch"; `hypervisor` → "Hypervisor"; `accessPoint` → "Access Point"; `virtualMachine` → "Virtual Machine".
- `makeModel` → `model`; `onlineStatus` → `status`; `neighbors` = `[]`.
- Components become `specs`:
  - "CPU": count × model;
  - "Memory": total;
  - "Disks": count and sizes;
  - "Power supplies": count.
- The discovery status goes on the "Auvik:" notes line.

**Placement.** Every item that would be `mode: "rack"` becomes off-rack:
- **"To place" column:** switch, stack, firewall, router, server, hypervisor, storage, UPS and PDU.
- **"Inventory" column**, further left: APs, IPMI, endpoint groups and VM boxes, as today.

**Endpoints and VMs without neighbours (my call).** With `neighbors = []`, endpoints can't attach to a switch. For the API import:
- endpoints go into unattached "Endpoints" group boxes in the Inventory column, one per kind (PCs, phones, IoT, printers, other), so they still show as members in the Inventory screen;
- VM boxes still work, because `guessHost` reads names, not neighbours. The preview marks every host guessed from names as "Guessed host — check" next to the existing host drop-down, so techs can fix it before importing;
- `Doc.auvik.unplaced` stays empty;
- the cables release attaches groups to switches later.

**Columns.** Only devices the import creates are laid out in the two columns. Existing off-rack devices are never moved.

**Heights.** Heights come from the catalog by make and model (`matchTemplate`). An unknown model gets the existing generic template for its kind. When a layout is attached, its rows are matched to these devices with the 3.15.0 matching (`imports/plan.ts`), and matched devices are moved into the document's racks. Unmatched devices stay in "To place". A new document gets one empty rack of the server's default rack model (System settings `rack_default_model` / `rack_default_u`).

## Data model (all optional fields)

**Identity (my call).** There is no separate id field.
- `AuvikDevice` gains an optional `apiId`, and `auvikKey()` returns `api:<apiId>` when it is set.
  - So `Device.auvik_id` holds `api:<id>` for API devices, and the existing plan keys, `g:` / `vm:` prefixes, `findMissing` and `matchUnits` work unchanged.
  - The .xlsx path has no `apiId`, so its keys don't change.

**Source.** `Device.source?: Record<string, "auvik" | "asio" | "csv" | "manual">` records which source last set each field.
- It covers `name`, `type`, `model`, `serial`, `ip`, `mac`, `notes`, `manufacturer`, `os`, `hostname` and each `specs.<key>`.
- Who writes it (my call): `applyInPlace` writes "auvik" for every field it sets, for both the API and the .xlsx Auvik paths. The 3.15.0 text/CSV import writes "csv". The hand-edit handler in `App.tsx` (where it sets `locked` today) writes "manual". These are small edits to shared code and harmless to the desktop.
- `locked` keeps its meaning, "never overwrite without a tick". `source` is provenance only. A field with `source: "manual"` and no `locked` is treated as locked.

**The "(Auvik)" document.** This extends the existing `Doc.auvik` (`AuvikMeta`) object rather than adding a new one: new `tenant?: string` and `source?: "api" | "xlsx"` fields.
- A site's "(Auvik)" document is the one whose `auvik.tenant` matches.
- **Legacy .xlsx documents (my call):** if no document matches but the site has exactly one rack document with an `auvik` object and no `tenant`, step 2 offers "Update <name>" as the default instead of creating a second document. The import then stamps `tenant` on it.

Older files simply lack these fields. A missing field reads as "unknown source". `model.rs` needs no change because of `flatten`; a round-trip test confirms it.

## Re-import rules

**Matching**, in order:
1. `auvik_api_id`;
2. serial;
3. any MAC;
4. IP **and** hostname/name together, for devices first added from CSV or by hand.

On a match, the document device gets its `auvik_api_id` set, so the next import matches on id. All matches are searched in **every rack document of that site**, not only the "(Auvik)" one, so a device the tech has moved to a real rack is found there and left where it is.

**Where matching lives (my call).**
- `matchesDevice` / `Ident` in `plan.ts` are extended so the comparison runs id first, then serial, then MAC, then IP plus name/hostname. The .xlsx path gets the extra fallback too; this is harmless.
- On a match, the device's `auvik_id` is rewritten to `api:<id>`.
- `computeDiff` gains an option `{ fill: "empty" | "overwrite" }`. The .xlsx path keeps today's behaviour (no option).

**Other rack documents in the site (my call).**
- The import fetches every rack document of the site. Sites have a handful, so this is a few extra GETs.
- A device matched in another document has its fields filled there under the same rule. Its position is never touched.
- That document is saved with its version check. On a 409 the import reloads it and retries once, and otherwise reports "Skipped <rack>: someone is editing it".
- The preview lists these changes under that rack's name.

**Fields.** A field change is ticked by default only when the document's value is empty. Every other change is listed unticked: "kept (from <source>)". An **Overwrite existing values** switch ticks them all except `locked` / `manual` fields, which still need a tick each.

**Never touched:**
- position (rack, U, side);
- anything the user added;
- devices Auvik no longer lists, which are only reported as "No longer in Auvik";
- future migration-plan fields.

**New devices** found by an import go to the "(Auvik)" document's "To place" or "Inventory" column, even when the site's other racks exist.

## Tests (made-up data only)

**Server (`web/server/tests/api.rs`).** An axum mock Auvik server on a random local port, with `AUVIK_BASE_URL` pointed at it. Recorded, made-up JSON fixtures live in `web/server/tests/fixtures/auvik/`. Tenants "Example IT" (multiClient), "EX Main Office" and "EX Warehouse". Devices such as "EX-SW01" on 192.0.2.x.

| Case | Expectation |
|---|---|
| Not configured | `GET /api/auvik` → `configured: false`; the other routes → 404. |
| Test connection, ok and wrong key | `{ok: true}` / `{ok: false, error: <title>}`. |
| Pagination | Three pages via `links.next`, all devices returned. |
| Rate limit | Two 429s with `Retry-After: 0`, then success. |
| Denied site | 403 → `status: "denied"` with a note. Other sites still return. |
| Empty site | `status: "empty"` with the collector note. |
| Missing fields | No model or serial (a UPS) → empty strings, no error. |
| Key never leaks | Every response body from every case, plus captured stderr/stdout, is searched for the test key string. It must not appear. The mock also echoes the auth header in an error to prove it is filtered. |

**Front end (`rackwright-tauri/scripts/auvik-api.test.ts`):**
- the mapping of each fixture device type to the right column;
- component specs;
- a re-import that keeps hand edits (`locked` and `source: manual`) and fills only empty fields;
- Overwrite;
- matching order (id → serial → MAC → IP+name);
- a device already moved into a real rack staying there;
- an old document without `source` loading and saving byte-for-byte equal apart from the new fields;
- **.xlsx regression:** an `.xlsx` re-import produces the same result as before the matching change. The test runs the existing synthetic Auvik fixture in `scripts/auvik.test.ts` through the import and re-import, against a recorded snapshot of the plan, diff and applied document taken from the code **before** `matchesDevice` changes. The snapshot is recorded in the first task, before any matching code is touched. The new `source` field is ignored in the comparison.

Fixtures are shared with the server tests by path.

## Release

- 3.19.0 (`node scripts/version.mjs 3.19.0`).
- A CHANGELOG entry in plain sentences.
- A README "Connect Auvik" section.
- A roadmap line in `docs/roadmap.md`, after 3.18.0.

The release order is 3.18.0 (Word report) → 3.19.0 (this) → 3.20.0 (Auvik cables, below) → VM migration plan → Fill from Asio.

## Follow-up: cables (3.20.0, right after this release)

- Pull Auvik's interface inventory (`/inventory/interface/info`) and network topology/neighbour data for each site.
- Turn them into the same `neighbors` (`name` + `iface`) the CSV's "Connected to" column produces, so `buildLinks`, the port mapping and the cable diff work unchanged.
- Same proxy, pagination, rate-limit and key rules as above.
- Its tests add made-up interface and topology fixtures.

## Left to the builder

- Exact Auvik attribute names: check them against Auvik's public API docs while writing the fixtures, then pin them in the fixtures.
- The off-rack column positions and spacing (`setOffRack` stacks a single column today; it needs a second column).
- The UI layout details of the stepper and preview tabs, within the existing dialog style.
- Whether the mock server lives in `api.rs` or a small helper module in `tests/`.
