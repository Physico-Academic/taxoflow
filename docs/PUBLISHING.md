# Publishing TaxoFlow Properties 1.0.0

The project is prepared for the initial GitHub release and Obsidian directory submission. Publishing must still be performed from the maintainer's account.

## Create the repository

1. Create a public repository named `taxoflow` under `Physico-Academic`.
2. Extract the repository archive and push the contents to the default branch.
3. Confirm the root contains `README.md`, `LICENSE`, `manifest.json`, `main.js`, and `styles.css`.
4. Review and commit the `FUNDING.yml`, CI workflows, tests, documentation, and optional conversion utility.

## Run checks

Install Python requirements and run:

```bash
python -m pip install -r requirements.txt
node --check main.js
python tools/validate_release.py
npm test
```

Test the plugin in a disposable Obsidian vault before publishing.

## Create the first release

1. Confirm `manifest.json` contains version `1.0.0`.
2. Commit the same manifest to the default branch.
3. Push a tag named exactly `1.0.0` (without a `v` prefix).
4. The `Publish release` workflow verifies the manifest and tests, then attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub release.
5. Verify the resulting release assets and release notes.

## Submit to Obsidian

1. Sign in at the Obsidian Community directory.
2. Link the `Physico-Academic` GitHub account to the Obsidian profile.
3. Submit the new repository for review.
4. Resolve automatic checks and reviewer feedback, publishing a matching new release if code changes are required.

The initial directory submission cannot be completed by the files in this archive; the maintainer must perform the account-linked submission. See the [official Obsidian submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin).
