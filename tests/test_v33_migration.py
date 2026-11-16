from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import followup_db


class FollowupMigration(unittest.TestCase):
    def test_v5_data_survives_v6_upgrade(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.db"
            path.touch()
            with followup_db.transaction(path, write=True) as db:
                db.execute(f"PRAGMA application_id = {followup_db.APPLICATION_ID}")
                for sql in followup_db.MIGRATIONS[:5]:
                    followup_db._execute_migration(db, sql)
                followup_db._scope_constraints(db)
                db.execute("PRAGMA user_version = 5")
                db.execute("INSERT INTO users VALUES (?, ?, ?)", ("synthetic", "合成成员", 1))

            followup_db.initialize(path)
            followup_db.initialize(path)
            integrity = followup_db.check_integrity(path)
            self.assertTrue(integrity["ok"], integrity)
            self.assertEqual(integrity["version"], 6)
            with followup_db.connect(path, readonly=True) as db:
                self.assertEqual(db.execute("SELECT * FROM users").fetchone()[0], "synthetic")
                columns = {row["name"] for row in db.execute("PRAGMA table_info(plans)")}
                self.assertTrue({"paused_at", "pause_reason"} <= columns)
                self.assertIsNotNone(db.execute("PRAGMA table_info(household_drafts)").fetchone())

    def test_new_database_is_v6(self):
        with TemporaryDirectory() as directory:
            path = followup_db.initialize(Path(directory) / "new.db")
            state = followup_db.check_integrity(path)
            self.assertTrue(state["ok"], state)
            self.assertEqual(state["version"], 6)
