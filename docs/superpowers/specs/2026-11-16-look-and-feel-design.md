# Look and feel — design (2026-11-16)

Covers the roadmap's "Look and feel" section, plus a client quarterly-review report that came out of the design conversation. Ships as several small releases (see the end).

## Intent

Rackwright is used daily by an MSP's technicians and its output is handed to clients. Today the app is a dark, utilitarian screen with a wrapping row of ~18 buttons, a placeholder icon (plain blue square) and per-rack PDFs with only a title and date. The goal:

1. The app looks professional and calm for the staff who use it all day.
2. Clients receive a polished, branded quarterly-review report built from what Rackwright already knows.

Clients are **not** shown the live app: presentation happens through exports only (decided). So there is no in-app "presentation mode".

## Goals

- A neutral Rackwright identity (logo, app icon) with optional company branding layered on by the server's admin.
- A clear top bar: grouped menus, an always-visible core, and a Client › Site › Rack breadcrumb.
- A Settings screen: user Profile and admin System settings.
- Dark, light and "match my computer" themes, covering the whole app including the drawing canvas.
- A client report (PDF) with two detail levels and a written summary.
- A Word (.docx) export built from the MSP's own uploaded master template.

## Non-goals

- No live presentation / client-safe mode in the app.
- No per-user permission for exporting reports: anyone signed in can export (decided).
- No server-side PDF rendering (no headless browser on the LXC).
- Faceplate artwork (`Plate.tsx`) does not change with the theme; it shows the real equipment.

## Anti-goals (fail even if it "works")

- **The MSP's name, logo, colours, address, tagline or template must never be in the repository.** The company name is on the customer-data scan list. All branding is uploaded at run time and lives only in the server database (web) or local app storage (desktop). Tests and examples use a made-up company ("Example IT").
- Reports that look different each export, or need manual layout fixes.
- Breaking the desktop build, the `.rack.json` format, or the dark look staff are used to (dark stays the default and should look the same or better after the refactor).

## Constraints

- One React front end for desktop (Tauri) and web; web-only code stays in web-only files, shared-file edits small and behind `IS_WEB`; desktop-only code behind dynamic `@tauri-apps` imports.
- No Rust toolchain locally: CI is the first Rust compile. `web/API.md` is changed before any endpoint.
- Styling today is inline hex colours (~700 occurrences across `src/`, about a third in `Plate.tsx`), plus a small `<style>` block in `index.html`. There is no CSS file or theme system.
- Existing libraries cover the needs: `jspdf` + `svg2pdf.js` (PDF, already used by `src/export/pdf.ts`), `jszip` (.docx is a zip). Prefer no new dependencies; a new one needs a reason.
- UI copy: plain, short sentences that say what to do.

## Approaches considered

**Client report PDF**
- (A) Extend the current jsPDF + svg2pdf export, laid out in code. One click, identical every time, same on web and desktop, vector diagrams, embeddable font and artwork. Layout changes need a release. **Chosen.**
- (B) An HTML report page printed to PDF. Easiest to make pretty, but goes through the print dialog every time, page breaks are weak, desktop print-to-PDF is unreliable. Rejected.
- (C) Server-side headless browser. Too heavy for the LXC, impossible on desktop. Rejected.

**Word export:** open the uploaded master .docx with `jszip`, keep its styles, headers, footers, fonts and numbering, and insert generated body content at a `{{RACKWRIGHT}}` placeholder paragraph (headings in the template's own Heading styles, diagrams as high-resolution PNG, inventory as Word tables). If the placeholder is missing, append at the end of the body. Text before and after the placeholder (Executive Summary, Scope, ...) is kept. No real alternative.

**Theming:** CSS custom properties (variables) on the root element, switched by a `data-theme` attribute. Inline styles reference `var(--rw-...)`. Drawings (rack frame, cables, labels, diagrams) get their own variables so the PDF can render them in the light set regardless of the user's theme.

**Identity:** neutral Rackwright mark; an admin can add a company logo and accent colour (decided, over hard-coding the MSP's brand into the app).

## Decisions

### Identity
- A Rackwright logo mark and wordmark (simple, works at 16 px), used for: Tauri icon set (`src-tauri/icons`, including `icon.ico`), browser favicon, sign-in page, top-bar left corner, Help › About.
- If an admin set a company logo, the top bar shows it next to the Rackwright mark ("Rackwright · <logo>"), and the sign-in page shows it above the form.
- Logo concepts are shown to the user as mockups to choose from before the identity release ships.

### Top bar
```
[▣ Rackwright] File Edit View Clients Help │ Client › Site › Rack •  │ [Rack|Infra|Switch|Endpoints] [Front⇄Rear]  ⟲ ⟳  💾   (A) ▾
```
- File: New, Open, Save, Save as, Import file (web), Import list, Import Auvik, Export ▸ (PDF, Visio, Client report, Word report).
- Edit: Undo, Redo, Add rack, Duplicate, Delete (enabled by selection).
- View: Rack / Infrastructure / Switch / Endpoints, Flip front/rear, Fit, cable display options (moved from the bottom-left of the rack view or mirrored there).
- Clients: Clients screen, Import Auvik into client, Client report.
- Help: Keyboard shortcuts, What's new (changelog), About (version, links).
- Always visible: breadcrumb, view switcher, front/rear flip (rack view), Undo, Redo, Save.
- Avatar menu (A) ▾: Profile, System settings (admins), Users and Update server (admins, web), Sign out. Desktop: Settings instead of a user.
- Keyboard shortcuts shown in menus: Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, Delete, F (fit). Shortcuts don't fire while typing in an input.
- Breadcrumb: Client › Site › Rack name, each part clickable (Client opens the Clients screen on that client; Site on that site). A rack not in a site shows "Unassigned › Rack". "•" after the name means unsaved. Desktop resolves client/site from the loaded `.client.json` files when the rack belongs to one.
- Side panels get a tidy-up pass: consistent section headings, spacing and field alignment. No behaviour change.

### Settings
**Profile (everyone)**: name; email (changing it asks for the current password); change password; theme (dark / light / match my computer, default dark); units (mm / inches, for rack dimensions shown in the UI and exports); start screen (last rack / Clients / rack list).

**System (admins, web)**:
- Branding: company name; app logo (PNG/SVG); accent colour (used in the app and as report primary colour); report secondary colour; report font (upload TTF/OTF regular + bold; fallback Helvetica in PDF, the template's font in Word); address/footer line; cover header artwork and page header artwork (images); footer artwork (image); Word master template (.docx).
- New rack defaults: rack model and height, add cable managers automatically, Auvik import "Include as" defaults.
- Users (moved from the toolbar) and Server update (moved from the toolbar).

**Desktop**: Profile (theme, units, start screen) and Branding, saved on that PC (app storage). No Users or Server update.

### Themes
- Dark (today's palette, tidied), Light, Match my computer (`prefers-color-scheme`).
- The drawing canvas follows the theme (decided): rack frame, rails, U labels, cable colours where they are UI colours (not user-chosen cable colours), selection, labels and the Infrastructure / Switch / Links diagrams all have dark and light variables. User-chosen cable colours stay as chosen; check contrast against both backgrounds.
- Exports always draw with the light set.

### Client report (PDF)
Opened from Clients (Client report) or File › Export. Options: detail level (Overview / Detailed), sites to include (default all), Executive summary (text), Recommendations (text), report date (default today), "Prepared for" (client name).
- **Overview**: cover (branding artwork, company logo, "Network review — <Client>", date, prepared by <company>); executive summary; site-to-site links map; per site: infrastructure diagram and rack front views; totals (sites, racks, U used, devices by type); recommendations.
- **Detailed** adds: rack rear views, switch port maps, per-site device tables, full inventory table, links table (type, provider, circuit, bandwidth).
- Every page after the cover: page header artwork, page footer artwork with the address line, page number.
- Summary and recommendation text for a client is remembered (web: stored with the client; desktop: in the `.client.json`) so next quarter starts from the last one.

### Word export
Same content and detail levels as the PDF, built into the uploaded master template as described above. Exported diagrams use PNG at print resolution. Without an uploaded template, a plain .docx with default styles is produced and the dialog says so.

## Calls made after the builder review (correct any of these)

- **Desktop storage:** desktop settings and branding assets (logo, artwork, fonts, .docx template) are kept in the app's web storage (IndexedDB for files, localStorage for small preferences). No new Rust commands, so it can be built and tested without a local Rust toolchain. Same size limits as the web.
- **Report text on the web:** a new column on the clients table holds the last report options (summary, recommendations, detail level, sites). It's overwritten each time it's saved; there is no history per quarter. On the desktop it's saved in the `.client.json` (unknown-field-safe). API change goes into 3.9.0.
- **Light drawings for exports:** exports render the drawings offscreen inside a forced `data-theme="light"` scope, then resolve every `var(--rw-…)` to a literal colour before svg2pdf / PNG. The drawing code reads variables only; no palette parameters threaded through it.
- **Report data:** inventory, type totals and site links (type, provider, circuit ID, bandwidth, end devices) already exist from 3.2–3.3; the report reuses `clients/util.ts` and `clients/store.ts`. No model changes.
- **Fonts:** bundle one open-licence Unicode sans (OFL) as the report's default and fallback, so names with accents always print. An uploaded brand font is used when set. This is the one new asset.
- **Desktop menus:** the same HTML top bar on desktop and web (one front end), not Tauri native menus.
- **Units and start screen:** units apply wherever rack dimensions are shown (properties, rack picker, exports). Start screen applies when the app opens.

## Left to the builder

- Exact variable names and palette values (dark must look as it does now or better).
- The `settings` table shape, user-preference column(s) and asset storage (SQLite blobs vs files under `RW_DATA`); size limits on uploads (suggest 5 MB images, 10 MB template).
- New endpoints, written into `web/API.md` first: get/set my preferences, change my email, get/set system settings (admin), upload/download branding assets, a public read of the logo for the sign-in page.
- How drawings are rendered to PNG for Word (canvas from the existing SVG clones).
- Page layout grid for the report and handling of very large racks/diagrams (scale to fit, one rack per page in Detailed).

## Releases (one at a time, each with a changelog entry and `scripts/version.mjs`)

1. **3.5.0 Groundwork and identity**: theme variables throughout the app frame and canvas (dark unchanged); Rackwright logo and icon (exe, favicon, sign-in, top-bar corner); Help › About.
2. **3.6.0 Top bar**: menus, always-visible core, breadcrumb, shortcuts, avatar menu, side-panel tidy-up.
3. **3.7.0 Settings**: Profile and System settings, server settings and preferences, branding uploads, new-rack defaults; Users and Update server move into it; desktop local settings.
4. **3.8.0 Light theme**: light and match-my-computer, light drawing palette.
5. **3.9.0 Client report PDF**: Overview / Detailed, summary and recommendations, branding.
6. **3.10.0 Word report**: export into the uploaded master template.
