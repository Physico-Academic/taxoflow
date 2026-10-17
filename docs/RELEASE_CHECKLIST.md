# TaxoFlow Properties 1.0.0 release checklist

## Before creating the public release

- [ ] Confirm repository name availability and create `https://github.com/Physico-Academic/taxoflow`.
- [ ] Review the README, LICENSE, NOTICE, manifest, and the upstream MIT attribution.
- [ ] Run `npm run check:syntax`, `npm run check:release`, and `npm test`.
- [ ] Test installation in a disposable Obsidian vault.
- [ ] Test fresh profile creation, Text/List changes, rule editing, defaults, Orphan Management, and modal dragging in live Obsidian.
- [ ] Test the optional converter on a copy of a vault; inspect its dry-run and backup output.
- [ ] Resolve any release-review or live Obsidian failures before submission.

## Create GitHub release

- [ ] Commit source and documentation to the public repository's default branch.
- [ ] Confirm `manifest.json` version is exactly `1.0.0`.
- [ ] Create release tag `1.0.0` without a `v` prefix.
- [ ] Attach the three release assets individually: `main.js`, `manifest.json`, and `styles.css`.
- [ ] Verify the three attached assets match the built files.

## Submit to Obsidian

- [ ] Sign in to the Obsidian Community directory.
- [ ] Link the GitHub account `Physico-Academic` to the Obsidian profile.
- [ ] Submit the repository for initial review.
- [ ] Resolve automated checks and reviewer feedback.
- [ ] Only announce directory availability after approval.

The artifacts produced here are prepared for upload; this checklist does not imply that a GitHub repository, GitHub Release, or Community Plugins listing has already been created.
