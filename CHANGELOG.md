# Changelog

Newest first. Every push to `web` adds an entry here (CI checks it). The web version number lives in one place: `version` in `web/server/Cargo.toml`. Upstream changes from hast3/Rackwright arrive under `## Unreleased` through the Sync upstream pull request and get a version when that pull request is merged.

## 2.1.0 — 2026-11-16
- CHANGELOG.md covers the whole history, including the desktop app before the web version. CI fails a push or pull request to `web` that does not add an entry, or whose top version does not match `web/server/Cargo.toml`.
- AGENTS.md tells people and coding agents how the branches work, how to run, test and release, and how to pull upstream changes. CLAUDE.md points to it.
- Sync upstream runs every day and on demand. It moves `desktop` and `master` forward to hast3/Rackwright `master`, then opens a pull request that merges the new upstream commits into `web`, with the changelog entry already written and CI started. If the merge conflicts, it opens an issue that lists the files.
- CI uses the current checkout and Node setup actions.

## 2.0.0 — 2026-11-16
First web version. Same rack editor as the desktop app, in the browser, installed in a Proxmox LXC.
- The browser shows the desktop app's React screens. The same source builds the desktop app (`npm run build`) and the web app (`npm run build:web`), and the desktop app works as before.
- A Rust server (`web/server`) serves the page and routes cables with the desktop app's own router, so cable routes match the desktop app.
- Sign-in with email and password. The first person to open the site creates the admin account. An admin adds people on Users with a starting password, renames them, makes them admin, resets passwords and removes accounts. There is no email delivery.
- Racks are shared: everyone who signs in sees and edits all of them. Open lists racks with who changed them and when. Save keeps the rack, Save as makes a copy. If someone else saved the rack first, you choose to reload theirs or overwrite with yours.
- Import file and Export file move `.rack.json` files between the desktop and web apps.
- Proxmox LXC installer in the same shape as CW Compare: run one line on the Proxmox host to create a Debian 13 container (2 CPU, 2 GB RAM, 8 GB disk, port 8080). Type `update` in the container console to pull `web` and rebuild. Data stays in `/var/lib/rackwright`.
- CI builds and tests the server, builds both front ends, and checks the install scripts.
- The server does not build the desktop router's own unit tests, because they read a sample file (`Homelab.rack.json`) that is not in the repository.

## Desktop history (hast3/Rackwright, before the web version)

### Desktop 2.0 — 2026-11-11 to 2026-11-12 (Tauri: Rust + React)
- Release exe embeds the front end, so it no longer needs the dev server. (b79f668)
- Workability pass: drag devices from the palette with a ghost, placement checks, access point discs, properties panel, keyboard shortcuts. (6610af6)
- Faceplate and port art ported from 1.0, UI polish, release exe launcher. (921cce2)
- Rack-list import matches words correctly (regex word boundaries). (75728e2)
- Editing: add a rack or device from the catalog, drag between U slots, click port to port to cable, delete, undo and redo; device catalog; rack-list import. (13665a8)
- Rackwright 2.0 starts as a Tauri app: Rust core with an orthogonal cable router that keeps cables from overlapping, React/TypeScript rack view. (3a3c312)

### Desktop 1.0 — 2026-11-09 to 2026-11-10 (Python, tkinter)
- Power: inlets on all active devices, UPS and PDU inputs, corrected UPS outlet counts, outlet-to-inlet check, Power report tab. (810af12)
- Port art: RJ45 sockets with contacts and link LEDs, SFP cages, LC duplex, IEC power, console ports. (1eaca6b)
- Cabling rewritten with tracks, side ducts and an overhead tray; rack-mount organizers; power cord defaults; multi-select; dark theme. (bf06065)
- More equipment with front and rear faceplates: APC and Eaton UPS and battery packs, PDUs, Cisco, Meraki, Ruckus, SonicWall, Fortinet, Aruba, Juniper, Palo Alto. (e6ab0e9)
- Cables between vertically adjacent containers run directly. (d514926)
- Cables in the same rack take the shortest path, with no side detour. (00d8e62)
- Rack view draws cable plugs straight on, with the boot seen end-on at the port. (a20e366)
- Ethernet-style cables with RJ45 plugs on both ends; UniFi Dream Router and access point objects. (d5ff679)
- Real equipment faceplates with front and rear views: Dell PowerEdge, UniFi, Synology. (55212d5)
- Rackwright 1.0.0: rack and logical views, cables, custom devices, text import, front and rear mounting. (9145feb)
