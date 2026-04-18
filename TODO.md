# TODO

Working task list. Read `CLAUDE.md` first for architecture and constraints.

The vision (from `CLAUDE.md` §8): an isomorphic pure-JS SDK that parses any AcroForm PDF into a canonical `Template` JSON, lets code on either side of the wire fill native fields and add overlay content (text / images / checkmarks / crosses), and generates a final PDF with AcroForm preserved (or optionally flattened). Byte-for-byte deterministic across Node and browser.

---

## Done (Unreleased — staged for v0.1.0)

### Fill + generate

- `PdfSdk.setFieldValue(id, value)` — variant-correct, rejects wrong types,
  rejects out-of-options values on choice fields, refuses >1 value on
  single-select listbox, truncates text to `maxLength` with a diagnostic.
- `PdfSdk.generate({ flatten? })` — default preserves AcroForm; `flatten`
  strips the form and removes signature fields first to dodge the pdf-lib
  flatten crash. Sets a fixed ModDate for byte-identical reruns.
- Round-trip test coverage: fill every variant, `generate()`, reparse, assert
  values match. 73 tests green (22 new).
- Runtime diagnostics: `value-truncated`, `signature-flatten-skipped`.

### Visual testing

- Playwright suite under `test/visual/` rendering generated PDFs via
  `pdfjs-dist` inside a chromium harness. 10 committed baseline PNGs cover
  unfilled / filled / flattened pages plus the no-AcroForm flat fixture.
- `npm run test:visual` runs diffs against baselines; `test:visual:update`
  refreshes them after an intentional change.

## Done (v0.0.1)

### Load + parse
- Load from `Uint8Array`, `ArrayBuffer`, `Blob`, base64 string.
- Encrypted PDFs refused by default; `allowEncrypted: true` opt-in.
- Parse 100% of supported AcroForm types (text, checkbox, radio, dropdown, listbox) from a real 38-field fixture.
- Per-field metadata extracted: page index, position in PDF points, options, `maxLength`, `multiline`, `isMultiSelect`, `readOnly`.
- Non-fatal parse issues surfaced via `ParseDiagnostic[]`; no silent swallowing.
- Discriminated union on `type` — each variant carries its own value shape.
- Stable URL-safe field IDs (`acro:<sanitized-name>:<widget-index>`).
- O(1) page lookup via `Map<PDFRef, pageIdx>`.
- `PdfSdk` constructor is private; `load` is the only entry. Getters return copies.
- `parseToTemplate(doc, bytes)` exported for advanced consumers.

### Tooling & infra
- ESM + CJS + `.d.ts` via tsup. Subpath export `/utils` so coordinate helpers can be imported without pulling pdf-lib.
- ESLint 9 flat config with typescript-eslint.
- Prettier with `format` and `format:check` scripts.
- Vitest with V8 coverage (85/90/80/85 thresholds — currently at ~86/92/88/86).
- GitHub Actions CI: lint, typecheck, format:check, test across Node 18/20/22, coverage, build, dist-artifact load verification.
- Dependabot for weekly npm + monthly actions updates.
- `README.md`, `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`.
- 51 tests, all green.

---

## Next up (priority order)

### v0.1.0 — ship the fill+generate release

The feature work is done (see Done section above). Before tagging:

1. **Docs polish** — update README's usage section with `setFieldValue` and
   `generate` examples. Move the line about "Roadmap: setFieldValue, generate"
   out of README's roadmap section.
2. **Bundled Unicode font (carried over from original v0.1.0 scope)** — in the
   current implementation `generate()` calls `updateFieldAppearances()` with
   no explicit font, so Helvetica (the default `/DA` font) is used. Non-Latin
   text fails to render. Either subset & embed a Unicode font now or defer to
   v0.2.0 where the overlay text pipeline also needs one. Recommend deferring:
   one font serves both paths.
3. **Tag + publish** — version bump to `0.1.0`, tag, push, `npm publish`.

### v0.2.0 — overlay content

> **Goal:** Add text, images, and glyphs to any PDF — including flat/scanned PDFs that have no AcroForm. Both backend and frontend operate on the same `OverlayField` entries.

5. **Reintroduce `OverlayField`** (type was removed in v0.0.1 cleanup).
   ```ts
   type OverlayField = {
     id: string;
     source: "overlay";
     kind: "text" | "image" | "checkmark" | "cross";
     page: number;
     position: { xPt: number; yPt: number; widthPt: number; heightPt: number };
     text?: { value, fontFamily, fontSizePt, color, bold?, italic? };
     image?: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" };
   };
   ```
   Decide on a glyph font for checkmark / cross. Noto Sans Symbols 2 subset is the leading candidate.

6. **`addOverlay(field: Omit<OverlayField, "id">): string`** — returns generated id.
   **`updateOverlay(id, partial)`**
   **`removeOverlay(id)`**
   All three return copies from `getFields()`.

7. **Extend `generate()` to draw overlays.**
   - Text: `page.drawText` with the specified font/size/color.
   - Image: `embedPng` / `embedJpg` then `page.drawImage`.
   - Checkmark / cross: draw as glyphs from the bundled symbol font.
   - Run overlay drawing after AcroForm fill + appearance update, before optional flatten.

8. **Ship a small bundled font** for text overlays that supports Latin Extended + Cyrillic + basic symbols. Noto Sans subset ~50 KB. Add font embedding tests.

9. **Tests for v0.2.0**
   - Add overlay text at known coordinates, generate, render to image (use `pdfjs-dist` in Node for rasterization), assert pixel presence within expected bbox.
   - Full round-trip: parse → add overlays → generate → reparse → overlay positions/content match.
   - Mixed document: AcroForm fills + overlay text + overlay image + overlay checkmark on the same output.

### v0.3.0 — browser test suite

10. **Inline fixture loading that works in Node AND browser.**
    - Convert `test/fixtures/*.pdf` to base64 constants generated at test-prepare time.
    - `loadFixture` branches on `typeof window` and picks the right source.
    - Or: use a Vite asset-import plugin for fixtures.
11. **`vitest.config.ts` browser mode** using Playwright + chromium.
12. **CI browser job.**
13. **Byte-equality test across runtimes:** hash output of `generate()` for the same `Template` in Node and in browser. Hashes must match. This is the key pin for the determinism contract.

### v1.0.0 — legal-PDF form filling, end-to-end complete

14. **Radio group multi-widget exposure.** Current parser exposes only the first widget's position. Extend `RadioField` with `widgets: { value: string; position: Rect }[]` so consumers can render every radio option. Backfill the API without breaking v0.x consumers.
15. **Hierarchical field names** (`parent.child.grandchild`). Add a fixture, confirm ID sanitization does not clash, decide whether to expose the hierarchy.
16. **Encrypted PDF fixture + test** for the `allowEncrypted` path.
17. **Cloudflare Workers smoke test** in CI (current README claims it works; prove it).
18. **Symbol set review.** If "circle a word" or strikethrough show up in target legal forms (W-9, I-9, W-4, 1040, leases), add as overlay kinds. If not, keep scope tight.
19. **Performance pass.** Benchmark 100-page PDFs. The parser currently creates closures in a tight loop for page lookup — already O(1); confirm full-pipeline parse stays under 1 s for a 100-page form.
20. **Publish v1.0.0 to npm** once all above are green and a real consumer project has integrated it successfully.

---

## Explicitly out of scope

Do not add these. If a consumer asks for them, tell them to do it outside the SDK.

- XFA forms — flag and degrade to AcroForm fallback only.
- True digital signatures (PKI, certificates, timestamping).
- PDF JavaScript action execution.
- OCR.
- Page split / merge / reorder / compression / format conversion.
- Real-time collaboration, CRDTs.
- Rendering / viewing PDFs (use `pdf.js` or `pdfme` on top).

---

## Technical debt / loose ends

- Coverage for the `catch` arms in `extractValue` / `extractOptions` relies on future malformed-input fixtures. Currently the happy path dominates; branches sit at 88%.
- `getPdfDocument()` escape hatch exists for advanced use but is untested. If it stays past v0.1.0, add a test. If no one uses it, remove it.
- `package.json` repo URL is still a placeholder (`github.com/fillapp/pdf-sdk`). Update when the public repo exists.
- No `CODE_OF_CONDUCT.md`, no issue/PR templates. Low priority; add before v1.0.0.
