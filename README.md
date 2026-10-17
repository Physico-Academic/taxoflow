# TaxoFlow Properties

If you like this plugin, your <iframe src="https://github.com/sponsors/Physico-Academic/button" title="Sponsor Physico-Academic" height="32" width="114" style="border: 0; border-radius: 6px;"></iframe> would be much appreciated.

TaxoFlow Properties manages configurable, profile-based taxonomies, context-dependent property suggestions, and automated folder routing in Obsidian. Selectors can use fixed options or cascading rules that depend on other properties, with full support for Text and List properties, display labels, safe defaults, folder organization, and Orphan Management.

## Features

- **Domain-agnostic profiles** and configurable property namespaces rooted at `taxo.`.
- **Context-dependent options** with explicit AND and OR rule logic.
- **Cascading taxonomies** with rule specificity, conflict detection, dependency-cycle checks, and impossible-context validation.
- **Automated folder routing** per profile that moves notes to dedicated folders while safely preserving internal links and backlinks.
- **Display labels** that customize visual property names in Obsidian without altering underlying frontmatter keys or queries.
- **Native type support** honoring Obsidian Text (scalar) and List (multi-value) property types.
- **Safe defaults** applied only to empty properties and only when valid in the current note context.
- **Multi-profile conflict resolution** with an interactive dialog when notes span multiple profiles with default folders.
- **Orphan Management** to discover, inspect, register, bulk-rename, or safely clean up obsolete or unmapped frontmatter keys.
- **Safe, non-destructive design** with link preservation and confirmation modals before destructive note operations.
- **Offline conversion utility** to migrate legacy `selector.` vaults to `taxo.` safely with dry-run previews and automated backups.

## Practical Use Cases & Examples

### 1. Cascading Taxonomies (Dependent Properties)
Instead of scrolling through a giant, flat list of unrelated tags or options, TaxoFlow lets you chain properties together so options depend dynamically on prior selections.

**Example: Literature & Research Tracker**
- `taxo.book_type` (Parent): `Fiction`, `Non-fiction`, `Academic`
- `taxo.book_genre` (Child):
  - When `Fiction` is selected &rarr; offers `Science Fiction`, `Historical Fiction`, `Mystery`.
  - When `Academic` is selected &rarr; offers `Physics`, `Computer Science`, `Philosophy`.
- `taxo.book_subfield` (Grandchild):
  - When `Academic` + `Physics` is selected &rarr; offers `Quantum Mechanics`, `Thermodynamics`, `Astrophysics`.

```yaml
---
taxo.book_type: Academic
taxo.book_genre: Physics
taxo.book_subfield: Quantum Mechanics
---
```
*Result: Selecting "Academic" immediately adapts the genre dropdown, and picking "Physics" narrows the subfield options, ensuring consistent metadata entry.*

---

### 2. Automated Note Routing by Profile
Organize your vault effortlessly without manually dragging notes into folders or maintaining separate folder-mover plugins.

**Example: Project & Knowledge Base Routing**
- Profile **Books** (`taxo.book_`) &rarr; Default folder: `Library/Books`
- Profile **Projects** (`taxo.proj_`) &rarr; Default folder: `Work/Projects`
- Profile **Daily Logs** (`taxo.log_`) &rarr; Default folder: `Journal/Logs`

When you add any property starting with `taxo.book_` (or instantiate a book note from a template), TaxoFlow automatically moves the note to `Library/Books/`.
- **Link Integrity:** Uses Obsidian's link manager, ensuring all internal wikilinks, embeds, and backlinks across your vault update seamlessly.
- **Conflict Handling:** If a note contains properties from multiple profiles with default folders (e.g. a book study note that is also part of a project), a clean popup asks you to choose the target folder or leave the note in its current location.
- **Batch Processing:** Click **Move existing notes to folder…** in Settings to scan and organize existing notes with a safety preview.

---

### 3. Human-Friendly UI with Machine-Readable Frontmatter
Keep your frontmatter keys standardized and namespaced for Dataview queries, templates, or scripts, while presenting a clean, friendly interface in Obsidian's visual property editor.

**Example: Task & Milestone Tracking**
- Stored frontmatter key: `taxo.proj_milestone_status`
- Configured Display Label: `Milestone Status`
- Stored frontmatter key: `taxo.proj_assigned_to`
- Configured Display Label: `Assignee`

*Result: You can write robust Dataview queries like `WHERE taxo.proj_milestone_status = "In Progress"`, while the note property editor displays clean, human-readable labels.*

---

### 4. Smart Defaults for Note Templates
Populate new notes with sensible defaults without corrupting existing records.

**Example: Status & Triage Defaults**
- Configure `taxo.task_status` with a default value of `Backlog`.
- When creating a new task note with `taxo.task_status: ""` or adding the property for the first time, TaxoFlow automatically fills `Backlog`.
- Existing notes with established values (such as `In Progress` or `Done`) are **strictly preserved** and never overwritten without an explicit confirmation prompt.

---

### 5. Vault Hygiene & Orphan Refactoring
Maintain a pristine vault by identifying and cleaning up rogue metadata.

**Example: Refactoring & Fixing Typos**
- The built-in **Orphans** manager scans your vault for frontmatter keys using the `taxo.` root that are either unassigned to a profile or missing a selector definition (e.g. accidental typos like `taxo.book_genree`).
- View the exact notes and values where each orphan appears.
- One-click actions to **register** it as a formal selector, **bulk-rename** it across 50+ notes at once, or **remove** it with a confirmation safety preview.

---

## Installation

### Manual installation

1. Back up your vault.
2. Create `.obsidian/plugins/taxoflow/` in the vault.
3. Download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub release.
4. Put those three files in `.obsidian/plugins/taxoflow/`.
5. In Obsidian, open **Settings → Community plugins**, enable community plugins if needed, and enable **TaxoFlow Properties**.
6. Open the plugin settings and create your first profile and namespace.

The publishable release includes no `data.json`. Obsidian will create and manage the plugin's settings file. The `data.json` in this repository is a clean, uninitialized fixture for tests and fresh-install inspection, not a user configuration to copy over an existing vault.

## First profile

A fresh install intentionally starts with no profiles. Create a profile name and a namespace that starts with `taxo.` and ends with an underscore, such as `taxo.book_` or `taxo.country_`. Namespaces must be unambiguous; overlapping namespaces are rejected.

A property key such as `taxo.book_genre` is matched to its configured profile namespace. The plugin does not contain Books-specific or other domain-specific runtime rules.

## Selector options and dependency rules

A selector can have fixed options or dependency rules. Rules explicitly use AND or OR logic. In an AND rule, each declared condition must match, and every declared dependency must have a value. In an OR rule, at least one declared condition must match. Multiple values within a condition are alternatives.

When several rules match, TaxoFlow chooses the most-specific rule. Equally specific overlapping rules with different option sets are treated as ambiguous. The validator also checks cycles, missing parents, and provably impossible dependency contexts.

Incomplete dependency contexts suppress suggestions and do not register context-specific custom values. When a parent changes, dependent values that are no longer valid are reconciled while unrelated free-entered values are preserved.

## Text and List properties

The plugin respects the property type assigned through Obsidian's Properties type controls. Text stores a single scalar string; List stores an array of values. List additions preserve existing entries and avoid duplicates. Text selections replace the previous scalar value. The type is rechecked when queued writes execute to reduce stale-type and concurrent-write issues.

The visible property editor depends on Obsidian's internal rendering and metadata behavior. The project includes mocked regression tests, but maintainers should test type changes in live Obsidian after relevant updates.

## Labels and defaults

A selector's `label` changes its displayed name only; the internal key and stored value are not changed. Additional labels can be configured for properties without selector definitions. TaxoFlow stores profile-level labels in `propertyLabels`.

A default is selected from the configured options. Applying a default only populates an existing, empty Text or List property when the default is available in that note's dependency context. Non-empty values are preserved. The plugin does not create properties in notes where the property key is absent.

## Default folder routing

Each profile can optionally configure a **Default folder**. When a default folder is defined:
- Any note containing at least one frontmatter property key belonging to the profile namespace is automatically moved to the root of that folder using Obsidian's link-preserving file manager.
- If a destination note with the same name already exists in the target folder, the move is skipped and a notification is displayed to prevent accidental overwrites.
- If a note contains properties from multiple profiles with different default folders:
  - If only one profile defines a default folder, the note moves there.
  - If multiple profiles define different default folders, a popup dialog prompts you to select the desired folder or leave the note in its current location.
- In Settings under Active Profile, the **Move existing notes to folder…** button scans the vault and provides a confirmation preview before moving existing matching notes.

## Orphan Management

Orphans are selector-rooted properties present in note frontmatter that do not belong to exactly one configured selector/profile pairing. The settings distinguish keys with no matching profile from keys in a configured profile namespace that no active selector definition owns.

Orphan management supports viewing the note paths and values where keys occur, registering eligible keys, bulk-renaming a key, removing an individual occurrence, and removing all occurrences after a confirmation preview. Destination collisions are not overwritten. Removing a selector's configuration preserves note data unless the separate destructive action is explicitly confirmed.

## Converting an existing Custom Selectors vault

TaxoFlow has a new plugin ID and a new namespace, so Obsidian will store its settings separately from the original plugin. Existing `selector.` keys do not automatically become `taxo.` keys.

An optional utility is provided at `tools/convert_legacy_vault.py`. It is a separate, opt-in tool and is not run by the plugin. It supports a dry-run-first conversion of frontmatter keys and profile configuration, including `alias` to `label` and `propertyAliases` to `propertyLabels`.

Requirements: Python 3.10 or later and PyYAML, installed with:

```bash
python -m pip install -r requirements.txt
```

First run a dry run, pointing `--config` at the original plugin's `data.json`:

```bash
python tools/convert_legacy_vault.py --vault "/path/to/your/vault" --config "/path/to/your/vault/.obsidian/plugins/custom-selectors/data.json"
```

Review the complete report. The default output configuration path is `.obsidian/plugins/taxoflow/data.json` in the selected vault. The utility identifies notes where the destination key already exists or the YAML cannot be parsed safely and leaves those notes unchanged.

To apply a plan after reviewing it, use:

```bash
python tools/convert_legacy_vault.py --vault "/path/to/your/vault" --config "/path/to/your/vault/.obsidian/plugins/custom-selectors/data.json" --apply
```

The tool requests the exact confirmation phrase `CONVERT`. `--yes` skips that prompt and should only be used after manually reviewing a dry run. The utility creates timestamped backups before writing. The output configuration must be inside the vault. The converter does not rewrite Bases files and does not maintain pending migrations in TaxoFlow's runtime.

Run the conversion on a copy of the vault first. Do not enable TaxoFlow against a converted vault until the report has been checked and any conflicts manually resolved. A skipped conflicting `selector.` property will not be recognized as a `taxo.` selector until you resolve it.

## Development

Requirements:

- Node.js 18 or later.
- Python 3.10 or later for converter tests.
- PyYAML installed from `requirements.txt`.

Run the validation and test suite:

```bash
npm install
npm run check:syntax
npm run check:release
npm test
```

The plugin's production entry point is `main.js`. The source is currently shipped as a single JavaScript bundle; the test suite loads it with mocked Obsidian APIs and tests important configuration and operation helpers. These tests do not replace live Obsidian testing.

## Privacy

TaxoFlow Properties is designed to work locally with your vault. It does not include analytics or hidden telemetry. The standalone conversion utility reads Markdown notes and configuration only under the vault paths that you specify, writes only planned key changes and the output configuration, and creates backups before applying a conversion.

## Support and funding

TaxoFlow Properties is maintained by [AlPhysico](https://github.com/Physico-Academic). If the plugin is useful to you, you can support maintenance and future development through [GitHub Sponsors](https://github.com/sponsors/Physico-Academic). Sponsorship is voluntary and does not unlock plugin functionality.

## Attribution and license

TaxoFlow Properties is a modified and rebranded derivative of the MIT-licensed Custom Selectors Obsidian plugin originally published by @hodie. The original MIT notice is retained in `LICENSE`, alongside a notice for TaxoFlow Properties modifications. Refer to `LICENSE` for the full terms.

## Contributing

Please use GitHub Issues to report reproducible bugs or propose changes. Include your Obsidian version, operating system, minimal reproduction steps, and any relevant console error. Do not attach private vault data or notes containing personal information. Pull requests should include regression tests for behavior changes and preserve the zero-comment requirement in shipped `main.js` and `styles.css`.
