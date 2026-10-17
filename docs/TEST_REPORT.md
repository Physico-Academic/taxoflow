# TaxoFlow Properties 1.0.0 — Build verification report

## Automated results

- JavaScript regression tests: 35 passed, 0 failed.
- Python conversion tests: 10 passed, 0 failed.
- JavaScript syntax check: passed (`node --check main.js`).
- Release validation: passed (`python tools/validate_release.py`).
- JSON validation: passed for `manifest.json`, `versions.json`, and the clean `data.json` fixture.
- CSS parse: 120 top-level rules, 0 parser errors (tinycss2).
- Shipped JavaScript and CSS comment scan: passed; no comments found.
- Namespace, project identity, label schema, and licensing checks: passed.
- Release ZIP and fresh-install ZIP: verified after packaging; exact contents are documented in the release handoff.

## Coverage highlights

Tests check `taxo.` namespace handling, rejection of old-root keys by runtime profile matching, empty initial profile configuration, `label` / `propertyLabels` schema, quoted comma-containing options, selector namespace matching, orphan categorization, drag and type-refresh wiring, and default application to empty properties only when valid in context.

Property-type checks cover object-backed and Map-backed Obsidian metadata, case-insensitive key lookup, active property DOM type taking precedence over stale metadata, and assigned Text type overriding array-shaped cached frontmatter. Suggestion checks cover hiding already-selected List values case-insensitively while retaining the current value in Text suggestions.

The conversion tests cover frontmatter key changes, preservation of note body content, collisions, duplicate YAML keys, conversion of dependency/rule/label references, dry-run no-write behavior, backup creation, and refusal to write a configuration path outside the vault.

## Not verified in this build environment

- Actual Obsidian startup and native property rendering.
- Actual pointer-drag behavior across different Obsidian windows and themes.
- Live property-type metadata timing during edits and note creation.
- Performance in a large live vault.
- Actual GitHub Actions execution, GitHub release creation, or Obsidian Community Plugins review.

The artifacts are prepared for upload. This report does not claim that they have passed live Obsidian verification or have already been published.
