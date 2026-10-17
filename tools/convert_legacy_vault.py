from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from typing import Any

import yaml
from yaml.nodes import MappingNode, ScalarNode

OLD_PREFIX = "selector."
NEW_PREFIX = "taxo."
SCHEMA_VERSION = 4
FRONTMATTER = re.compile(r"\A(---[ \t]*\r?\n)(.*?)(\r?\n---[ \t]*(?:\r?\n|$))", re.DOTALL)
EXCLUDED_DIRS = {".obsidian", ".git", ".trash", ".taxoflow-conversion-backups", "node_modules", ".venv"}


class ConversionError(Exception):
    pass


def remap_property_key(key: str) -> str:
    return NEW_PREFIX + key[len(OLD_PREFIX):] if key.startswith(OLD_PREFIX) else key


def remap_record_keys(record: Any, path: str) -> dict[str, Any]:
    if record is None:
        return {}
    if not isinstance(record, dict):
        raise ConversionError(f"{path} must be an object to convert its property-key references safely.")
    result: dict[str, Any] = {}
    original_keys: set[str] = set()
    for raw_key, value in record.items():
        key = str(raw_key)
        if key in original_keys:
            raise ConversionError(f"Duplicate key {key!r} in {path}.")
        original_keys.add(key)
        new_key = remap_property_key(key)
        if new_key in result:
            raise ConversionError(f"Collision in {path}: both {key!r} and a destination key map to {new_key!r}.")
        result[new_key] = value
    return result


def remap_key_list(value: Any, path: str) -> Any:
    if value is None:
        return []
    if isinstance(value, list):
        return [remap_property_key(str(item)) for item in value]
    if isinstance(value, str):
        return ",".join(remap_property_key(part.strip()) for part in value.split(","))
    raise ConversionError(f"{path} must be a list or comma-separated string.")


def convert_config(source: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(source, dict):
        raise ConversionError("The configuration root must be a JSON object.")
    if not isinstance(source.get("profiles", []), list):
        raise ConversionError("The configuration does not use the supported profile schema. No output was produced.")

    result = json.loads(json.dumps(source))
    changes: list[str] = []
    result.pop("pendingPropertyMigrations", None)
    if "pendingPropertyMigrations" in source:
        changes.append("Removed obsolete pending property migration records from the converted configuration.")

    suppressed = result.get("suppressedAutoRegistrationKeys", [])
    if suppressed is None:
        suppressed = []
    if not isinstance(suppressed, list):
        raise ConversionError("suppressedAutoRegistrationKeys must be a list.")
    result["suppressedAutoRegistrationKeys"] = [remap_property_key(str(key)) for key in suppressed]

    seen_selectors: set[str] = set()
    seen_profile_namespaces: list[tuple[str, str]] = []
    profiles = result.get("profiles", [])
    for profile_index, profile in enumerate(profiles):
        profile_path = f"profiles[{profile_index}]"
        if not isinstance(profile, dict):
            raise ConversionError(f"{profile_path} must be an object.")
        profile.pop("legacyNamespaces", None)
        namespace = profile.get("namespace")
        if not isinstance(namespace, str) or not namespace:
            raise ConversionError(f"{profile_path}.namespace is missing or invalid.")
        if namespace.startswith(OLD_PREFIX):
            profile["namespace"] = remap_property_key(namespace)
            changes.append(f"Changed namespace {namespace} to {profile['namespace']}.")
        elif not namespace.startswith(NEW_PREFIX):
            raise ConversionError(f"{profile_path}.namespace={namespace!r} does not start with {OLD_PREFIX!r} or {NEW_PREFIX!r}; its intended replacement cannot be inferred safely.")

        new_namespace = profile["namespace"]
        for previous_namespace, previous_name in seen_profile_namespaces:
            if new_namespace.startswith(previous_namespace) or previous_namespace.startswith(new_namespace):
                raise ConversionError(f"Profile namespaces overlap: {profile.get('name', profile_index)} and {previous_name}.")
        seen_profile_namespaces.append((new_namespace, str(profile.get("name", profile_index))))

        old_labels = profile.pop("propertyAliases", None)
        new_labels = profile.get("propertyLabels")
        if old_labels is not None:
            old_labels = remap_record_keys(old_labels, f"{profile_path}.propertyAliases")
            if new_labels is None:
                profile["propertyLabels"] = old_labels
            elif not isinstance(new_labels, dict):
                raise ConversionError(f"{profile_path}.propertyLabels must be an object.")
            else:
                combined = dict(new_labels)
                for key, label in old_labels.items():
                    if key in combined and combined[key] != label:
                        raise ConversionError(f"Conflicting labels for {key!r} in {profile_path}; resolve this in the source configuration before converting.")
                    combined.setdefault(key, label)
                profile["propertyLabels"] = combined
            changes.append(f"Converted property aliases to labels in profile {profile.get('name', profile_index)!r}.")
        elif new_labels is not None:
            profile["propertyLabels"] = remap_record_keys(new_labels, f"{profile_path}.propertyLabels")
        else:
            profile["propertyLabels"] = {}

        selectors = profile.get("selectors", [])
        if not isinstance(selectors, list):
            raise ConversionError(f"{profile_path}.selectors must be a list.")
        for selector_index, selector in enumerate(selectors):
            selector_path = f"{profile_path}.selectors[{selector_index}]"
            if not isinstance(selector, dict):
                raise ConversionError(f"{selector_path} must be an object.")
            old_key = selector.get("name")
            if not isinstance(old_key, str) or not old_key:
                raise ConversionError(f"{selector_path}.name is missing or invalid.")
            selector["name"] = remap_property_key(old_key)
            if not selector["name"].startswith(new_namespace):
                raise ConversionError(f"{selector_path}.name={old_key!r} is outside its configured namespace {namespace!r}. Resolve the mismatch before converting.")
            if selector["name"] in seen_selectors:
                raise ConversionError(f"Duplicate selector key after conversion: {selector['name']!r}.")
            seen_selectors.add(selector["name"])

            old_label = selector.pop("alias", None)
            if old_label is not None and "label" in selector and selector["label"] != old_label:
                raise ConversionError(f"Conflicting label and alias values for {old_key!r}; resolve the conflict before converting.")
            if "label" not in selector and isinstance(old_label, str):
                selector["label"] = old_label
            if old_label is not None:
                changes.append(f"Converted display alias to label for {selector['name']}.")

            if "dependsOn" in selector:
                selector["dependsOn"] = remap_key_list(selector["dependsOn"], f"{selector_path}.dependsOn")
            for rule_index, rule in enumerate(selector.get("rules", []) or []):
                if isinstance(rule, dict) and "when" in rule:
                    rule["when"] = remap_record_keys(rule["when"], f"{selector_path}.rules[{rule_index}].when")
            for context_index, entry in enumerate(selector.get("customOptionsByContext", []) or []):
                if isinstance(entry, dict) and "context" in entry:
                    entry["context"] = remap_record_keys(entry["context"], f"{selector_path}.customOptionsByContext[{context_index}].context")

        changes.append(f"Converted selector keys and references in profile {profile.get('name', profile_index)!r}.")

    result["schemaVersion"] = SCHEMA_VERSION
    result.setdefault("activeProfileId", profiles[0].get("id", "") if profiles else "")
    result["activeProfileId"] = result.get("activeProfileId") or (profiles[0].get("id", "") if profiles else "")
    result["suppressedAutoRegistrationKeys"] = list(dict.fromkeys(result["suppressedAutoRegistrationKeys"]))
    return result, changes


def plan_frontmatter_conversion(raw_bytes: bytes) -> tuple[bytes | None, str | None]:
    try:
        decoded = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        return None, f"not valid UTF-8: {exc}"
    bom = "\ufeff" if decoded.startswith("\ufeff") else ""
    text = decoded[len(bom):]
    match = FRONTMATTER.match(text)
    if not match:
        return None, None
    prefix, yaml_text, closing = match.group(1), match.group(2), match.group(3)
    try:
        root = yaml.compose(yaml_text, Loader=yaml.SafeLoader)
    except yaml.YAMLError as exc:
        return None, f"frontmatter YAML could not be parsed safely: {exc}"
    if root is None:
        return None, None
    if not isinstance(root, MappingNode):
        return None, "frontmatter root is not a YAML mapping"

    key_names: list[str] = []
    replacements: list[tuple[int, int, str]] = []
    for key_node, _value_node in root.value:
        if not isinstance(key_node, ScalarNode):
            return None, "frontmatter contains a non-scalar top-level key"
        key = str(key_node.value)
        if key in key_names:
            return None, f"frontmatter contains duplicate top-level key {key!r}"
        key_names.append(key)
        if key.startswith(OLD_PREFIX):
            replacements.append((key_node.start_mark.index, key_node.end_mark.index, json.dumps(remap_property_key(key), ensure_ascii=False)))

    if not replacements:
        return None, None

    destinations = {json.loads(replacement) for _, _, replacement in replacements}
    existing = set(key_names)
    collisions = sorted(destinations.intersection(existing))
    if collisions:
        return None, "destination key already exists: " + ", ".join(collisions)

    updated_yaml = yaml_text
    for start, end, replacement in sorted(replacements, reverse=True):
        updated_yaml = updated_yaml[:start] + replacement + updated_yaml[end:]
    updated_text = prefix + updated_yaml + closing + text[match.end():]
    return (bom + updated_text).encode("utf-8"), None



def describe_frontmatter_changes(raw_bytes: bytes) -> list[tuple[str, str, str]]:
    decoded = raw_bytes.decode("utf-8")
    text = decoded[1:] if decoded.startswith("\ufeff") else decoded
    match = FRONTMATTER.match(text)
    if not match:
        return []
    yaml_text = match.group(2)
    root = yaml.compose(yaml_text, Loader=yaml.SafeLoader)
    if not isinstance(root, MappingNode):
        return []
    changes: list[tuple[str, str, str]] = []
    for key_node, value_node in root.value:
        if isinstance(key_node, ScalarNode) and str(key_node.value).startswith(OLD_PREFIX):
            old_key = str(key_node.value)
            value_text = yaml_text[value_node.start_mark.index:value_node.end_mark.index]
            changes.append((old_key, remap_property_key(old_key), value_text))
    return changes

def iter_markdown_files(vault: Path):
    for directory, dirnames, filenames in os.walk(vault, followlinks=False):
        dirnames[:] = sorted(name for name in dirnames if name not in EXCLUDED_DIRS and not (Path(directory) / name).is_symlink())
        base = Path(directory)
        for filename in sorted(filenames):
            if not filename.lower().endswith(".md"):
                continue
            path = base / filename
            if path.is_symlink() or not path.is_file():
                continue
            try:
                path.resolve().relative_to(vault.resolve())
            except ValueError:
                continue
            yield path


def atomic_write(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def copy_backup(source: Path, backup_path: Path):
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, backup_path)


def resolve_inside_vault(path: Path, vault: Path) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(vault.resolve())
    except ValueError as exc:
        raise ConversionError(f"Path {path} is outside the vault; choose a path inside the vault for this conversion.") from exc
    return resolved


def run_conversion(args: argparse.Namespace) -> int:
    vault = Path(args.vault).expanduser().resolve()
    config_source = Path(args.config).expanduser().resolve()
    if not vault.is_dir():
        raise ConversionError(f"Vault directory does not exist: {vault}")
    if not config_source.is_file():
        raise ConversionError(f"Source data.json does not exist: {config_source}")

    default_output = vault / ".obsidian" / "plugins" / "taxoflow" / "data.json"
    output_config = resolve_inside_vault(Path(args.output_config) if args.output_config else default_output, vault)
    if config_source == output_config:
        raise ConversionError("Source and output configuration paths are identical. Use the old plugin data.json as input and TaxoFlow's data.json as output.")

    try:
        old_config = json.loads(config_source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConversionError(f"Could not read source configuration as valid JSON: {exc}") from exc
    new_config, config_changes = convert_config(old_config)
    output_bytes = (json.dumps(new_config, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    planned: list[tuple[Path, bytes, bytes, list[tuple[str, str, str]]]] = []
    conflicts: list[tuple[str, str]] = []
    unchanged = 0
    for file_path in iter_markdown_files(vault):
        try:
            raw = file_path.read_bytes()
        except OSError as exc:
            conflicts.append((file_path.relative_to(vault).as_posix(), f"could not read file: {exc}"))
            continue
        new_bytes, reason = plan_frontmatter_conversion(raw)
        if reason:
            conflicts.append((file_path.relative_to(vault).as_posix(), reason))
        elif new_bytes is None:
            unchanged += 1
        elif new_bytes != raw:
            planned.append((file_path, raw, new_bytes, describe_frontmatter_changes(raw)))

    print("TaxoFlow one-time property conversion")
    print(f"Vault: {vault}")
    print(f"Source configuration: {config_source}")
    print(f"Output configuration: {output_config}")
    print(f"Markdown files to update: {len(planned)}")
    print(f"Markdown files unchanged or without convertible frontmatter: {unchanged}")
    print(f"Files requiring manual conflict resolution: {len(conflicts)}")
    print("Configuration changes:")
    for item in config_changes:
        print(f"  - {item}")
    for file_path, _old_bytes, _new_bytes, key_changes in planned:
        print(f"  NOTE {file_path.relative_to(vault).as_posix()}")
        for old_key, new_key, value_text in key_changes:
            print(f"    {old_key} -> {new_key}; value={json.dumps(value_text, ensure_ascii=False)}")
    for path, reason in conflicts:
        print(f"  CONFLICT {path}: {reason}")

    if not args.apply:
        print("\nDry run only. No files were changed. Add --apply to write the safe planned changes.")
        return 0
    if not args.yes:
        response = input("Type CONVERT to apply the listed changes: ").strip()
        if response != "CONVERT":
            print("Cancelled. No files were changed.")
            return 0

    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = Path(args.backup_dir).expanduser().resolve() if args.backup_dir else vault / ".taxoflow-conversion-backups" / timestamp
    if backup_root.exists() and any(backup_root.iterdir()):
        raise ConversionError(f"Backup destination is not empty: {backup_root}")
    backup_root.mkdir(parents=True, exist_ok=True)

    backup_notes: list[tuple[Path, Path, bytes]] = []
    for file_path, old_bytes, _new_bytes, _key_changes in planned:
        relative = file_path.relative_to(vault)
        backup_path = backup_root / "notes" / relative
        copy_backup(file_path, backup_path)
        backup_notes.append((file_path, backup_path, old_bytes))
    source_backup = backup_root / "configuration" / "source-data.json"
    copy_backup(config_source, source_backup)
    output_backup: Path | None = None
    output_existed = output_config.exists()
    if output_existed:
        output_backup = backup_root / "configuration" / "previous-taxoflow-data.json"
        copy_backup(output_config, output_backup)

    changed_files: list[Path] = []
    config_written = False
    try:
        for file_path, _old_bytes, new_bytes, _key_changes in planned:
            atomic_write(file_path, new_bytes)
            changed_files.append(file_path)
        atomic_write(output_config, output_bytes)
        config_written = True
    except Exception as exc:
        rollback_errors: list[str] = []
        backup_by_path = {original: old for original, _backup, old in backup_notes}
        for path in reversed(changed_files):
            try:
                atomic_write(path, backup_by_path[path])
            except Exception as rollback_exc:
                rollback_errors.append(f"{path}: {rollback_exc}")
        if config_written:
            try:
                if output_existed and output_backup and output_backup.exists():
                    atomic_write(output_config, output_backup.read_bytes())
                elif output_config.exists():
                    output_config.unlink()
            except Exception as rollback_exc:
                rollback_errors.append(f"{output_config}: {rollback_exc}")
        detail = f"Write failed; rollback was attempted. Backups: {backup_root}. Error: {exc}"
        if rollback_errors:
            detail += " Rollback errors: " + "; ".join(rollback_errors)
        raise ConversionError(detail) from exc

    print(f"\nApplied conversion to {len(changed_files)} note(s). Converted configuration written to {output_config}.")
    print(f"Backups: {backup_root}")
    if conflicts:
        print("Some notes were intentionally left unchanged; resolve those conflicts manually and rerun the dry run.")
    print("Review the converted configuration and note diffs before enabling TaxoFlow Properties.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Safely convert Custom Selectors property keys and settings to TaxoFlow Properties. Dry-run by default.")
    parser.add_argument("--vault", required=True, help="Path to the vault directory.")
    parser.add_argument("--config", required=True, help="Path to the old Custom Selectors data.json.")
    parser.add_argument("--output-config", help="Path for TaxoFlow's converted data.json. Defaults to .obsidian/plugins/taxoflow/data.json inside the vault.")
    parser.add_argument("--apply", action="store_true", help="Apply the planned safe changes. Without this flag, the tool is read-only.")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive confirmation. Requires --apply.")
    parser.add_argument("--backup-dir", help="Custom backup folder. Defaults to .taxoflow-conversion-backups/<timestamp> inside the vault.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.yes and not args.apply:
        parser.error("--yes requires --apply")
    try:
        return run_conversion(args)
    except ConversionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
