from datetime import date
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import life_analysis
import followup_api
import followup_db
import policy_assessment
import policy_engine as engine
import semantic_discovery
import server
from deepseek_client import DeepSeekError


class ModelFixture:
    def __init__(self):
        self.context = None

    def chat_json(self, messages, **kwargs):
        self.context = json.loads(messages[-1]["content"])
        if "policies" not in self.context:
            return {key: [] for key in (
                "confirmed_facts", "inferred_scenes", "potential_needs", "missing_information",
                "follow_up_questions", "uncertainty_notes",
            )}
        return {"candidates": [
            {"policy_id": row["policy_id"], **row["links"][0], "next_check": "age_min"}
            for row in self.context["policies"][:6]
        ]}


class MatchingP0(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gz = engine.load_database(engine.DATABASES["guangzhou"])
        cls.fs = engine.load_database(engine.DATABASES["foshan"])
        cls.db = {"policies": cls.gz["policies"] + cls.fs["policies"]}
        cls.meal = engine.find_policy(cls.gz, "gz_elderly_003")

    def match(self, **payload):
        with patch.object(server, "DB", self.db):
            return server._match_payload(payload)

    def test_missing_ambiguous_or_wrong_region(self):
        for text, region in (("68岁，做饭困难", None), ("68岁，做饭困难", "  "),
                             ("想了解广州助餐，68岁，做饭困难", None),
                             ("我在广州，母亲在佛山，68岁，做饭困难", None),
                             ("68岁，做饭困难", "深圳市")):
            with self.subTest(text=text, region=region):
                self.assertEqual(self.match(text=text, region=region)["results"], [])
        self.assertTrue(self.match(text="广州，68岁，做饭困难")["results"])
        self.assertTrue(all(row["region"] == "广州市" for row in self.match(text="68岁，做饭困难", region="广州")["results"]))
        self.assertTrue(all(row["region"] == "佛山市" for row in self.match(text="低收入家庭，住院自费3万元", region="佛山")["results"]))

    def test_age_conflict_removes_age_only_results_but_keeps_text(self):
        for text, age in (("68岁，实际58岁", None), ("六十八周岁", 58), ("58 岁", 68)):
            with self.subTest(text=text, age=age):
                data = self.match(text=text, age=age, region="广州市",
                                  profile={"confirmed_scenes": ["年龄增长"]})
                self.assertIsNone(data["profile"]["age"])
                self.assertEqual(data["profile"]["raw_text"], text)
                self.assertEqual(data["profile"]["conflicts"][0]["kind"], "年龄")
                self.assertNotIn("年龄增长", data["profile"]["scenes"])
                self.assertEqual(data["results"], [])
        result = self.match(text="68岁，做饭困难", age=58, region="广州市")
        meal = next(row for row in result["results"] if row["policy_id"] == self.meal["policy_id"])
        self.assertEqual(meal["status"], "待确认")
        self.assertIn("老人是否已年满60周岁", meal["missing_information"])

    def test_structured_form_and_separate_description(self):
        description = "母亲58岁。邻居75岁。"
        data = self.match(text="母亲68岁", age=68, region="广州", life_description=description,
                          profile={"relation": "母亲"})
        self.assertEqual(data["profile"]["life_description"], description)
        self.assertEqual(data["profile"]["conflicts"][0]["said"], ["表单 68 岁", "描述「58岁」"])
        data = self.match(text="母亲68岁", age=68, region="广州", life_description="邻居75岁。",
                          profile={"relation": "母亲"})
        self.assertEqual(data["profile"]["age"], 68)
        self.assertEqual(data["profile"]["conflicts"], [])

    def test_current_date_boundary_and_history_lookup(self):
        today = date(2026, 11, 12)
        profile = engine.build_profile("68岁，做饭困难", region="广州")
        cases = [
            ({"status": "active", "expires_at": "2026-11-11"}, "expired", False),
            ({"status": "active", "expires_at": "2026-11-12"}, "expiring", True),
            ({"status": "active", "effective_from": "2026-11-13"}, "not_yet_effective", False),
            ({"status": "superseded"}, "superseded", False),
            ({"status": "expired"}, "expired", False),
            ({"status": "repealed"}, "repealed", False),
            ({"status": "historical"}, "historical", False),
            ({}, "unknown", True),
        ]
        for validity, status, recommended in cases:
            with self.subTest(validity=validity):
                policy = {**self.meal, "validity": validity}
                db = {"policies": [policy]}
                self.assertEqual(engine.derive_validity(policy, today)["status"], status)
                self.assertEqual(semantic_discovery._validity(policy, today), "active" if status == "expiring" else status)
                self.assertEqual(bool(engine.match_policies(db, profile, today)), recommended)
                self.assertIs(engine.find_policy(db, policy["policy_id"]), policy)

    def test_semantic_uses_shared_age_and_validity(self):
        active = {**self.meal, "validity": {"status": "active", "effective_from": "2020-01-01"}}
        old = {**self.meal, "policy_id": "synthetic-old", "validity": {"status": "superseded"}}
        wrong = {**self.meal, "policy_id": "synthetic-wrong", "region": {"scope": "佛山市"}}
        model = ModelFixture()
        with patch.object(semantic_discovery, "_catalog", return_value=[active, old, wrong]), \
             patch.object(semantic_discovery.DeepSeekClient, "from_env", return_value=model):
            data = semantic_discovery.discover({"description": "母亲58岁，做饭困难", "age": 68, "region": "广州市"})
        self.assertEqual([row["policy_id"] for row in model.context["policies"]], [active["policy_id"]])
        self.assertIn("age_min", model.context["policies"][0]["unconfirmed"])
        self.assertEqual(data["conflicts"][0]["kind"], "年龄")
        self.assertEqual(data["semantic_candidates"][0]["policy_id"], active["policy_id"])

    def test_combined_analysis_and_ai_timeout(self):
        conflict = {"query": {"text": "母亲68岁，做饭困难", "age": 68, "region": "广州", "relation": "母亲"},
                    "description": "母亲58岁，做饭困难"}
        with patch.object(server, "DB", self.db), \
             patch.object(semantic_discovery, "discover", side_effect=DeepSeekError("TIMEOUT", "fixture")) as discover, \
             patch.object(policy_assessment, "_explain", side_effect=DeepSeekError("TIMEOUT", "fixture")):
            data = server._assess(conflict)
        self.assertIsNone(discover.call_args.args[0]["age"])
        self.assertEqual(discover.call_args.args[0]["region"], "广州市")
        self.assertIsNone(data["profile"]["age"])
        self.assertEqual({row["policy_id"] for row in data["channels"]["rule"]["results"]},
                         {row["policy_id"] for row in data["entries"]})
        self.assertEqual([error["code"] for error in data["errors"]], ["TIMEOUT", "TIMEOUT"])
        with patch.object(semantic_discovery, "discover") as discover:
            data = policy_assessment.assess({"query": {"text": "68岁，做饭困难"}}, server._match_payload, self.db)
        discover.assert_not_called()
        self.assertEqual(data["entries"], [])
        self.assertEqual(data["channels"]["semantic"]["status"], "region_unconfirmed")

    def test_life_analysis_masks_conflicted_age(self):
        model = ModelFixture()
        description = "58岁，做饭困难"
        with patch.object(life_analysis.DeepSeekClient, "from_env", return_value=model):
            life_analysis.analyze({"description": description, "age": 68, "city": "广州市"}, self.db)
        self.assertIsNone(model.context["表单年龄"])
        self.assertTrue(model.context["年龄待核对"])
        self.assertEqual(model.context["原文"], description)

    def test_json_catalogues_byte_identical(self):
        for folder in ("data", "frontend/discovery-c"):
            for file in (ROOT / folder).glob("*.json"):
                self.assertEqual(file.read_bytes(), (ROOT.parent / "home-ui-review" / folder / file.name).read_bytes(), file.name)
        self.assertEqual((len(self.gz["policies"]), len(self.fs["policies"])), (10, 6))
        self.assertEqual(len({row["policy_id"] for row in self.db["policies"]}), 16)
        original = ROOT.parent / "home-ui-review/data/private-migration/v3-manual-e8e8b6ff77d9/acceptance.db"
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(),
                         "4524d3acfcc81c39d8abf80f166a0a887cd798002d4395b5cb2ff66116a80c3e")

    def test_sqlite_history_keeps_saved_policy_after_expiry_and_rejects_conflict(self):
        with TemporaryDirectory(dir=ROOT / "data") as directory, patch.dict(
                "os.environ", {"PF_FOLLOWUP_DB": str(Path(directory) / "fixture.db")}):
            followup_db.initialize()
            followup_db.initialize_preview()
            operation = lambda: str(uuid4())
            member = followup_api.dispatch("POST", "/api/followup/members", {
                "operationId": operation(), "name": "合成历史样例", "relation": "母亲",
            })["member"]["id"]
            region = "广州市"
            raw = "母亲68岁，做饭困难"
            structured = {"age": 68, "operator": "女儿", "beneficiary": "母亲",
                          "answers": {}, "scenes": ["行动不便"]}
            form = {"text": raw, "uiForm": {**structured, "mode": "family", "city": region,
                                           "ai": {"description": "母亲68岁，做饭困难"}}}
            body = {"operationId": operation(), "queryId": operation(), "memberId": member,
                    "mode": "family", "region": region, "profile": structured, "form": form}
            path = "/api/followup/queries"
            history = "/api/followup/query-history/" + body["queryId"]
            policy = {**self.meal, "validity": {"status": "active", "expires_at": "2026-11-11"}}
            db = {"policies": [policy]}
            scorer = engine.match_policies
            with patch.object(server, "DB", db):
                with patch.object(engine, "match_policies", side_effect=lambda db, profile: scorer(db, profile, date(2026, 11, 10))):
                    followup_api.dispatch("POST", path, body, match=server._query_match)
                with patch.object(engine, "match_policies", side_effect=lambda db, profile: scorer(db, profile, date(2026, 11, 12))):
                    self.assertEqual(server._match_payload({"text": raw, "region": region})["results"], [])
                saved = followup_api.dispatch("GET", history, {"memberId": member})
                self.assertEqual(saved["result"]["results"][0]["policy_id"], policy["policy_id"])
                self.assertEqual(saved["result"]["profile"]["confirmed_scenes"], ["行动不便"])
                self.assertIn("吃饭困难", saved["result"]["profile"]["scenes"])
                self.assertEqual(saved["form"]["text"], raw)
                conflict_id = operation()
                form["uiForm"]["ai"]["description"] = "母亲58岁。"
                with self.assertRaises(followup_api.FollowupError) as rejected:
                    followup_api.dispatch("POST", path, {**body, "queryId": conflict_id, "operationId": operation()},
                                          match=server._query_match)
                self.assertEqual(rejected.exception.code, "age_conflict")
                with followup_db.connect(readonly=True) as connection:
                    self.assertFalse(connection.execute("SELECT id FROM queries WHERE id=?", (conflict_id,)).fetchone())
