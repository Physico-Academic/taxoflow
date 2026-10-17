# Contributing to TaxoFlow Properties

Thank you for helping improve TaxoFlow Properties.

## Before opening an issue

- Check existing issues for duplicates.
- Include your Obsidian version, operating system, TaxoFlow Properties version, and concise reproduction steps.
- Include console errors when available, after removing personal information.
- Do not upload entire vaults, private notes, or frontmatter containing sensitive information.

## Development setup

Requirements: Node.js 18 or later, Python 3.10 or later, and PyYAML.

```bash
python -m pip install -r requirements.txt
npm test
npm run check:syntax
npm run check:release
```

## Pull requests

- Keep changes scoped and explain their user-visible effect.
- Add regression tests for behavioral changes.
- Do not introduce a Bases-specific integration without an explicit project decision.
- Keep the runtime domain-agnostic and retain the `taxo.` root prefix.
- Use `label` and `propertyLabels` for TaxoFlow Properties display-label configuration.
- Do not reintroduce a runtime property-key migration queue or legacy namespace mapping table.
- Preserve safe write behavior and require confirmation for destructive note operations.
- Keep `main.js` and `styles.css` completely comment-free.
- Retain the upstream MIT notice in distributed copies and do not remove required attribution.

## Release policy

Releases use semantic versions in `x.y.z` format. The version in `manifest.json`, the release tag, and release artifacts must agree. The initial release tag is `1.0.0` without a `v` prefix.
