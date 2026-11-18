# Word report (3.18.0) — design

Date: 2026-11-18. Last release of the RackMap merge. Builds on the 3.9.0 client report (`rackwright-tauri/src/report/`) and the branding uploads from 3.7.0. Earlier notes: `2026-11-16-look-and-feel-design.md` ("Word export").

## Why

The MSP presents a quarterly network review to each client. The PDF (3.9.0) is branded but laid out by Rackwright. The company already has a Word master template with its own cover, styles, headers and footers, and wants the review delivered inside it, so it looks like every other document it sends and can be edited before it goes out.

## Goals

1. **Export Word** in the Client report dialog, next to Export PDF: the same Overview / Detailed content, the same options (sites, date, prepared for, summary, recommendations), built into the uploaded master template.
2. An admin uploads the **Word master template** in Settings › Branding (web: server asset; desktop: this PC's storage), like the logo and artwork.
3. **Markers** the template author can type anywhere — body, tables, text boxes, cover, headers, footers:

| Marker | Becomes |
|---|---|
| `{{CLIENT}}` | Client name (the client company's name as saved in Clients) |
| `{{PREPARED_FOR}}` | The dialog's "Prepared for" field (defaults to the client name) |
| `{{SITE}}` | Names of the chosen sites, joined with ", " |
| `{{DATE}}` | Report date, written out ("November 18, 2026") |
| `{{REPORT_TITLE}}` | "Network review — <Client>" (same as the PDF title) |
| `{{PREPARED_BY}}` | Company name from Branding (empty if none) |
| `{{SUMMARY}}` | Executive summary text |
| `{{RECOMMENDATIONS}}` | Recommendations text |
| `{{RACKWRIGHT}}` | The generated report body |

   Unknown markers (`{{ANYTHING}}` made of letters, digits and `_`) and markers with nothing to put in are removed. Markers that Word has split across several text runs are found and replaced.
4. With no template uploaded, the same code fills a small built-in blank .docx, and the dialog says "No Word template is uploaded, so this uses plain Word styles. An admin can upload one in Settings › Branding."
5. README documents the markers.

## Non-goals and anti-goals

- No new npm dependency. `jszip` (already used) builds the file; `fast-xml-parser` (already used) is only for the well-formedness test.
- No Word field codes, content controls or mail-merge fields; markers are plain text.
- No .dotx upload (a .dotx has a different main content type). The upload asks for .docx: "Save the template as a Word document (.docx) and upload that."
- **Anti-goals:** the template's look must survive. `word/styles.xml`, `word/theme/*`, `word/numbering.xml`, `word/settings.xml`, `word/fontTable.xml`, the template's existing media and every part we don't need to change are copied byte-identical. A report that Word reports as damaged ("Word found unreadable content") is a failure even if the content is right.
- The company's real name, branding and template are never committed or put in tests. Tests build a made-up "Example IT" template in code.

## Constraints

- Shared front end for desktop and web. Builder modules must run under `npx tsx` (no `IS_WEB`, no DOM in the pure parts).
- No local Rust; the server change (new asset name) is first compiled in CI. `web/API.md` is changed first.
- Colours via `v(token)` in UI; literal hex in report output marked `// theme-ok`.
- Plain-language UI copy.

## Approaches

- **A. jszip + hand-written WordprocessingML (chosen by the user).** Open the template with jszip, rewrite only the text of runs that hold markers, splice generated body XML in at `{{RACKWRIGHT}}`, add pictures and relationships. Same path for the built-in blank template. No new dependency, all marker logic unit-testable in Node.
- **B. docxtemplater.** Good split-marker handling, but images need its paid module and the report body would still be hand-written. Rejected: a dependency for the easy part.
- **C. `docx` library + merge into template.** Merging styles, numbering and relationships between two documents is brittle, and the template's look is the point. Rejected.

## Design

### Template upload

- New asset name `word_template`. Server (`web/server/src/settings.rs` `asset_rule`): types `application/vnd.openxmlformats-officedocument.wordprocessingml.document` and `application/octet-stream`; at most 10 MB ("That file is too large (10 MB at most)."); body must start with the zip signature `PK\x03\x04`, else "Upload a Word document (.docx)." Same admin-write / any-signed-in-read rules as the other assets. API.md row updated; server test added in `web/server/tests/api.rs`.
- Desktop: the same name in IndexedDB via `settingsStore().setAsset`; `checkAsset` applies the same type/size/signature check.
- Front end also checks, on upload, that the zip has `word/document.xml`, and says "This file isn't a Word document." if not.
- Settings › Branding gets a "Word master template" row (file name or "Uploaded", Upload, Remove, and a one-line hint: "Type markers such as {{CLIENT}} and {{RACKWRIGHT}} where the report should fill in. See the README.").

### Marker replacement (pure, `report/docxMarkers.ts`)

Applies to `word/document.xml`, every `word/header*.xml` and `word/footer*.xml`, and `word/footnotes.xml` / `word/endnotes.xml` if present.

- Work paragraph by paragraph (`<w:p>`), including paragraphs nested inside text boxes and table cells. Join the text of the paragraph's own `<w:t>` elements in order; find `{{NAME}}` in the joined text; map the match back to the runs it spans.
- The replacement text goes into the first run the marker touches (keeping that run's formatting); the marker's characters are cut from the other runs; a `<w:t>` left empty is removed; `xml:space="preserve"` is set where text has leading/trailing spaces.
- Only `<w:t>` text is changed. Everything else in the part (bookmarks, proofing marks, field codes, drawings) stays as it was, byte for byte.
- All inserted text is XML-escaped (`& < > " '`) and stripped of characters XML 1.0 forbids.
- `{{SUMMARY}}` / `{{RECOMMENDATIONS}}`: if the marker is alone in its paragraph, the paragraph is repeated once per line of text, each copy keeping the paragraph's and run's properties (blank lines become empty paragraphs). If it shares the paragraph with other text, lines are joined with `<w:br/>` inside the run.
- `{{RACKWRIGHT}}` is handled in `word/document.xml` only (in a header/footer it is just removed). The first one wins; later ones are removed.
  - Alone in its paragraph (ignoring whitespace): that paragraph is replaced by the generated body.
  - Shares the paragraph with other text: the **whole paragraph** is replaced, and the export returns a note: "The {{RACKWRIGHT}} marker shared a paragraph with other text. That paragraph was replaced by the report."
  - Inside a table cell or text box: same rules; the body goes in the cell. (Unusual, but valid.)
  - Missing: the body is appended at the end of the document body, before the final `<w:sectPr>`, and the export returns a note: "The template has no {{RACKWRIGHT}} marker, so the report was added at the end."
- If the template uses `{{SUMMARY}}` anywhere, the generated body leaves out its own Executive summary section (same for `{{RECOMMENDATIONS}}`), so the text isn't printed twice.

### Generated body (`report/docxBody.ts`, pure)

Same sections and order as the PDF (`report/pdf.ts`), from the same `ReportModel`: Executive summary, Totals, Devices by type, Needs attention, Site links (diagram), per site: address, Infrastructure diagram(s), rack front views (Detailed: also rear), Detailed: switch port tables, device table, power table; Recommendations; Detailed: Full inventory, Links. Each site starts on a new page.

- **Headings** use the template's Heading 1 / Heading 2 styles. Style ids are looked up by style *name* (`heading 1`, `heading 2`) in `word/styles.xml` (read only, never rewritten), since ids differ in localised templates. If missing, bold direct formatting at 16 / 13 pt.
- **Tables** use the template's "Table Grid" style if present, else direct single borders; header row marked to repeat (`<w:tblHeader/>`), full text width. Table text is never truncated (Word wraps it).
- **Switch ports** are a table (Port, Connected to, Type, IP) of used ports with a "N of M ports used" line; the PDF's box grid is not drawn in Word.
- **Diagrams** are PNG pictures (`<w:drawing>` inline), drawn with the same offscreen code as the PDF (light theme, resolved colours), rasterised at 200 dpi for the size they are placed at, width = the text width of the template's last section (`w:pgSz` minus `w:pgMar`), height capped so a picture fits on one page (aspect kept). Fallback text width 6.5 in. A diagram that fails reads "This diagram could not be drawn." like the PDF.
- The body module takes the model plus already-rendered pictures (`{ id, png: Uint8Array, wPx, hPx }`), so it stays pure; `report/docx.ts` does the rendering in the browser and hands pictures over.

### Packaging (`report/docxPackage.ts`, pure)

- Pictures go in `word/media/rackwright-<n>.png`, with `<n>` chosen so no existing media file is overwritten.
- Each picture gets a relationship in `word/_rels/document.xml.rels` with a unique id (`rIdRw<n>`, checked against every id already in the file). Existing relationships are untouched.
- `[Content_Types].xml` gets `<Default Extension="png" ContentType="image/png"/>` only if no PNG default exists; nothing else in it changes.
- Drawing ids (`wp:docPr id`) are unique across the document (start above the highest existing one).
- The built-in blank template is a minimal valid docx built in code (content types, rels, document with `{{RACKWRIGHT}}` and a US Letter `sectPr`, a small styles.xml with Heading 1/2 and Table Grid).
- Output: `<client> network review <date>.docx` via `backend.saveBytes` with the Word mime type.

### Dialog

- Buttons: Cancel, Export Word, Export PDF. Both save the report options first (as now).
- If no template is uploaded, a line above the buttons says so (text in Goal 4).
- After a Word export with notes, the dialog stays open and shows the notes with "Saved." above them; without notes it closes as the PDF export does.

### Tests (`scripts/docx.test.ts`, synthetic "Example IT" template built in the test)

- Marker split across 2 and across 3+ runs, with different run formatting; the result keeps the first run's formatting.
- Every marker in the table, including `{{PREPARED_FOR}}` differing from `{{CLIENT}}`.
- Marker in a table cell; in a text box; in a header and in a footer; sharing a paragraph with other text.
- Unknown marker and empty-value marker removed; text with `& < > " '` and a control character escaped/stripped.
- `{{SUMMARY}}` alone (one paragraph per line) and inline (`<w:br/>`).
- `{{RACKWRIGHT}}` alone, sharing a paragraph (whole paragraph replaced + note), missing (appended before the last `sectPr` + note), twice (second removed).
- Packaging: template with an existing `image1.png`, an existing `rId7`, and an existing PNG content-type default — new ids unique, existing media bytes unchanged, PNG default not duplicated; and a template without a PNG default gets one.
- Output opens cleanly: JSZip reloads it; every `.xml` / `.rels` part passes `fast-xml-parser`'s `XMLValidator`; every relationship target exists in the zip; `word/styles.xml` and `word/theme/theme1.xml` are byte-identical to the template's.
- Built-in blank template produces a valid file the same way.

## Calls made while writing this up (check these)

1. `{{SITE}}` with several sites: names joined with ", ".
2. `{{DATE}}` written out in US style ("November 18, 2026"); the PDF is unchanged.
3. If the template uses `{{SUMMARY}}` / `{{RECOMMENDATIONS}}`, the body skips those sections.
4. Markers also work in footnotes and endnotes.
5. .docx only, no .dotx; 10 MB limit; zip signature checked on the server.
6. Switch ports are tables in Word (no box grid).
7. Pictures at 200 dpi, width from the template's page margins.
8. Notes (marker shared a paragraph / marker missing) are shown in the dialog after saving, not written into the document.

## Settled after the builder check

9. **No cover in the body.** The generated body starts at Executive summary; title, prepared for / by and date come only from the template's markers. The built-in blank template has its own title block made of markers (`{{REPORT_TITLE}}` as Title, then "Prepared for {{PREPARED_FOR}}", "Prepared by {{PREPARED_BY}}" and `{{DATE}}`; a line whose marker is empty is left out), then a page break and `{{RACKWRIGHT}}`.
10. **Skip rule scope.** "Uses `{{SUMMARY}}`" means the marker appears in `word/document.xml` (body, tables, text boxes), not only in a header, footer or note. Empty summary or recommendations text leaves the section out either way, as the PDF does.
11. **Text boxes stored twice.** Word keeps a text box as `mc:Choice` plus an `mc:Fallback` copy. Ordinary markers are replaced in both. `{{RACKWRIGHT}}` inside `mc:Fallback` is removed and never counted, so the `mc:Choice` copy is the one that takes the body.
12. **`document.xml` is edited as text, not re-serialised.** The root element, its namespace declarations and `mc:Ignorable` stay exactly as in the template. Generated XML uses the `w`, `r`, `wp`, `a` and `pic` prefixes. Any of these the root element does not declare is added to the root with its standard namespace URI. Nothing else on the root changes.
13. **Drawing ids** (`wp:docPr id`) start above the highest id found in `document.xml`, every header, footer, footnote and endnote part.
14. **Same options for both buttons.** Export Word uses the dialog's level, sites, date, prepared for, summary and recommendations, exactly as Export PDF.

## Left to the builder

Exact XML scanning technique (a tag-level scanner that tracks `<w:p>` nesting and rewrites only `<w:t>` text is suggested; a DOM round-trip of whole parts is not, since it risks changing bytes and namespace prefixes), the minimal blank template's exact XML, table column widths, how pictures are rasterised from the existing SVG clones (canvas from a serialized SVG), and component layout of the new Settings row within the theme tokens.
