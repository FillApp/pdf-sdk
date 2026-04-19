# TODO

Working task list. Read `CLAUDE.md` first for architecture and constraints.

The vision (see `CLAUDE.md` §8): an isomorphic pure-JS SDK that parses any AcroForm PDF into a canonical `Template` JSON, lets code on either side of the wire fill native fields and add overlay content (text, images, checkmarks, crosses), and generates a final PDF with the AcroForm preserved. Byte-for-byte deterministic across Node and browser.

---

## Done

### v0.2.0

- `setFieldValue(id, value)` with variant-correct validation. Rejects wrong types, rejects out-of-options values on choice fields, refuses >1 value on single-select listbox, truncates text to `maxLength` with a `value-truncated` diagnostic.
- `generate({ font? })` preserves the AcroForm, sets `/NeedAppearances true`, draws overlays onto pages, and fixes `ModDate` so repeat runs produce byte-identical output.
- Overlay pipeline: `OverlayField` variant on `Template.fields` with `source: "overlay"` and kinds `text`, `image`, `checkmark`, `cross`. `addOverlay` / `updateOverlay` / `removeOverlay` on `PdfSdk`.
- Bundled Noto Sans Regular subset (~67 KB TTF) covering Latin + Latin Extended + Cyrillic + punctuation + currency symbols. Registered via `@pdf-lib/fontkit` at `generate()` time.
- `RadioField.widgets: RadioWidget[]` exposes every radio button with its own position and page.
- Hierarchical field names (`billing.address.line1`) round-trip correctly. Fixed a bug where `useObjectStreams: false` silently dropped hierarchical values.
- Encrypted PDF fixture and tests for the default-refuse and `allowEncrypted: true` paths.
- Visual regression suite (Playwright + pdfjs-dist) with committed baselines covering f1040, choices, flat overlays, and more.
- Cross-runtime determinism: Playwright builds an ESM browser bundle of the SDK, runs the same fill+generate pipeline in chromium, and asserts `sha256(nodeBytes) === sha256(browserBytes)`.
- Performance baseline on a 100-page / 1000-field fixture. macOS / Node 22: parse ~100 ms, fill × 100 ~160 ms, generate ~220 ms.
- Release workflow: tag-push triggered `.github/workflows/release.yml` with `prepublishOnly` gate and `npm publish --provenance --access public`.
- **Published to npm** as `@fillapp/pdf-sdk@0.2.0` under MIT. Repo is public.

### v0.0.1

- Load from `Uint8Array`, `ArrayBuffer`, `Blob`, base64 string.
- Encrypted PDFs refused by default. `allowEncrypted: true` opt-in.
- Parse 100% of supported AcroForm types (text, checkbox, radio, dropdown, listbox) from a real 38-field fixture.
- Per-field metadata extracted: page index, position in PDF points, options, `maxLength`, `multiline`, `isMultiSelect`, `readOnly`.
- Non-fatal parse issues surface via `ParseDiagnostic[]`. No silent swallowing.
- Discriminated union on `type`. Each variant carries its own value shape.
- Stable URL-safe field IDs (`acro:<sanitized-name>:<widget-index>`).
- O(1) page lookup via `Map<PDFRef, pageIdx>`.
- `PdfSdk` constructor is private. `load` is the only entry. Getters return copies.
- `parseToTemplate(doc, bytes)` exported for advanced consumers.
- ESM + CJS + `.d.ts` via tsup. Subpath export `/utils` so coordinate helpers can be imported without pulling pdf-lib.
- ESLint 9 flat config, Prettier, Vitest with V8 coverage (85/90/80/85 thresholds).
- GitHub Actions CI: lint, typecheck, format:check, test across Node 18/20/22, coverage, build, dist-artifact load verification. Dependabot weekly.

---

## Next up (priority order)

### Crucial for reliable first-user experience

1. **Appearance-stream regeneration for text and checkbox fields.** Today `generate()` sets `/NeedAppearances true`. Acrobat, Chrome, Firefox, and pdf.js honor it. iOS Preview, many print pipelines, and PDF-to-image rasterizers do not, so filled fields show as blank. Plan: regenerate appearance streams for text and checkbox during `generate()` using the bundled Noto Sans font. Leave radios, dropdowns, and listboxes on the flag path (pdf-lib's appearance updates for those still have known artifacts). Pin with a second-engine rasterization visual test.
2. **`setFieldValues(values: Record<string, string | string[] | boolean>)` batch.** Small wrapper over `setFieldValue`. Unknown ids push a diagnostic instead of throwing so a partial fill is not aborted.
3. **Template serialization helpers.** `templateToJSON(template): string` and `templateFromJSON(json): Template`. Wraps `basePdf: Uint8Array` in base64 so the whole `Template` survives a JSON round-trip. Consumers need this to persist forms server-side and rehydrate in the browser.
4. **CI visual regression job.** Current CI does not run Playwright. Add a job that installs chromium, runs `npm run test:visual`, and uploads the HTML report on failure. Commit linux baselines alongside the darwin ones.
5. **Cloudflare Workers smoke test in CI.** The README implies Workers compatibility. Prove it with a minimal Workers-running test.

### Needed for 1.0

6. **Real password-protected PDFs.** Today `allowEncrypted: true` opens the file structurally via pdf-lib's `ignoreEncryption`, which leaves field streams unreadable. Add `{ password: string }` on `LoadOptions` for proper decryption.
7. **Per-AcroForm text-field font-size override.** `setFieldValue(id, value, { fontSizePt? })` for fixtures whose Default Appearance is too large for the value.
8. **Multi-font fallback chain.** `fonts: Uint8Array[]` on `GenerateOptions` for mixed-script documents (CJK + Arabic + Latin in the same form). Fall back per glyph.
9. **Overlay text styling.** Font family, bold, italic, alignment (left/center/right), rotation, multiline wrapping.
10. **Overlay image extras.** Opacity, aspect-fit, rotation. Signature stamps typically want aspect-preserve.
11. **`clearFieldValue(id)` and `resetForm()`.** Ergonomics.
12. **PDF metadata on `generate()`.** Optional `{ title, author, producer, pdfVersion }` for compliance output.
13. **`getPdfDocument()` escape hatch.** Either cover it with a test or remove it if nothing reaches for it.
14. **Code of conduct + issue and PR templates.** Low priority, add before 1.0.
15. **Overlay visual examples in the README.** Committed baselines are the right assets. Embed a few.

---

## Explicitly out of scope

Do not add these. If a consumer asks, tell them to do it outside the SDK.

- XFA forms. Flag and degrade to the AcroForm fallback only.
- True digital signatures (PKI, certificates, timestamping).
- PDF JavaScript action execution.
- OCR.
- Page split, merge, reorder, compression, format conversion.
- Real-time collaboration, CRDTs.
- Rendering or viewing PDFs. Use `pdf.js` or similar on top.

---

## Technical debt / loose ends

- Coverage for the `catch` arms in `extractValue` / `extractOptions` relies on future malformed-input fixtures.
- `package.json` repo URL is `github.com/FillApp/pdf-sdk`. Update if the org casing ever changes.
- CI does not yet run the visual or determinism suites.
