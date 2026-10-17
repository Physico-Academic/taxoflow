import argparse
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.convert_legacy_vault import ConversionError, convert_config, plan_frontmatter_conversion, run_conversion


class ConversionTests(unittest.TestCase):
    def legacy_config(self):
        return {
            "schemaVersion": 3,
            "activeProfileId": "book",
            "pendingPropertyMigrations": [{"old": "selector.old", "new": "selector.new"}],
            "suppressedAutoRegistrationKeys": ["selector.book_old"],
            "profiles": [{
                "id": "book",
                "name": "Books",
                "namespace": "selector.book_",
                "legacyNamespaces": [{"old": "selector.book_", "new": "selector.book"}],
                "propertyAliases": {"selector.book_topic": "Topic"},
                "selectors": [
                    {"name": "selector.book_mode", "alias": "Mode", "options": ["Fiction", "Non-fiction"]},
                    {
                        "name": "selector.book_genre",
                        "alias": "Genre",
                        "options": [],
                        "dependsOn": ["selector.book_mode"],
                        "rules": [{"when": {"selector.book_mode": ["Fiction"]}, "options": ["Novel"], "logic": "and"}],
                        "customOptionsByContext": [{"context": {"selector.book_mode": ["Fiction"]}, "options": ["Custom"]}],
                    },
                ],
            }],
        }

    def test_config_conversion_updates_namespace_keys_and_labels(self):
        result, changes = convert_config(self.legacy_config())
        profile = result["profiles"][0]
        selectors = {selector["name"]: selector for selector in profile["selectors"]}
        self.assertEqual(result["schemaVersion"], 4)
        self.assertEqual(profile["namespace"], "taxo.book_")
        self.assertNotIn("legacyNamespaces", profile)
        self.assertNotIn("pendingPropertyMigrations", result)
        self.assertEqual(profile["propertyLabels"], {"taxo.book_topic": "Topic"})
        self.assertEqual(selectors["taxo.book_mode"]["label"], "Mode")
        self.assertNotIn("alias", selectors["taxo.book_mode"])
        self.assertEqual(selectors["taxo.book_genre"]["dependsOn"], ["taxo.book_mode"])
        self.assertEqual(selectors["taxo.book_genre"]["rules"][0]["when"], {"taxo.book_mode": ["Fiction"]})
        self.assertEqual(selectors["taxo.book_genre"]["customOptionsByContext"][0]["context"], {"taxo.book_mode": ["Fiction"]})
        self.assertEqual(result["suppressedAutoRegistrationKeys"], ["taxo.book_old"])
        self.assertTrue(changes)

    def test_config_conversion_rejects_alias_label_conflicts(self):
        source = self.legacy_config()
        source["profiles"][0]["selectors"][0]["label"] = "Different"
        with self.assertRaisesRegex(ConversionError, "Conflicting label and alias"):
            convert_config(source)

    def test_config_conversion_rejects_duplicate_keys_after_namespace_change(self):
        source = self.legacy_config()
        source["profiles"][0]["selectors"].append({"name": "taxo.book_mode", "options": ["Other"]})
        with self.assertRaisesRegex(ConversionError, "Duplicate selector key after conversion"):
            convert_config(source)

    def test_frontmatter_conversion_only_rewrites_top_level_keys(self):
        original = (
            "---\r\n"
            "selector.book_mode: Fiction\r\n"
            "title: Example\r\n"
            "tags:\r\n  - reading\r\n"
            "---\r\n"
            "Body text mentions selector.book_genre but is not frontmatter.\r\n"
        ).encode()
        updated, error = plan_frontmatter_conversion(original)
        self.assertIsNone(error)
        text = updated.decode()
        self.assertIn('"taxo.book_mode": Fiction', text)
        self.assertIn('title: Example', text)
        self.assertIn('Body text mentions selector.book_genre', text)
        self.assertIn("\r\n", text)

    def test_frontmatter_collision_is_reported_and_left_unchanged(self):
        original = b"---\nselector.book_mode: Fiction\ntaxo.book_mode: Mystery\n---\nBody\n"
        updated, error = plan_frontmatter_conversion(original)
        self.assertIsNone(updated)
        self.assertIn("destination key already exists", error)

    def test_duplicate_frontmatter_keys_are_reported(self):
        original = b"---\nselector.book_mode: Fiction\nselector.book_mode: Mystery\n---\n"
        updated, error = plan_frontmatter_conversion(original)
        self.assertIsNone(updated)
        self.assertIn("duplicate top-level key", error)

    def test_no_frontmatter_is_unchanged(self):
        original = b"A note without frontmatter: selector.book_mode.\n"
        updated, error = plan_frontmatter_conversion(original)
        self.assertIsNone(updated)
        self.assertIsNone(error)

    def test_dry_run_does_not_write_notes_or_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp) / "vault"
            (vault / ".obsidian/plugins/custom-selectors").mkdir(parents=True)
            (vault / "books").mkdir()
            note = vault / "books" / "one.md"
            original = b"---\nselector.book_mode: Fiction\n---\nText\n"
            note.write_bytes(original)
            config = vault / ".obsidian/plugins/custom-selectors/data.json"
            config.write_text(json.dumps(self.legacy_config()), encoding="utf-8")
            args = argparse.Namespace(vault=str(vault), config=str(config), output_config=None, apply=False, yes=False, backup_dir=None)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = run_conversion(args)
            self.assertEqual(code, 0)
            self.assertEqual(note.read_bytes(), original)
            self.assertFalse((vault / ".obsidian/plugins/taxoflow/data.json").exists())
            self.assertIn("Dry run only", output.getvalue())

    def test_apply_converts_note_and_config_and_creates_backups(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp) / "vault"
            old_config_dir = vault / ".obsidian/plugins/custom-selectors"
            old_config_dir.mkdir(parents=True)
            (vault / "books").mkdir()
            note = vault / "books" / "one.md"
            note.write_text("---\nselector.book_mode: Fiction\n---\nText\n", encoding="utf-8")
            config = old_config_dir / "data.json"
            config.write_text(json.dumps(self.legacy_config()), encoding="utf-8")
            args = argparse.Namespace(vault=str(vault), config=str(config), output_config=None, apply=True, yes=True, backup_dir=None)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = run_conversion(args)
            self.assertEqual(code, 0)
            self.assertIn('"taxo.book_mode": Fiction', note.read_text(encoding="utf-8"))
            new_config = json.loads((vault / ".obsidian/plugins/taxoflow/data.json").read_text(encoding="utf-8"))
            self.assertEqual(new_config["profiles"][0]["namespace"], "taxo.book_")
            self.assertTrue(list((vault / ".taxoflow-conversion-backups").glob("*/notes/books/one.md")))
            self.assertIn("Applied conversion", output.getvalue())

    def test_output_config_cannot_escape_vault(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp) / "vault"
            vault.mkdir()
            config = vault / "data.json"
            config.write_text(json.dumps(self.legacy_config()), encoding="utf-8")
            args = argparse.Namespace(vault=str(vault), config=str(config), output_config=str(Path(tmp) / "outside.json"), apply=False, yes=False, backup_dir=None)
            with self.assertRaisesRegex(ConversionError, "outside the vault"):
                run_conversion(args)


if __name__ == "__main__":
    unittest.main()
