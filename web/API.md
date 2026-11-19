# Rackwright Web — API contract

The web version is the Tauri 2.0 React front end (`rackwright-tauri/src`) served by a Rust (axum) server
(`web/server`). The server reuses the desktop app's `model.rs`, `geom.rs` and `router.rs` unchanged via
`#[path]` modules, so cable routing is identical to the desktop app.

## Layout

```
rackwright-tauri/        desktop app (unchanged behaviour) + shared React front end
  src/backend.ts         picks Tauri or HTTP backend at build time (VITE_TARGET=web)
web/
  API.md                 this file
  server/                Rust crate `rackwright-server` (binary `rackwright-server`)
  dist/                  web build of the front end (git-ignored, built by `npm run build:web`)
proxmox/ct/rackwright.sh                 host script: create LXC / `update` inside the LXC
proxmox/install/rackwright-install.sh    runs inside the LXC
.github/workflows/web.yml                CI: cargo build+test, npm build:web, shellcheck
```

## Runtime configuration (environment)

| Var         | Default        | Meaning                                  |
|-------------|----------------|------------------------------------------|
| `RW_DATA`   | `./data`       | data dir; SQLite file `rackwright.db`    |
| `RW_HOST`   | `127.0.0.1`    | bind address (LXC uses `0.0.0.0`)        |
| `RW_PORT`   | `8080`         | port                                     |
| `RW_STATIC` | `./web/dist`   | front-end files; SPA fallback to index   |
| `RW_APP_DIR`| `/opt/rackwright` | git checkout the admin Update server runs in |
| `AUVIK_API_KEY` | (none) | Auvik API key. Server only; never sent to the browser |
| `AUVIK_USERNAME` | (none) | Auvik API user name (Basic auth) |
| `AUVIK_REGION` | (none) | Auvik region, matches `^[a-z]{2,3}[0-9]{1,2}$` (for example `us1`). Base URL is `https://auvikapi.<region>.my.auvik.com/v1` |
| `AUVIK_BASE_URL` | (none) | **Test-only.** Replaces the base URL so tests can use a local mock. Do not set it in production |

Auvik import is on only when key, user name and a valid region are all set.

`GET /healthz` → `200 ok` (no auth).

`GET /api/version` → `200 {"version":"3.10.0"}` (no auth, `Cache-Control: no-store`): the running server version. Open pages compare it with their own version to offer a reload after an update.

## Conventions

- JSON in and out. Every error is `{"error": "human readable message"}` with a fitting status
  (400 bad input, 401 not signed in, 403 not admin, 404 missing, 409 conflict).
- Session cookie `rw_session`: random 32-byte token (hex), `HttpOnly; SameSite=Lax; Path=/`, 30 days.
  Stored hashed (SHA-256) in the DB.
- Passwords: argon2id. Minimum length 8.
- Everything under `/api` except `setup`, `login`, `GET /api/setup`, `GET /api/branding` and `GET /api/branding/logo` needs a session.
- `User` = `{"id": int, "email": str, "name": str, "is_admin": bool}`.
- Timestamps are RFC 3339 UTC strings.

## Setup and sign-in

| Method & path            | Body                              | Result |
|--------------------------|-----------------------------------|--------|
| `GET /api/setup`         | —                                 | `{"needs_setup": bool}` (true when there are no users) |
| `POST /api/setup`        | `{email, name, password}`         | creates the first user as admin, signs in, returns `User`. 409 if users exist |
| `POST /api/login`        | `{email, password}`               | sets cookie, returns `User`. 401 `"Wrong email or password"` |
| `POST /api/logout`       | —                                 | clears session, `{}` |
| `GET /api/me`            | —                                 | `User` or 401 |
| `POST /api/me/password`  | `{current, new}`                  | `{}`; 400 if current is wrong |
| `PATCH /api/me` | any of `{name, email, current_password}`; `email` needs `current_password` | `User`. 400 wrong password or bad email, 409 email taken (case-insensitive). The session keeps working |
| `GET /api/me/prefs` | — | the stored JSON object, `{}` if none |
| `PUT /api/me/prefs` | a JSON object, at most 16 KB | the stored object, kept exactly as given so unknown keys survive. 400 if not an object or too large |

Email compare is case-insensitive (store lower-cased).

## Users (admin only)

There is no email delivery. An admin creates an account with a starting password and tells the person.

| Method & path              | Body                                         | Result |
|----------------------------|----------------------------------------------|--------|
| `GET /api/users`           | —                                            | `[User]` |
| `POST /api/users`          | `{email, name, password, is_admin}`          | `User`; 409 if email taken |
| `PATCH /api/users/:id`     | any of `{name, is_admin, password}`          | `User` |
| `DELETE /api/users/:id`    | —                                            | `{}`; 400 when deleting yourself or the last admin. Their sessions are removed |

Demoting the last admin is also refused (400).

## Settings and branding

Server-wide settings (admin writes, everyone signed in reads), uploaded assets and the public branding used by the sign-in page.

| Method & path               | Who       | Body | Result |
|-----------------------------|-----------|------|--------|
| `GET /api/settings`         | signed in | —    | `{"settings": {...}, "assets": [{name, mime, size, updated_at}]}`; settings default `{}` |
| `PUT /api/settings`         | admin     | a JSON object, at most 64 KB | the stored object (replaces the old one). Known keys are checked: `company_name` text, 100 characters at most; `accent` `#rrggbb`, or `""` for the default; `rack_default_model` text; `rack_default_u` whole number 1 to 60; `report_secondary` `#rrggbb`, or `""` for the default; `address_line` text, 200 characters at most; `report_font_name` text, 100 characters at most (the display name of the uploaded report font). Unknown keys are kept. 400 on a bad value |
| `PUT /api/assets/:name`     | admin     | raw file bytes; the `Content-Type` header is the mime type | `{name, mime, size, updated_at}`. Names allowed: `logo` (image, at most 2 MB); `cover_art`, `header_art`, `footer_art` (image, at most 5 MB); `font_regular`, `font_bold` (font, at most 5 MB); `word_template` (Word document, at most 10 MB). Images are `image/png`, `image/svg+xml`, `image/jpeg` or `image/webp`. Fonts are `font/ttf`, `font/otf`, `font/sfnt`, `application/x-font-ttf`, `application/x-font-otf` or `application/octet-stream`, and the file must start with `00 01 00 00`, `OTTO` or `true`. The Word template is `application/vnd.openxmlformats-officedocument.wordprocessingml.document` or `application/octet-stream`, and the file must start with `PK`. 404 unknown name; 400 wrong type, empty or too large ("Upload a PNG, JPG, SVG or WebP image." / "Upload a TTF or OTF font file." / "Upload a Word document (.docx)." / "That file is too large (5 MB at most)." with the rule's own size: 2, 5 or 10 MB) |
| `DELETE /api/assets/:name`  | admin     | —    | `{}` (also when absent). 404 unknown name |
| `GET /api/assets/:name`     | signed in (any user, so anyone can build a report) | —    | the bytes with their `Content-Type`; 404 if absent |
| `GET /api/branding`         | anyone    | —    | `{"company_name": str /* "" if unset */, "accent": str|null, "has_logo": bool}` |
| `GET /api/branding/logo`    | anyone    | —    | the logo bytes (headers as below) or 404 |

Served assets carry `Content-Type: <mime>`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and `Cache-Control: no-cache`, so an uploaded SVG cannot run script.

Tables: `settings` (one row, JSON text), `assets` (name, mime, data, updated_at) and `users.prefs` and `clients.report` (JSON text, default `{}`), all created or added on start-up.

## Server update (admin only)

Updates the LXC from the browser. It runs the same script as the `update` command
(`proxmox/ct/rackwright.sh`) in a transient systemd unit `rackwright-update`, so the script can
restart `rackwright.service` at the end. The server keeps running while the new version builds;
a failed build leaves the old version running. Output goes to `<RW_DATA>/update.log`, the result
to `<RW_DATA>/update.state`.

It only works where the app is a git checkout in `RW_APP_DIR` (default `/opt/rackwright`) and
`systemd-run` exists. Anywhere else `available` is false and the POSTs return 503.

`UpdateStatus` = `{"available": bool, "reason": str /* why not, when unavailable */, "version": str /* running server */,
"commit": str, "branch": str, "repo": str, "state": "idle"|"running"|"ok"|"failed", "since": str /* RFC 3339 or "" */,
"log": str /* last 200 lines, colour codes removed */}`

| Method & path                  | Body | Result |
|--------------------------------|------|--------|
| `GET /api/admin/update`        | —    | `UpdateStatus` |
| `POST /api/admin/update/check` | —    | fetches the branch, returns `{version, commit, latest_version, latest_commit, latest_date, latest_subject, update_available, changes}`. `changes` = CHANGELOG.md sections newer than `version`. 409 while an update runs, 502 when the repository can't be reached |
| `POST /api/admin/update`       | —    | 202 `{}`; starts the update. 409 if one is already running |

## Auvik (web only)

Reads devices from the Auvik API. The server holds the key; the browser never sees it. All routes need a signed-in user (401 otherwise).
When Auvik is not configured, every route except `GET /api/auvik` returns 404 `{"error":"Auvik is not set up on this server."}`.
Every Auvik route answers with `Cache-Control: no-store`, so a changed `auvik.env` shows after a restart without reloading the page.

| Method & path | Result |
|---|---|
| `GET /api/auvik` | `{"configured": bool, "region": str, "username": str}`. Never the key. `region` and `username` are `""` when not configured. |
| `POST /api/auvik/test` | Calls Auvik `GET /authentication/verify`; any 2xx answer is success, whatever its body (Auvik answers 200 with an empty body). Returns `{"ok": true}` or `{"ok": false, "error": str}` (Auvik's error title, or a fixed message). Always 200. |
| `GET /api/auvik/tenants` | `[{"id", "name", "type": "multiClient"\|"client", "parent": id\|null}]`, multi-client tenants first, by name. |
| `GET /api/auvik/tenants/:id/inventory` | `{"status": "ok"\|"denied"\|"empty", "note": str, "devices": [AuvikApiDevice]}`. 200 for all three statuses. Other Auvik failures return 502 with a fixed message. |
| `GET /api/auvik/tenants/:id/links` | `{"status": "ok"\|"denied"\|"empty", "note": str, "links": [{"device": id, "iface": str, "peerDevice": id, "peerIface": str, "portless": bool}], "dropped": number}`. The site's cables; `device` and `peerDevice` are the inventory `devices[].id`. 200 for all three statuses. |

`AuvikApiDevice` = `{id, name, type, makeModel, vendor, serial, firmware, software, ips: [str], macs: [str], status, discovery: str, components: [{type, name, detail}]}`. Missing attributes are `""` or `[]`.

Tenants: `type` is `multiClient` or `client` (a standalone `corporateIt` tenant is shown as a client); names are the display names Auvik gives for multi-client tenants, else the domain prefix.

Inventory errors are 502 with a fixed message: `"Auvik is busy. Try again in a few minutes."`, `"Auvik returned too many pages for this site."`, `"Reading this site from Auvik took too long."` (3 minute cap) or `"Auvik could not be read. Try again in a few minutes."`. A tenant the key may not read (Auvik answers 401 or 403 to any of its reads) answers 200 `status:"denied"`, `note:"Auvik denied access to this site."`; each site is read on its own, so one denied site never stops the others; a tenant with no devices answers 200 `status:"empty"`. Only the path and query of `links.next` are used, against the configured base URL. `:id` may contain only letters, digits, `-` and `_` (400 otherwise).

Cables (`/links`): read from Auvik `inventory/interface/info`, plus device info and details for the device-to-device fallback. Kept interface types: `ethernet`, `optical`, `inferredWired`; every other type (wifi, vlan, loopback, ...) is dropped, and the aggregates `ieee8023AdLag` and `linkAggregation` are not cables themselves. A cable Auvik lists on both ends is one row (`device`/`iface` is the end with the smaller interface id); rows are sorted by `(device, iface, peerDevice, peerIface)`. A connection that ends on a dropped type or on an interface that is not in the site's list is not returned and is counted once in `dropped`. When only the two aggregates of a LAG are connected and no member pair exists between the same two devices, one row with empty `iface`/`peerIface` and `portless: true` is returned. Fallback: a `connectedDevices` pair of two site devices with no row between them gets one row with empty ports and `portless: true`. `denied` (401/403 on a read) has note `"Auvik denied access to this site's cables."`; `empty` (no interfaces and no fallback rows) has note `"Auvik lists no connections for this site."`. Errors, the 3 minute cap, id check and `no-store` are as for the inventory.

Limits: 20 s per Auvik request, one Auvik request at a time, 429/503 retried up to 5 times (each wait is `Retry-After` seconds, at most 60 s, else 1, 2, 4, 8, 16 s), pages followed up to 50 per endpoint.

## Racks (shared: every signed-in user sees and edits all of them)

`RackMeta` = `{"id": int, "name": str, "version": int, "updated_at": str, "updated_by": str /* user name */, "site_id": int|null, "site": str /* site name, "" when none */, "client_id": int|null, "client": str /* client name, "" when none */}`

| Method & path            | Body                          | Result |
|--------------------------|-------------------------------|--------|
| `GET /api/racks`         | —                             | `[RackMeta]`, newest `updated_at` first |
| `POST /api/racks`        | `{name, doc, site_id?}`       | `RackMeta` (version 1). `site_id` (optional, int or null) puts it in a site; 404 if that site does not exist |
| `GET /api/racks/:id`     | —                             | `RackMeta` + `"doc": Doc` |
| `PUT /api/racks/:id`     | `{name, doc, version}`        | `RackMeta` with version+1. If `version` ≠ stored version → 409 `{"error": "...", "version": current, "updated_by": name}` |
| `DELETE /api/racks/:id`  | —                             | `{}` |
| `PUT /api/racks/:id/site` | `{site_id}` (int or null)    | `RackMeta`. Moves the rack to another site (null = no site). Does not change `version`. 404 if the rack or site does not exist |

`doc` is the same `.rack.json` document the desktop app saves. The server stores the JSON text as received
(after checking it parses as the `Doc` model) so unknown fields survive.

## Clients and sites (shared like racks: every signed-in user sees and edits all of them)

An MSP client has sites; each site holds shared racks (`racks.site_id`). A rack with no site is "Unassigned".

`ClientMeta` = `{"id": int, "name": str, "notes": str, "sites": int /* count */, "racks": int /* count */, "updated_at": str}`
`Site` = `{"id": int, "client_id": int, "name": str, "address": str, "notes": str, "rooms": [...] /* JSON array, [] by default */, "migration": {...} /* JSON object, {} by default */, "updated_at": str}`

| Method & path                  | Body                                   | Result |
|--------------------------------|----------------------------------------|--------|
| `GET /api/clients`             | —                                      | `[ClientMeta]`, by name (case-insensitive) |
| `POST /api/clients`            | `{name, notes?}`                       | `ClientMeta`. 409 if another client has the same name (case-insensitive) |
| `GET /api/clients/:id`         | —                                      | `ClientMeta` + `"sites": [Site + "racks": [RackMeta]]` (sites by name, racks by name) + `"links": [Link]` (by id) |
| `PATCH /api/clients/:id`       | `{name?, notes?}`                      | `ClientMeta`. 409 on a duplicate name |
| `DELETE /api/clients/:id`      | —                                      | `{}`. 409 `{"error": "Delete or move its sites first."}` while it has sites |
| `GET /api/clients/:id/report`  | —                                      | the stored report options (a JSON object, `{}` if none). 404 unknown client |
| `PUT /api/clients/:id/report`  | a JSON object, at most 64 KB           | the stored object (replaces the old one). 404 unknown client; 400 if not an object or too large |
| `POST /api/clients/:id/sites`  | `{name, address?, notes?}`             | `Site`. 409 if the client already has a site with that name |
| `PATCH /api/sites/:id`         | `{name?, address?, notes?, client_id?, rooms?, migration?}` | `Site`. `client_id` moves the site (and its racks) to another client. `rooms` replaces the floor plans: a JSON array of at most 256 KB, else 400. `migration` replaces the VM migration plan: a JSON object of at most 256 KB, else 400 ("Migration plan must be an object" / "Migration plan is too large") |
| `DELETE /api/sites/:id`        | —                                      | `{}`. Its racks are kept and become Unassigned (`site_id` null). Its links are deleted |
| `POST /api/clients/:id/links`  | `LinkBody`                             | `Link` |
| `PATCH /api/links/:id`         | any `LinkBody` fields                  | `Link` |
| `DELETE /api/links/:id`        | —                                      | `{}` |

### Site-to-site links

A link joins two sites of the same client (a WAN circuit, VPN tunnel...). `site_b` null means the link goes to the Internet / a provider cloud rather than another site.

`LinkEnd` = `{"rack": int|str, "dev": int, "name": str}` or null — the device the link ends on (web: `rack` is the rack id; desktop: the rack file key). The server stores it as given and only checks it is an object with those three fields, or null.
`LinkBody` = `{"site_a": int, "site_b": int|null, "kind": str, "provider": str?, "circuit": str?, "bandwidth": str?, "notes": str?, "a_end": LinkEnd?, "b_end": LinkEnd?}`
`Link` = `LinkBody` with every field present (missing strings become "", missing ends null) + `"id": int, "client_id": int, "updated_at": str`

`kind` is free text, max 40 characters, not empty; the app offers VPN, MPLS, Fiber, Internet, Wireless, SD-WAN, Other. `provider`, `circuit`, `bandwidth` max 200 characters, `notes` max 10 000.
400 when `site_a` or `site_b` is not a site of this client, or `site_a` = `site_b`. 404 for an unknown client or link.
On PATCH, sending `"site_b": null` sets it to null; leaving it out keeps it (same for `a_end` / `b_end`).

Names are trimmed and must not be empty (400), max 200 characters. `notes` and `address` max 10 000 characters.
Deleting a client or site never deletes racks.

## Compute (same as the desktop Tauri commands)

| Method & path               | Body              | Result |
|-----------------------------|-------------------|--------|
| `POST /api/route_cables`    | `{doc, face}`     | `RouteResult` (exactly what `router::route_all` returns) |
| `POST /api/port_positions`  | `{doc}`           | `[[id, x, y, s], ...]` (same as Tauri `port_positions`) |

Request body limit: 20 MB.
