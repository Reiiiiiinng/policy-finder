import copy
import json
import os
from pathlib import Path
import sys
import tempfile
from threading import Event, Thread
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import followup_api as follow
import followup_db as database
import household_analysis as v32
from deepseek_client import DeepSeekError
from followup_identity import LOCAL, scope


class Model:
    """Deliberately deterministic responses, restricted to test process."""
    def __init__(self, ids=()):
        self.ids = ids
        self.calls = []

    def chat_json(self, messages, **options):
        data = json.loads(messages[-1]["content"])
        self.calls.append(data)
        if "question" in data:
            return {"answer": "需要核对参保及当地要求。", "source_ids": list(self.ids),
                    "new_fact_indices": [0]}
        if "catalogue" in data:
            return {"recommendations": [{"id": row["id"], "reason": "合成研判依据"}
                                        for row in data["catalogue"] if row["id"] in self.ids]}
        if "extracted_facts" in data:
            return {"inferred_needs": ["需要照护"], "potential_policy_categories": ["医疗保障"]}
        return {"extracted_facts": [data["original"]["description"]],
                "analysis_summary": "合成摘要", "confidence_or_uncertainty": "需核实"}


class V32(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"PF_FOLLOWUP_DB": str(Path(directory) / "acceptance.db")}))
        database.initialize()
        self.enterContext(scope(LOCAL))
        with database.transaction(write=True) as db:
            self.member = self.add_member(db, "合成甲")
            self.other = self.add_member(db, "合成乙")
        v32.initialize()

    @staticmethod
    def add_member(db, name):
        now = follow._now()
        db.execute("INSERT OR IGNORE INTO users(id, created_at) VALUES (?,?)", (LOCAL[0], now))
        db.execute("""INSERT OR IGNORE INTO members(id,user_id,name,relationship,created_at,updated_at)
                      VALUES (?,?,?,'本人',?,?)""", (LOCAL[1], LOCAL[0], "本人", now, now))
        return follow._make_member(db, {"name": name, "relation": "母亲"}, now)["member"]["id"]

    def post(self, action, **data):
        return v32.dispatch("POST", "/api/followup/v32/" + action, data)

    def get(self, action, **data):
        return v32.dispatch("GET", "/api/followup/v32/" + action, data)

    def create(self, description="母亲68岁，住院自费3万元，家庭经济困难。", age=68, region="佛山市"):
        return self.post("create", id=str(uuid4()), memberId=self.member, description=description,
                         age=age, region=region, supplement="需要了解可以申请的支持。")

    def act(self, action, state, **fields):
        return self.post(action, id=state["id"], memberId=state["memberId"], revision=state["revision"], **fields)

    def run_ai(self, model, description, city, age=68):
        with patch.object(v32, "client_factory", return_value=model):
            state = self.act("analyze", self.create(description, age, city))
            self.assertEqual(state["stage"], "result")
            return state

    def test_t01_foshan_older_adult_no_local_aged_care_in_catalogue(self):
        state = self.run_ai(Model(["gz_elderly_003"]), "母亲68岁，行动不便，需要养老服务。", "佛山市")
        self.assertEqual(state["result"]["policy_candidates"], [])

    def test_v34_foshan_actionability_scenarios(self):
        scenarios = (
            ("养老", "fs_care_001", "母亲68岁，住在佛山市，需要长期照护和上门助浴。", 68, "consult", "official_required"),
            ("医疗", "fs_med_001", "母亲68岁，参加了佛山市基本医疗保险，住院自费较多。", 68, "fact", "context_recorded"),
            ("临时", "fs_med_005", "母亲68岁，火灾后生活困难，想咨询临时救助。", 68, "consult", "official_required"),
            ("信息不足", "fs_med_001", "母亲住院自费较多，不清楚当地参保情况。", None, "fact", "unknown"),
            ("渠道缺口", "fs_med_001", "母亲68岁，住院自费较多。", 68, "fact", "unknown"),
        )
        for name, policy_id, description, age, action, condition in scenarios:
            with self.subTest(name=name):
                requested = [policy_id]
                if name in ("养老", "信息不足"):
                    requested.extend(("fs_med_004", "fs_med_005"))
                state = self.run_ai(Model(requested), description, "佛山市", age)
                result = state["result"]
                self.assertEqual(result["confirmed"]["basic"]["age"], age)
                self.assertIn(description, result["confirmed"]["facts"])
                self.assertNotIn(description, result["public_search_query"])
                candidate, = result["policy_candidates"]
                self.assertEqual(candidate["id"], policy_id)
                self.assertTrue(candidate["benefit"] and candidate["reason"] and candidate["source"]["official_url"])
                self.assertTrue(candidate["canPlan"])
                self.assertEqual(candidate["next_step"]["kind"], action)
                self.assertIn(condition, {row["action_status"] for row in candidate["conditions"]})
                self.assertTrue(candidate["channels"])
                self.assertTrue(all(row["source_url"] for row in candidate["channels"]))
                if name == "渠道缺口":
                    self.assertTrue(all(not row.get("phone") and not row.get("address") for row in candidate["channels"]))
                keys = {"memberId": self.member, "region": "佛山市", "policyId": policy_id}
                favorite = follow.dispatch("GET", "/api/followup/favorites", keys)["favorite"]
                follow.dispatch("POST", "/api/followup/commands", {
                    **keys, "operationId": str(uuid4()), "type": "favorite", "saved": True,
                    "expectedRevision": favorite["revision"],
                })
                review_keys = {"id": state["id"], "memberId": self.member}
                review = self.get("selected-review", **review_keys)
                params = {"selection": review["selection"], "version": review["version"]}
                self.post("selected-review", **review_keys, **params, answers={})
                plan_id = self.act("plan", self.get("state", **review_keys), reviewed=True, **params)["planId"]
                saved = follow.dispatch("GET", "/api/followup/plans/" + plan_id, {"memberId": self.member})
                self.assertIn(policy_id, {task["policyId"] for task in saved["plans"][plan_id]["tasks"]})
                self.assertEqual(saved["policyEvidence"][0]["channels"], candidate["channels"])

    def test_v34_clear_conflict_and_formal_report_provenance(self):
        description = "母亲68岁，住院自费较多。她未参加佛山市基本医疗保险。"
        state = self.run_ai(Model(["fs_med_001", "fs_med_003"]), description, "佛山市")
        self.assertEqual([row["id"] for row in state["result"]["policy_candidates"]], ["fs_med_001"])
        self.assertTrue(any("大病保险" in row["name"] for row in state["result"]["excluded"]))
        rule = {"key": "family_economic", "state": "met", "label": "困难家庭认定"}
        self.assertEqual(v32.condition_status(rule, "fs_med_001", True, {}), "official_required")
        self.assertEqual(v32.condition_status(rule, "fs_med_001", True, {"family_economic": "区民政部门"}), "met")
        self.assertEqual(v32.condition_status(rule, "fs_med_001", False, {}), "policy_unverified")

    def test_t02_guangzhou_medical_needs_use_local_evidence(self):
        state = self.run_ai(Model(["gz_elderly_007"]), "母亲68岁，住院医疗开销大。", "广州市")
        items = state["result"]["policy_candidates"]
        self.assertEqual([item["id"] for item in items], ["gz_elderly_007"])
        self.assertEqual(items[0]["status"], "仅供进一步了解")

    def test_t03_low_income_is_not_an_official_category(self):
        state = self.run_ai(Model(["fs_med_001"]), "母亲68岁，收入很低且持续就医。", "佛山市")
        self.assertIsNone(state["result"]["confirmed"]["basic"].get("family_economic"))
        self.assertIn("family_economic", {item["key"] for item in state["result"]["missing_information"]})

    def test_t04_no_assessment_remains_unknown(self):
        state = self.run_ai(Model(["gz_elderly_009"]), "母亲68岁，需要长期照护，尚未进行失能评估。", "广州市")
        self.assertIsNone(state["result"]["confirmed"]["basic"].get("disability"))
        self.assertIn("disability", {item["key"] for item in state["result"]["missing_information"]})

    def test_verification_separates_facts_rules_and_unknown_enum(self):
        with patch.object(v32, "client_factory", return_value=Model(["fs_med_001", "fs_med_002"])):
            state = self.act("analyze", self.create())
            state = self.act("revise", state, age=68, region="佛山市",
                             facts=state["intake"]["extracted_facts"], needs=[],
                             answers={"insurance": True, "family_economic": None})
        medical = next(item for item in state["result"]["policy_candidates"] if item["id"] == "fs_med_001")
        conditions = {row["key"]: row for row in medical["conditions"] if "key" in row}
        self.assertEqual(conditions["insurance"]["verification"], "rule_verified")
        self.assertTrue(conditions["insurance"]["user_provided"])
        self.assertEqual(conditions["family_economic"]["verification"], "not_provided")
        self.assertEqual(conditions["expense_scope"]["verification"], "not_provided")
        self.assertNotIn("official_confirmed", {row["verification"] for row in medical["conditions"]})
        medical_policy = medical["policy"]
        for value in ("unknown", "not_in_this_catalogue"):
            profile = v32.profile_for({"age":68, "region":"佛山市", "family_economic":value}, [], [])
            self.assertEqual(v32.engine._check_qualify(medical_policy, profile)[2][1]["state"], "unknown")
        profile["family_economic"] = "none"
        self.assertTrue(v32.engine._hard_condition_check(medical_policy, profile)[0])

    def test_t05_disability_directory_gap(self):
        state = self.run_ai(Model(), "母亲68岁，需要残疾相关保障。", "佛山市")
        self.assertEqual(state["result"]["policy_candidates"], [])

    def test_t06_unknown_region_no_municipal_candidates(self):
        state = self.run_ai(Model(["fs_med_001"]), "母亲68岁，想了解佛山医疗救助。", None)
        self.assertIsNone(state["result"]["confirmed"]["basic"]["region"])
        self.assertEqual(state["result"]["policy_candidates"], [])

    def test_t07_real_age_conflict_and_equal_age(self):
        state = self.create("母亲58岁，邻居75岁。", 68)
        self.assertEqual(state["suggested_basic"]["conflicting_information"][0]["said"],
                         ["表单 68 岁", "描述「58岁」"])
        with self.assertRaises(follow.FollowupError):
            self.act("fallback", state, age=68, region="佛山市")
        result = self.act("fallback", state, age=58, region="佛山市", resolveAge=True)
        self.assertEqual(result["result"]["confirmed"]["basic"]["age"], 58)
        self.assertEqual(result["original_description"]["description"], "母亲58岁，邻居75岁。")
        self.assertFalse(self.create("母亲68岁，邻居75岁。")["suggested_basic"]["conflicting_information"])

    def test_t08_no_candidates_without_relevant_context(self):
        state = self.act("fallback", self.create("在家制作模型飞机。"), age=68, region="佛山市")
        self.assertEqual(state["result"]["policy_candidates"], [])

    def test_normal_and_conflicting_paths(self):
        with patch.object(v32, "client_factory", return_value=Model(["fs_med_001", "gz_elderly_009"])):
            normal = self.act("analyze", self.create("母亲68岁，住在佛山市，住院自费3万元。"))
            self.assertEqual(normal["stage"], "result")
            for description, key, resolution, city in (
                ("母亲65岁，住在佛山市，住院自费3万元。", "age", {"age":65}, "佛山市"),
                ("母亲68岁，住在广州市，行动不便。", "region", {"region":"广州市"}, "广州市"),
            ):
                state = self.act("analyze", self.create(description))
                self.assertEqual(state["stage"], "conflict")
                self.assertEqual([item["key"] for item in state["suggested_basic"]["conflicting_information"]], [key])
                result = self.act("resolve", state, **resolution)
                self.assertEqual(result["stage"], "result")
                self.assertEqual(result["result"]["confirmed"]["basic"]["region"], city)
                self.assertEqual(result["original_description"]["description"], description)
                self.assertEqual(result["result"]["confirmed"]["provenance"]["basic"][key], "user_corrected")
            inferred = self.act("analyze", self.create("母亲住在广州，需要人照护。", None, "广州市"))
            self.assertEqual(inferred["stage"], "result")
            self.assertIsNone(inferred["result"]["confirmed"]["basic"].get("disability"))
            self.assertFalse(inferred["suggested_basic"]["conflicting_information"])
            other_person = self.act("analyze", self.create("爸爸今年65岁，住在广州。"))
            self.assertEqual([item["key"] for item in other_person["suggested_basic"]["conflicting_information"]], ["member"])
            past = self.act("analyze", self.create("母亲68岁，以前住在广州，现在住在佛山。"))
            self.assertEqual(past["stage"], "result")

    def test_selected_review_is_scoped_idempotent_and_accepts_unknown(self):
        state = self.run_ai(Model(["fs_med_001","fs_med_002"]), "母亲68岁，住院自费3万元。", "佛山市")
        keys = {"id":state["id"], "memberId":self.member}
        with self.assertRaises(follow.FollowupError):
            self.get("selected-review", **keys)
        with self.assertRaises(follow.FollowupError):
            self.post("selected-review", **keys, selection={}, version=1, answers={})
        def favorite(saved, revision):
            fields = {"operationId":str(uuid4()), "type":"favorite", "memberId":self.member, "region":"佛山市",
                      "policyId":"fs_med_001", "saved":saved, "expectedRevision":revision}
            first = follow.dispatch("POST", "/api/followup/commands", fields)
            self.assertEqual(first, follow.dispatch("POST", "/api/followup/commands", fields))
            return first["favorite"]["revision"]
        revision = favorite(True,0)
        review = self.get("selected-review", **keys)
        self.assertEqual(review["ids"], ["fs_med_001"])
        self.assertEqual({item["key"] for item in review["questions"]}, {"insurance","family_economic","expense_scope"})
        with self.assertRaises(follow.FollowupError):
            self.get("selected-review", id=state["id"], memberId=self.other)
        data = dict(keys, selection=review["selection"], version=review["version"], answers={"insurance":None})
        receipt = self.post("selected-review", **data)["receipt"]
        self.assertEqual(self.post("selected-review", **data)["receipt"], receipt)
        self.assertEqual(self.get("selected-review", **keys)["receipt"], receipt)
        self.assertEqual(receipt["items"][0]["status"], "待核实")
        guide = self.get("selected-review", **keys)["guide"][0]
        self.assertEqual(guide["steps"], v32._project(state["result"]["policy_candidates"][0]["policy"])["steps"])
        self.assertTrue(guide["source"]["url"])
        edited = self.post("selected-review", **{**data, "answers":{"insurance":False}})
        self.assertEqual(edited["receipt"]["excluded"], {})
        self.assertEqual(edited["receipt"]["answers"], {"insurance": False})
        self.assertFalse(edited["guide"][0]["excluded"])
        edited = self.post("selected-review", **{**data, "answers":{"expense_scope":False}})
        self.assertTrue(edited["guide"][0]["excluded"])
        self.assertEqual(self.get("state", **keys)["result"], state["result"])
        with database.transaction() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM plans").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM favorites").fetchone()[0], 1)
        favorite(False,revision)
        with self.assertRaises(follow.FollowupError):
            self.post("selected-review", **data)

    def test_age_sources_drive_rules_ai_and_chat_and_survive_timeout(self):
        source = "母亲65岁，住在广州市，行动不便。"
        for age, origin in ((68,"form"), (65,"description"), (55,"custom")):
            with self.subTest(age=age):
                model = Model(["gz_elderly_003","gz_elderly_009"])
                with patch.object(v32, "client_factory", return_value=model):
                    conflict = self.act("analyze", self.create(source, 68, "广州市"))
                    self.assertEqual(conflict["stage"], "conflict")
                    for invalid in (-1, 4.5, None, "abc", 121):
                        with self.assertRaises(follow.FollowupError):
                            self.act("resolve", conflict, age=invalid, ageSource="custom")
                    state = self.act("resolve", conflict, age=age, ageSource=origin)
                    self.assertEqual(state["result"]["confirmed"]["basic"]["age"], age)
                    self.assertEqual(state["basic"]["age"], 68)
                    self.assertEqual(state["original_description"]["description"], source)
                    self.assertEqual(model.calls[-1]["confirmed"]["age"], age)
                    self.assertNotIn("65岁", "".join(model.calls[-1]["facts"]))
                    self.assertEqual(any(item["id"]=="gz_elderly_003" for item in state["result"]["policy_candidates"]), age >= 60)
                    self.act("chat", state, question="当前年龄是多少？")
                    self.assertEqual(model.calls[-1]["confirmed"]["basic"]["age"], age)
                    state = self.get("state", id=state["id"], memberId=self.member)
                    self.assertEqual(self.act("analyze", state)["stage"], "result")
        conflict = self.act("analyze", self.create(source, 68, "广州市"))
        with patch.object(v32,"client_factory",side_effect=DeepSeekError("TIMEOUT","fixture")):
            state = self.act("resolve", conflict, age=55, ageSource="custom")
        self.assertEqual(state["stage"], "unavailable")
        self.assertEqual(state["conflict_resolution"]["age"], 55)
        result = self.act("fallback", state, age=55, region="广州市")
        self.assertEqual(result["result"]["confirmed"]["basic"]["age"], 55)
        self.assertEqual(self.get("history", memberId=self.other)["history"], [])

    def test_t09_timeout_then_rules(self):
        state = self.create("妈妈68岁，住在佛山。家里收入偏低，她最近一直住院，医疗开销压力很大，住院自费3万元。")
        with patch.object(v32, "client_factory", side_effect=DeepSeekError("TIMEOUT", "test")):
            failure = self.act("analyze", state)
        self.assertEqual(failure["error"], "TIMEOUT")
        self.assertNotIn("intake", failure)
        fallback = self.act("fallback", failure, age=68, region="佛山市")
        self.assertEqual(fallback["result"]["mode"], "rules")
        self.assertIn("fs_med_001", {item["id"] for item in fallback["result"]["policy_candidates"]})
        self.assertEqual(fallback["original_description"], state["original_description"])

    def test_t10_malformed_model_output_is_rejected(self):
        with patch.object(Model, "chat_json", return_value={"oops": True}):
            with patch.object(v32, "client_factory", return_value=Model()):
                state = self.act("analyze", self.create())
        self.assertEqual(state["error"], "INVALID_SCHEMA")
        self.assertNotIn("result", state)

    def test_t11_catalogue_failure_preserves_confirmed_data(self):
        with patch.object(v32, "catalogue", side_effect=OSError):
            state = self.act("fallback", self.create(), age=68, region="佛山市")
        self.assertEqual(state["error"], "CATALOGUE_ERROR")
        self.assertEqual(state["pending_confirmation"]["basic"], {"age":68, "region":"佛山市"})

    def test_t12_rule_failure_is_explicit(self):
        with patch.object(v32.engine, "_hard_condition_check", side_effect=RuntimeError):
            state = self.act("fallback", self.create(), age=68, region="佛山市")
        self.assertEqual(state["error"], "ASSESSMENT_ERROR")
        self.assertNotIn("result", state)

    def test_t13_active_analysis_visible_after_reload_and_duplicate_conflict(self):
        start, release = Event(), Event()
        state = self.create()
        response = []
        def deferred():
            start.set()
            if not release.wait(5):
                raise RuntimeError("test synchronization timed out")
            return Model()
        def run():
            with scope(LOCAL):
                response.append(self.act("analyze", state))
        worker = Thread(target=run)
        with patch.object(v32, "client_factory", side_effect=deferred):
            worker.start()
            try:
                self.assertTrue(start.wait(5))
                active = self.get("state", id=state["id"], memberId=self.member)
                self.assertEqual(active["stage"], "understand")
                with self.assertRaises(follow.FollowupError) as error:
                    self.act("analyze", active)
                self.assertEqual(error.exception.status, 409)
            finally:
                release.set()
                worker.join(10)
        self.assertEqual(response[0]["stage"], "result")

    def test_t14_repeat_create_is_idempotent(self):
        state = self.create()
        repeat = self.post("create", id=state["id"], memberId=self.member, **state["basic"],
                           **state["original_description"])
        self.assertEqual(repeat, state)
        self.assertEqual(len(self.get("history", memberId=self.member)["history"]), 1)

    def test_t15_switch_member_is_scoped(self):
        state = self.create()
        with self.assertRaises(follow.FollowupError) as error:
            self.get("state", id=state["id"], memberId=self.other)
        self.assertEqual(error.exception.status, 404)
        self.assertEqual(self.get("history", memberId=self.other)["history"], [])

    def test_t16_chat_proposal_and_confirmed_version(self):
        model = Model(["fs_med_001"])
        state = self.run_ai(model, "母亲68岁，住院自费3万元。", "佛山市")
        with patch.object(v32, "client_factory", return_value=model):
            question = "母亲每天需要家人帮她洗澡。"
            chatted = self.act("chat", state, question=question)
            self.assertEqual(chatted["result"], state["result"])
            self.assertEqual(chatted["pending"], [question])
            self.assertEqual(model.calls[-1]["confirmed"]["basic"], state["result"]["confirmed"]["basic"])
            applied = self.act("apply", chatted, age=68, region="佛山市")
        self.assertEqual(applied["result"]["version"], 2)
        self.assertIn(question, applied["result"]["confirmed"]["facts"])
        versions = self.get("versions", id=state["id"], memberId=self.member)["versions"]
        self.assertNotIn(question, versions[0]["confirmed"]["facts"])
        with patch.object(v32, "client_factory", return_value=model):
            contact = self.act("chat", applied, question="联系电话是多少？")
        self.assertIn("没有足够的官方依据", contact["messages"][-1]["answer"])
        self.assertNotIn("需要核对参保及当地要求", contact["messages"][-1]["answer"])

    def check_excluded_status(self, status):
        policy, version = copy.deepcopy(v32.catalogue("佛山市")[0])
        policy["validity"] = {"status": status}
        with patch.object(v32, "catalogue", return_value=[(policy, version)]):
            state = self.run_ai(Model([policy["policy_id"]]), "母亲68岁，住院自费3万元。", "佛山市")
        self.assertEqual(state["result"]["policy_candidates"], [])

    def test_t17_expired_policy_excluded(self):
        self.check_excluded_status("expired")

    def test_t18_superseded_policy_excluded(self):
        self.check_excluded_status("superseded")

    def test_t19_history_loads_confirmed_version_and_original(self):
        state = self.run_ai(Model(["fs_med_001"]), "母亲68岁，住院自费3万元。", "佛山市")
        self.assertTrue(self.get("history", memberId=self.member)["history"][0]["hasResult"])
        v32.initialize()
        saved = self.get("versions", id=state["id"], memberId=self.member)["versions"][0]
        self.assertEqual(saved["policy_candidates"], state["result"]["policy_candidates"])
        self.assertEqual(saved["original_description"], state["original_description"])

    def test_reviewed_plan_preserves_answers_and_rejects_stale_selection(self):
        state = self.run_ai(Model(["fs_med_001"]), "母亲68岁，住在佛山市，住院自费较多。", "佛山市")
        keys = {"id": state["id"], "memberId": self.member}
        follow.dispatch("POST", "/api/followup/commands", {
            "operationId": str(uuid4()), "type": "favorite", "memberId": self.member,
            "region": "佛山市", "policyId": "fs_med_001", "saved": True, "expectedRevision": 0,
        })
        review = self.get("selected-review", **keys)
        review_params = {"selection": review["selection"], "version": review["version"]}
        self.post("selected-review", **keys, **review_params, answers={"insurance": True})
        current = self.get("state", **keys)
        with self.assertRaises(follow.FollowupError):
            self.act("plan", current, reviewed=True, selection={}, version=review["version"])
        with database.transaction() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM plans").fetchone()[0], 0)
        first = self.act("plan", current, reviewed=True, **review_params)
        current = self.get("state", **keys)
        self.assertEqual(first, self.act("plan", current, reviewed=True, **review_params))
        self.assertEqual(current["result"], state["result"])
        plan = follow.dispatch("GET", "/api/followup/plans/" + first["planId"],
                               {"memberId": self.member})["plans"][first["planId"]]
        self.assertTrue(any(check["state"] == "confirmed" and check["answer"] == "met"
                            and check["id"] == "qualify:0"
                            for check in plan["tasks"][0]["conditionChecks"]))

    def test_provided_city_facts_are_not_asked_again(self):
        state = self.run_ai(Model(["fs_med_001"]), "母亲68岁，参加了佛山市基本医疗保险，住院自费较多。", "佛山市")
        self.assertIs(state["result"]["confirmed"]["basic"]["insurance"], True)
        self.assertNotIn("insurance", {item["key"] for item in state["result"]["missing_information"]})
        unknown = self.run_ai(Model(["fs_med_001"]), "母亲68岁，不清楚是否参加佛山市基本医疗保险，住院自费较多。", "佛山市")
        self.assertIn("insurance", {item["key"] for item in unknown["result"]["missing_information"]})

    def test_condition_records_keep_official_reports_and_observations_out_of_rule_results(self):
        state = self.run_ai(Model(["gz_elderly_009"]), "母亲68岁，需要居家护理及长期护理保险。", "广州市")
        keys = {"id": state["id"], "memberId": self.member}
        policy_id = "gz_elderly_009"
        follow.dispatch("POST", "/api/followup/commands", {
            "operationId": str(uuid4()), "type": "favorite", "memberId": self.member,
            "region": "广州市", "policyId": policy_id, "saved": True, "expectedRevision": 0,
        })
        review = self.get("selected-review", **keys)
        review_params = {"selection": review["selection"], "version": review["version"]}
        completed = self.post("selected-review", **keys, **review_params, answers={"insurance": True})
        self.assertEqual(completed["receipt"]["answers"], {"insurance": True})
        plan_id = self.act("plan", self.get("state", **keys), reviewed=True, **review_params)["planId"]
        path = "/api/followup/plans/" + plan_id

        def task():
            return follow.dispatch("GET", path, {"memberId": self.member})["plans"][plan_id]["tasks"][0]

        def save(condition_id, answer="unknown", **fields):
            return follow.dispatch("POST", "/api/followup/commands", {
                "operationId": str(uuid4()), "type": "condition", "memberId": self.member,
                "planId": plan_id, "taskId": task()["id"], "policyId": policy_id,
                "conditionId": condition_id, "answer": answer, "expectedRevision": task()["revision"], **fields,
            })

        checks = {row["id"]: row for row in task()["conditionChecks"]}
        self.assertFalse(checks["insurance_required"]["canRecord"])
        self.assertEqual(checks["missing_information:0"]["relatedCondition"], "insurance_required")
        with self.assertRaises(follow.FollowupError):
            save("other:2", "met")
        with self.assertRaises(follow.FollowupError):
            save("missing_information:1", "met")
        save("other:2", reportStatus="received", reportedResult="合成等级", reportedSource="合成机构")
        save("missing_information:1", reportStatus="six_months")
        checks = {row["id"]: row for row in task()["conditionChecks"]}
        for key in ("other:2", "missing_information:1"):
            self.assertEqual((checks[key]["state"], checks[key]["answer"]), ("pending", "unknown"))
        self.assertEqual(checks["other:2"]["reported"]["source"], "合成机构")
        self.assertEqual(checks["missing_information:1"]["reported"]["status"], "six_months")
        self.assertEqual(self.get("state", **keys)["result"], state["result"])
        with self.assertRaises(follow.FollowupError):
            follow.dispatch("GET", path, {"memberId": self.other})

    def test_t20_plan_is_created_only_after_user_selects(self):
        state = self.run_ai(Model(["fs_med_001"]), "母亲68岁，住院自费3万元。", "佛山市")
        with database.transaction() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM plans").fetchone()[0], 0)
        result = self.act("plan", state, policyIds=["fs_med_001"])
        plan_id = result["planId"]
        with database.transaction() as db:
            plan = follow._plan(db, plan_id)
            self.assertEqual(plan["member_id"], self.member)
            self.assertEqual(plan["query_id"], state["result"]["queryId"])
            self.assertEqual(db.execute("SELECT count(*) FROM plan_tasks").fetchone()[0], 1)

        def read_task():
            plan = follow.dispatch("GET", "/api/followup/plans/" + plan_id,
                                   {"memberId": self.member})["plans"][plan_id]
            return plan["tasks"][0]

        def command(kind, **fields):
            task = read_task()
            response = follow.dispatch("POST", "/api/followup/commands", {
                "operationId": str(uuid4()), "type": kind, "planId": plan_id, "memberId": self.member,
                "policyId": "fs_med_001", "taskId": task["id"], "expectedRevision": task["revision"], **fields,
            })
            return response["data"]["plans"][plan_id]["tasks"][0]

        pending = read_task()
        self.assertTrue(pending["materials"])
        self.assertEqual(pending["analysisRecommendation"]["reason"], "合成研判依据")
        for material in pending["materials"]:
            saved = command("material", materialKey=material["key"], state="ready" if material["verified"] else "unknown",
                            reason="测试材料")
            self.assertEqual(saved["stage"], pending["stage"])
        self.assertEqual(command("workflow", action="start_preparation")["stage"], "preparing")
        reviewed = command("workflow", action="review_submission", requirementsConfirmed=True)
        self.assertEqual(reviewed["stage"], "ready_to_submit")
        self.assertIsNone(reviewed["submission"])
        with self.assertRaises(follow.FollowupError):
            command("workflow", action="confirm_submission", submitted=False)
        self.assertEqual(command("workflow", action="confirm_submission", submitted=True)["stage"], "in_progress")
        command("workflow", action="record_result", result="rejected", note="合成测试，材料仍需核实。")
        recovered = read_task()
        self.assertEqual(recovered["stage"], "rejected")
        self.assertEqual(recovered["outcome"]["note"], "合成测试，材料仍需核实。")
        self.assertTrue(all(material["reason"] == "测试材料" for material in recovered["materials"]))
