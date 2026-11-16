# AGENTS.md

Rackwright designs network racks: rack and logical views, real equipment faceplates (front and rear), cables routed through ducts and trays, power chains, rack-list import. This repository is Hrubak/Rackwright, a fork of **hast3/Rackwright** (upstream, written by a colleague). The fork adds a web version that runs in a Proxmox LXC, deployed the same way as Hrubak/cw-compare.

## Branches — read this first

| Branch    | What it is | Who changes it |
|-----------|------------|----------------|
| `desktop` | Exact mirror of upstream `master`: the Tauri 2.0 app (`rackwright-tauri/`) and the Python/tkinter app (`rackwright.py`). | Only Sync upstream (fast-forward). Never commit here. |
| `master`  | Same mirror (kept because it is the fork's default branch and the base for upstream pull requests). | Only Sync upstream. Never commit here. |
| `web`     | `desktop` plus the web version, CI, Proxmox scripts, CHANGELOG, this file. The LXC installs and updates from `web`. | All fork work goes here, through feature branches and pull requests. |

Rules that keep upstream merges painless:
- Do not commit to `desktop` or `master`. Sync upstream fails if they have commits that are not upstream.
- Do not edit upstream-owned code on `web` unless you must: `rackwright-tauri/src-tauri/**`, `rackwright.py`, `rackwright-tauri/src/{RackView,Plate,edit,types}.ts(x)`, `catalog.json`. Desktop fixes belong upstream (a pull request to hast3/Rackwright), then come back through Sync upstream.
- Web code lives in its own files: `web/**`, `rackwright-tauri/src/{backend,api,web,WebShell}.ts(x)`, `vite-env.d.ts`, `.env.web`, `proxmox/**`, `.github/**`, `docs/adr/**`. Edits to shared files (`App.tsx`, `main.tsx`, `vite.config.ts`, `package.json`, `README.md`, `.gitignore`) stay small and behind `IS_WEB`.
- The server reuses `model.rs`, `geom.rs`, `router.rs` from `rackwright-tauri/src-tauri/src` through `#[path]` modules. Never copy them. If upstream changes their signatures, fix `web/server/src/lib.rs`.

## Layout

- `rackwright-tauri/src/` — React front end shared by desktop and web. `backend.ts` picks Tauri or HTTP by `import.meta.env.VITE_TARGET` (`IS_WEB`). `api.ts` is the HTTP client; `web.tsx` and `WebShell.tsx` are the web-only screens (sign-in, Users, rack list, save conflict).
- `rackwright-tauri/src-tauri/` — desktop Rust (Tauri) — upstream.
- `web/API.md` — the HTTP contract. Change it first when changing an endpoint.
- `web/server/` — Rust axum server, SQLite (`rusqlite` bundled), argon2 passwords, cookie sessions. Tests in `web/server/tests/api.rs`.
- `proxmox/ct/rackwright.sh` (Proxmox host; also the `update` command in the LXC) and `proxmox/install/rackwright-install.sh` (inside the LXC).
- `.github/workflows/web.yml` (CI), `.github/workflows/sync-upstream.yml` (upstream sync).
- `docs/adr/` — decisions. Read them; flag a conflict instead of silently overriding.

## Run and test

Needs Node 22+ and Rust stable. Rust is not installed on every dev PC; CI always builds it.

```bash
cd rackwright-tauri && npm ci
npm run build          # desktop type-check + build (must keep passing)
npm run build:web      # web build -> ../web/dist
npx tsx scripts/edit.test.ts
cd ../web/server && cargo test && cargo run   # http://127.0.0.1:8080, data in ./data
npm run dev:web        # (in rackwright-tauri) Vite dev server, proxies /api to :8080
```

Server environment: `RW_DATA`, `RW_HOST`, `RW_PORT`, `RW_STATIC` (see `web/API.md`). On the LXC: app in `/opt/rackwright`, data in `/var/lib/rackwright`, service `rackwright.service`.

## Changelog and versions — every push

1. Every push or pull request to `web` adds an entry to `CHANGELOG.md`. CI fails without one.
2. The version lives only in `web/server/Cargo.toml` (`version = "x.y.z"`). The top changelog heading is `## x.y.z — YYYY-MM-DD` and must match it (or be `## Unreleased` while a pull request is open).
3. Bump: patch for fixes, minor for new features or upstream pulls, major for breaking data or deployment changes.
4. Write entries for the people who use it: plain sentences that say what changed and what to do. Mention upstream commits by short sha.

## Pulling upstream changes

Automatic: **Sync upstream** (`.github/workflows/sync-upstream.yml`) runs daily, or from the Actions tab → Sync upstream → Run workflow. It fast-forwards `desktop` and `master`, then opens a pull request `sync/upstream-<sha>` → `web` with an `## Unreleased` changelog entry and starts CI on it. Before merging: set the version in `web/server/Cargo.toml`, rename `## Unreleased` to that version and date, and check CI is green. Then type `update` in the LXC.

If it opens an issue "Upstream merge needs a hand" (conflict), do it by hand:

```bash
git remote add upstream https://github.com/hast3/Rackwright.git   # once
git fetch upstream
git switch -c sync/upstream-manual origin/web
git merge --no-ff upstream/master
# resolve conflicts: keep upstream's version of upstream-owned files, re-apply the small IS_WEB hooks
cd rackwright-tauri && npm ci && npm run build && npm run build:web
# add the changelog entry and version bump, push, open a PR to web
```

## Sending work upstream

Upstream has only `master`. A pull request to hast3/Rackwright goes from a fork branch to `hast3:master`. Ask the user before opening one; it is public and goes to someone else's repository. Agree the scope first: the whole web version (`web` → `master`), or a single desktop fix on a branch cut from `master`.

## Conventions

- UI copy is plain language: short sentences, say what the person should do.
- Never commit secrets, the `data/` folder, `web/dist`, or `target/`.
- Keep each branch / pull request to one feature.

## Workflow for agents

1. Ask all clarifying questions up front in ONE numbered list, then work.
2. Branch from `web`; never push to `desktop` or `master`.
3. Before pushing: both front-end builds, `edit.test.ts`, and (where Rust is available) `cargo test`. Add the changelog entry and version bump. Do not push failing code.
4. When done, report what was pushed: branch, commits, PR URL, files changed, and test results.
