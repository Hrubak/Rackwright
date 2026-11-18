# Visio stencil import: findings

Date: 2026-11-17. Status: research only, no release assigned yet (after 3.16.0).

Goal: turn vendor Visio stencils (for example the collection at github.com/bhdicaire/visioStencils) into Rackwright faceplates, so a device can show the vendor's real front or rear picture.

## What stencils contain

- That collection holds about 2,800 old binary `.vss` files and about 600 `.vssx` files (plus drawings and templates).
- Each rack-gear shape ("master") is a picture, not drawn geometry: an **EMF / EMF+** image. Browsers cannot display EMF.
- Each master has a name such as `J-SRX210B Front` or `FPR4215-NGFW-K9 Rear`, so the model and the side come from the name.
- Sizes are drawn to scale, often enlarged (a 1U Cisco firewall is 190 × 17.43 in). U height can only come from proportions: `U ≈ (height / width) × 19 / 1.75`. That is right for 19-inch gear and wrong for desktop boxes (a desktop SRX210 comes out 1.6 U), so the user must confirm it.
- Some `.vss` files are empty placeholders (one note shape saying the shapes moved to another file).

## What was tried

| Approach | Result |
|---|---|
| LibreOffice opens `.vss` / `.vssx` directly (`soffice --convert-to pdf`) | Blank page. LibreOffice only draws masters placed on a page, and a stencil has no pages. |
| Wrap a `.vssx` as a `.vsdx` with one page per master, then LibreOffice | 19 pages, still blank. Dropped. |
| Pull the EMF out of a `.vssx` (`visio/media/*.emf`), then `soffice --headless --convert-to png` or `svg` | Works. Clean, correct picture, centred on a letter-size page, so it needs cropping. |
| libvisio's tools (`vss2raw`, `vss2xhtml`) on a legacy `.vss` (Dell PowerConnect J SRX, 21 shapes) | Works. All 21 shapes come out with names, sizes and their EMF pictures. Also works on `.vssx`. |

## Working pipeline

1. `vss2raw stencil.vss` (or `.vssx`): one `startPage(draw:name: …, svg:width, svg:height)` per master, followed by `drawGraphicObject` with the base64 EMF. (`vss2xhtml` gives the same as SVG wrappers around the EMF, but without names.)
2. LibreOffice headless converts each EMF to SVG (sharp at any size) or PNG, then crop to the drawn area.
3. Rackwright shows a preview: picture, model from the name, Front or Rear from the suffix, U height guessed from proportions and editable, with a row checkbox. Applying adds picture faceplates to the catalog.

## Where it should run

- **Server (preferred):** Debian packages `libvisio-tools` and `libreoffice-draw-nogui`. The web server converts uploads itself; the desktop app sends stencils to its server. Same behaviour on both, and `Rackwright.exe` stays small.
- **Windows test setup:** LibreOffice (winget `TheDocumentFoundation.LibreOffice`) and MSYS2 with `mingw-w64-ucrt-x86_64-libvisio` (tools in `C:\msys64\ucrt64\bin`).

## What Rackwright needs first

- Picture faceplates: today faceplates are drawn from `plate` settings, not images.
- Somewhere to keep the pictures (server storage, not inside each `.rack.json`), and an endpoint, written into `web/API.md` first.
- Possibly matching stencil pictures to existing catalog models by model name.
