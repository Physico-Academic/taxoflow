# Architecture overview

## Runtime

`main.js` is the single production bundle loaded by Obsidian. It contains the runtime helpers, suggestion provider, modal implementations, settings tab, configuration handling, dependency evaluation, serialized frontmatter writes, and Orphan Management.

The runtime uses `TAXOFLOW_PROPERTY_PREFIX` as the sole root-prefix constant. A configured profile's namespace determines which properties belong to it. Runtime behavior does not depend on domain names such as Books or Countries.

The user-facing display-label field is `label`. Profile-level labels for properties without selector definitions are stored in `propertyLabels`. The underlying note property keys remain unchanged by label changes.

Dependency logic is evaluated against each selector's declared dependencies. Prepared rule indexes and dependency order are cached and invalidated when the normalized settings are refreshed. File writes are serialized by file path. Orphan inventory maintains per-path information and refreshes changed paths incrementally, with a full scan used for initial inventory or recovery.

Modal movement uses pointer capture and lifecycle cleanup so drag handlers can continue tracking movement after the pointer leaves the heading. Property type resolution prioritizes the active property DOM, then consults Obsidian type-manager methods and object or Map-backed assigned-type data (case-insensitively), and only falls back to YAML shape if the assigned type is unavailable. Type is rechecked during the selection/write path so Text and List behavior follows the current assigned type rather than only the YAML value shape.

## Configuration

`data.json` in this repository is a clean, uninitialized schema-v4 fixture. It contains no profile, taxonomy, or user data. The plugin settings file created in each user's vault is controlled by Obsidian's plugin data APIs.

TaxoFlow Properties does not implement a runtime property-key migration queue or maintain legacy namespace mappings. Existing `selector.` data can be converted with the optional utility under `tools/convert_legacy_vault.py`. The utility defaults to a dry run, lists key changes and values, refuses conflicting frontmatter destinations, restricts output configuration to the vault, and makes backups before applying changes.

## Tests

- `tests/plugin.test.cjs` loads the bundle with mocked Obsidian APIs and covers configuration, prefix matching, label schema, default application safeguards, and key runtime wiring.
- `tests/test_conversion.py` covers the optional conversion utility, including dry-run behavior, collisions, backups, and path safety.
- `tools/validate_release.py` checks manifest/version consistency, clean configuration, upstream attribution, namespace branding, and comment-free shipped JavaScript/CSS.

These tests do not establish live Obsidian rendering or metadata-cache timing. A disposable-vault test remains required before the initial public release.
