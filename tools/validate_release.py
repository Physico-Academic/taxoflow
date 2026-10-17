from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    errors: list[str] = []
    required = ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE", "versions.json"]
    for name in required:
        if not (ROOT / name).is_file():
            errors.append(f"Missing required release file: {name}")

    try:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"manifest.json is not valid JSON: {exc}")
        manifest = {}
    try:
        versions = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"versions.json is not valid JSON: {exc}")
        versions = {}
    try:
        data = json.loads((ROOT / "data.json").read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"data.json is not valid JSON: {exc}")
        data = {}

    if manifest.get("id") != "taxoflow":
        errors.append("manifest id must be taxoflow")
    if manifest.get("name") != "TaxoFlow Properties":
        errors.append("manifest name must be TaxoFlow Properties")
    if manifest.get("version") != "1.0.0":
        errors.append("manifest version must be 1.0.0")
    if not re.fullmatch(r"[a-z-]+", str(manifest.get("id", ""))):
        errors.append("manifest id must contain only lowercase letters and hyphens")
    if "obsidian" in str(manifest.get("id", "")).lower() or str(manifest.get("id", "")).endswith("plugin"):
        errors.append("manifest id violates Obsidian naming restrictions")
    description = str(manifest.get("description", ""))
    if len(description) > 250 or not description.endswith("."):
        errors.append("manifest description must be at most 250 characters and end with a period")
    if versions.get("1.0.0") != manifest.get("minAppVersion"):
        errors.append("versions.json 1.0.0 entry must match manifest minAppVersion")
    if data.get("schemaVersion") != 4 or data.get("profiles") != [] or data.get("activeProfileId") != "":
        errors.append("data.json must be a schema-v4 uninitialized configuration")

    for name in ("main.js", "styles.css"):
        path = ROOT / name
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        if re.search(r"//|/\*|\*/", source):
            errors.append(f"{name} contains a comment marker; shipped runtime files must be comment-free")
        if name == "main.js":
            for forbidden in ("Custom Selectors", "custom-selectors", "propertyAliases", "legacyNamespaces", "pendingPropertyMigrations"):
                if forbidden in source:
                    errors.append(f"main.js still contains an obsolete runtime identifier: {forbidden}")
            if re.search(r"[\"']selector\.", source):
                errors.append("main.js still contains an old selector. root-prefix literal")
            if "TAXOFLOW_PROPERTY_PREFIX = \"taxo.\"" not in source:
                errors.append("main.js does not declare the taxo. root prefix")
            if "class TaxoFlowPlugin" not in source:
                errors.append("main.js does not declare TaxoFlowPlugin")

    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8") if (ROOT / "LICENSE").exists() else ""
    if "Copyright (c) 2024 @hodie" not in license_text or "Copyright (c) 2026 AlPhysico" not in license_text:
        errors.append("LICENSE must retain upstream attribution and identify TaxoFlow Properties modifications")

    if errors:
        print("Release validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Release validation passed.")
    print(f"Plugin: {manifest['name']} ({manifest['id']}) {manifest['version']}")
    print("Verified manifest, versions, clean configuration, licensing, namespace, branding, and comment-free shipped JS/CSS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
