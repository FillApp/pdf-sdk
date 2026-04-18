# TODO

Working task list. Read `CLAUDE.md` first for architecture and constraints.

The vision (from `CLAUDE.md` §8): an isomorphic pure-JS SDK that parses any AcroForm PDF into a canonical `Template` JSON, lets code on either side of the wire fill native fields and add overlay content (text / images / checkmarks / crosses), and generates a final PDF with AcroForm preserved (or optionally flattened). Byte-for-byte deterministic across Node and browser.

---

## Done (v0.2.0)

### Fill + generate

- `PdfSdk.setFieldValue(id, value)` — variant-correct, rejects wrong types, rejects out-of-options values on choice fields, refuses >1 value on single-select listbox, truncates text to `maxLength` with a diagnostic.
- `PdfSdk.generate({ flatten?, font? })` — default preserves AcroForm; `flatten` strips the form and removes signature fields first to dodge the pdf-lib flatten crash. Sets a fixed ModDate for byte-identical reruns. Optional caller-supplied font for non-Latin scripts.

### Overlays

- `OverlayField` variant on `Template.fields` with `source: "overlay"`. Kinds: `text`, `image`, `checkmark`, `cross`.
- `addOverlay` / `updateOverlay` / `removeOverlay` on `PdfSdk`.
- `generate()` now draws overlays after AcroForm fill + appearance update, before any optional flatten. Text uses the same embedded font as field appearances; checkmark + cross are vector strokes.

### Font

- Bundled Noto Sans Regular subset (~67 KB TTF, ~90 KB base64) covering Latin + Latin Extended + Cyrillic + general punctuation + currency symbols. Registered via `@pdf-lib/fontkit` at `generate()` time.

### Determinism + cross-runtime

- `generate()` output is byte-identical across runs for the same `Template`.
- Playwright determinism suite builds an ESM browser bundle of the SDK, runs the same fill+generate pipeline in chromium, and asserts `sha256(nodeBytes) === sha256(browserBytes)` (AcroForm-preserved and flattened paths both).

### Radio multi-widget + hierarchical names

- `RadioField.widgets: RadioWidget[]` exposes every radio button with its own position + page.
- Hierarchical field names (`billing.address.line1`) round-trip correctly. Fixed a subtle bug: `useObjectStreams: false` silently dropped hierarchical values; removed.

### Encrypted PDFs

- Fixture + test for the default refuses / `allowEncrypted: true` opens paths.

### Visual regression

- `test/visual/` Playwright suite renders every generate path through `pdfjs-dist` and diffs against committed baselines. 12 baseline PNGs cover unfilled / filled / flattened / Unicode / overlays-on-flat / mixed overlays+AcroForm-flattened.

### Performance

- 100-page / 1000-field benchmark fixture + test. Observed on macOS / Node 22: parse ~100 ms, fill × 100 ~160 ms, generate ~220 ms.

### 94 unit tests + 9 visual/determinism tests, all green.

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
- Vitest with V8 coverage (85/90/80/85 thresholds).
- GitHub Actions CI: lint, typecheck, format:check, test across Node 18/20/22, coverage, build, dist-artifact load verification.
- Dependabot for weekly npm + monthly actions updates.
- `README.md`, `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`.

---

## Next up (priority order)

### Before npm publish

1. **Verify visual baselines** — the maintainer should eyeball each committed PNG in `test/visual/fill.spec.ts-snapshots/` and confirm the rendering matches expectations. Any baseline that looks wrong should be fixed in the generator (not by rebaselining).
2. **CI visual job** — current CI doesn't run Playwright. Add a job that installs chromium, runs `npm run test:visual`, and uploads the HTML report on failure. Decide between (a) committing linux baselines alongside darwin ones or (b) running visual tests only on darwin-self-hosted runners.
3. **`npm publish`** — `npm run prepublishOnly` gates lint + typecheck + test + build. Ship `0.2.0`.

### v1.0.0 finishing touches

4. **Cloudflare Workers smoke test** — the README claims Workers compatibility. Add a minimal Workers-running test in CI that imports the SDK and parses a fixture PDF.
5. **Docs: overlay visual examples** — once npm publish is done, embed sample screenshots in README (the committed baselines are already the right assets).
6. **`getPdfDocument()` escape hatch** — untested. Either cover it with a test or remove it if nothing in the ecosystem reaches for it.
7. **Symbol set review** — if "circle a word" or strikethrough show up in target legal forms (W-9, I-9, W-4, 1040, leases), add as overlay kinds. If not, keep scope tight.

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

- Coverage for the `catch` arms in `extractValue` / `extractOptions` relies on future malformed-input fixtures.
- `getPdfDocument()` escape hatch — see v1.0.0 #6.
- `package.json` repo URL is set to `github.com/FillApp/pdf-sdk`. Update if the org casing ever changes.
- `CODE_OF_CONDUCT.md`, issue/PR templates — low priority; add before v1.0.0.
- CI doesn't yet run the visual or determinism suites.
