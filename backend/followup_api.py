"""Transactional commands and read projections for the single-device preview."""

from datetime import date
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from pathlib import Path
from uuid import UUID, uuid4

import action_plan
from deepseek_client import DeepSeekError
from followup_db import DEFAULT_DB_PATH, transaction
from followup_identity import LOCAL, principal
import policy_assessment
import semantic_discovery as semantic


INTENTS = {"verify", "later", "notmatch"}
STATUSES = {"pending", "preparing", "consulted", "applicable", "inapplicable", "deferred", "completed"}
CONSULTATION_SOURCES = {"official_reply_recorded", "personal_note", "ai_organized"}
TASK_TRANSITIONS = {
    "pending": ("preparing", "consulted", "deferred"),
    "preparing": ("consulted", "applicable", "deferred"),
    "consulted": ("preparing", "applicable", "deferred"),
    "applicable": ("preparing", "consulted", "completed", "deferred"),
    "inapplicable": ("preparing", "consulted", "deferred"),
    "deferred": ("preparing", "consulted"),
    "completed": ("preparing",),
}
LEGACY_STAGES = {
    "pending": "pending", "consulted": "pending", "preparing": "preparing",
    "applicable": "in_progress", "inapplicable": "pending", "deferred": "paused", "completed": "completed",
}
STAGE_STATUSES = {
    "pending": "pending", "preparing": "preparing", "ready_to_submit": "preparing",
    "in_progress": "applicable", "needs_supplement": "applicable", "completed": "completed",
    "rejected": "inapplicable", "paused": "deferred",
}
RESULT_STAGES = {
    "completed": "completed", "rejected": "rejected", "needs_supplement": "needs_supplement",
    "waiting": "in_progress", "feedback_received": "in_progress", "other": "in_progress",
}
AGE_RECHECK_MS = 365 * 86400 * 1000
RELATIONSHIPS = {"本人", "父亲", "母亲", "爷爷", "奶奶", "外公", "外婆", "配偶", "子女", "其他"}
PROOF_SECRET = secrets.token_bytes(32)


class FollowupError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code = status, code
        super().__init__(message)


def _require(condition, message, code="invalid_input", status=400):
    if not condition:
        raise FollowupError(status, code, message)


def _object(value, message="资料格式无效。"):
    _require(isinstance(value, dict), message)
    return value


def _text(value, message, limit, required=True):
    _require(isinstance(value, str) and len(value) <= limit and (not required or bool(value.strip())), message)
    return value.strip()


def _choice(value, allowed, message):
    _require(isinstance(value, str) and value in allowed, message)
    return value


def _uuid(value, message="记录编号格式无效。"):
    try:
        if isinstance(value, str) and str(UUID(value)) == value:
            return value
    except ValueError:
        pass
    raise FollowupError(400, "invalid_input", message)


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _load(value, default=None):
    return json.loads(value) if value is not None else default


def _now():
    return time.time_ns() // 1_000_000


def _get(connection, statement, args, message):
    row = connection.execute(statement, args).fetchone()
    _require(row is not None, message, "not_found", 404)
    return row


def _member(connection, member_id, allow_archived=False):
    row = _get(connection, "SELECT * FROM members WHERE id=? AND user_id=?", (member_id, principal.get()[0]), "未找到家庭成员。")
    _require(allow_archived or row["archived_at"] is None, "该成员已归档。", "member_archived", 409)
    return row


def _member_view(row):
    return {"id": row["id"], "memberId": row["id"], "name": row["name"], "relation": "本人" if row["id"] == principal.get()[1] else row["relationship"],
            "revision": row["revision"], "archivedAt": row["archived_at"]}


def _query(connection, query_id):
    return _get(connection, "SELECT * FROM queries WHERE id=? AND user_id=?", (_uuid(query_id), principal.get()[0]), "未找到本次查询。")


def _scoped_query(connection, query_id, body):
    query = _query(connection, query_id)
    _require(body.get("memberId", query["member_id"]) == query["member_id"],
             "查询与所选成员不一致。", "query_scope_conflict", 409)
    return query


def _plan(connection, plan_id):
    return _get(connection, "SELECT * FROM plans WHERE id=? AND user_id=?", (_uuid(plan_id), principal.get()[0]), "未找到少跑腿计划。")


def _case(connection, scope, policy_id):
    return connection.execute(
        "SELECT * FROM cases WHERE user_id=? AND member_id=? AND region=? AND policy_id=?",
        (principal.get()[0], scope["member_id"], scope["region"], policy_id),
    ).fetchone()


def _revision(body, row):
    value = body.get("expectedRevision")
    _require(type(value) is int and value >= 0, "请提供有效的数据版本。")
    actual = row["revision"] if row is not None else 0
    _require(value == actual, f"数据已在另一页面更新（当前版本 {actual}）。请重新读取后确认。", "revision_conflict", 409)


def _proof(value):
    return hmac.new(PROOF_SECRET, _json([principal.get()[0], value]).encode("utf-8"), hashlib.sha256).hexdigest()


def sign_assessment(payload, result):
    """Attach admission receipts after the existing assessment has completed."""
    try:
        query_id = _uuid(payload.get("queryId"))
    except FollowupError:
        return result
    profile = result.get("profile") or {}
    with transaction() as connection:
        query = connection.execute("SELECT * FROM queries WHERE id=? AND user_id=?", (query_id, principal.get()[0])).fetchone()
    if query is None or query["region"] != profile.get("region"):
        return result
    registered = _load(query["structured_json"], {})
    if any(registered.get(key) != profile.get(key) for key in ("age", *semantic.FACT_KEYS)):
        return result
    return _attach_admission(query_id, result)


def _attach_admission(query_id, result):
    for entry in result.get("entries", []):
        evidence = entry.get("evidence_state") or {}
        if entry.get("display_state") == "candidate" and evidence.get("official_source_verified") and evidence.get("validity_status") == "active":
            origin = entry["origin"]
            entry["followupProof"] = origin + "." + _proof([query_id, entry["policy_id"], origin])
    return result


def _candidate_origin(query_id, policy_id, proof):
    _require(isinstance(proof, str) and "." in proof, "该候选缺少本次研判的核验凭证，请重新研判。", "candidate_proof_required", 409)
    origin, digest = proof.split(".", 1)
    _require(origin in policy_assessment.ORIGINS and digest.isascii() and hmac.compare_digest(digest, _proof([query_id, policy_id, origin])),
             "该候选的核验凭证已失效，请重新研判。", "candidate_proof_required", 409)
    return policy_assessment.ORIGINS[origin]


def _policy(region, policy_id):
    _text(policy_id, "请选择政策。", 80)
    path = Path(semantic.DATABASES[semantic.REGIONS[region]])
    try:
        with path.open(encoding="utf-8") as file:
            catalogue = json.load(file)
        policy = next((row for row in catalogue["policies"]
                       if row["policy_id"] == policy_id and row["region"]["scope"] == region), None)
        _require(policy is not None, "当前地区未收录该政策。", "policy_not_found", 404)
        return policy, catalogue["version"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise FollowupError(503, "catalogue_unavailable", "政策依据暂不可读取。") from error


def _conditions(policy, scope, query):
    profile = _load(query["structured_json"], {}) if query is not None else {}
    facts = {key: profile.get(key) for key in semantic.FACT_KEYS}
    _, conditions, blocked = semantic._conditions(policy, scope["region"], profile.get("age"), facts)
    return [row["text"] for row in conditions], blocked


def _remember_policy(connection, policy, version, region):
    connection.execute(
        """INSERT INTO policy_records(policy_id,region,policy_version,policy_name,source_json)
           VALUES(?,?,?,?,?) ON CONFLICT(policy_id,region) DO UPDATE SET
           policy_version=excluded.policy_version, policy_name=excluded.policy_name, source_json=excluded.source_json""",
        (policy["policy_id"], region, version, policy["policy_name"], _json(policy.get("source") or {})),
    )


def _favorite_row(connection, member_id, region, policy_id):
    return connection.execute(
        "SELECT * FROM favorites WHERE user_id=? AND member_id=? AND region=? AND policy_id=?",
        (principal.get()[0], member_id, region, policy_id),
    ).fetchone()


def _favorite_state(row):
    return {"saved": row is not None and row["saved_at"] is not None,
            "savedAt": row["saved_at"] if row is not None else None,
            "revision": row["revision"] if row is not None else 0}


def _favorites(connection, body):
    member = _member(connection, _uuid(body.get("memberId", principal.get()[1])), allow_archived=True)
    if "policyId" in body or "region" in body:
        region = _choice(body.get("region"), semantic.REGIONS, "请选择政策地区。")
        policy_id = _text(body.get("policyId"), "请选择政策。", 80)
        _policy(region, policy_id)
        return {"member": _member_view(member), "favorite": _favorite_state(
            _favorite_row(connection, member["id"], region, policy_id))}
    rows = connection.execute(
        """SELECT f.*, p.policy_name, p.source_json FROM favorites f
           JOIN policy_records p USING (policy_id, region)
           WHERE f.user_id=? AND f.member_id=? AND f.saved_at IS NOT NULL
           ORDER BY f.saved_at DESC, f.region, f.policy_id""",
        (principal.get()[0], member["id"]),
    )
    return {"member": _member_view(member), "favorites": [
        {"id": row["policy_id"], "region": row["region"], "name": row["policy_name"],
         "dept": (_load(row["source_json"], {}) or {}).get("department", ""), **_favorite_state(row)}
        for row in rows
    ]}


def _set_favorite(connection, body, now):
    member = _member(connection, _uuid(body.get("memberId")))
    region = _choice(body.get("region"), semantic.REGIONS, "请选择政策地区。")
    policy_id = _text(body.get("policyId"), "请选择政策。", 80)
    saved = body.get("saved")
    _require(type(saved) is bool, "请选择收藏或取消收藏。")
    policy, version = _policy(region, policy_id)
    row = _favorite_row(connection, member["id"], region, policy_id)
    _revision(body, row)
    if _favorite_state(row)["saved"] != saved:
        _remember_policy(connection, policy, version, region)
        connection.execute(
            """INSERT INTO favorites (user_id,member_id,policy_id,region,saved_at,revision) VALUES (?,?,?,?,?,1)
               ON CONFLICT (user_id,member_id,region,policy_id) DO UPDATE SET
               saved_at=excluded.saved_at, revision=favorites.revision+1""",
            (principal.get()[0], member["id"], policy_id, region, now if saved else None),
        )
    return {"memberId": member["id"], "policyId": policy_id, "region": region,
            "favorite": _favorite_state(_favorite_row(connection, member["id"], region, policy_id))}


def _require_verified(policy, blocked):
    state = policy_assessment._evidence_state(policy)
    _require(state["official_source_verified"] and state["validity_status"] == "active" and not blocked,
             "该政策当前不能进入待核实计划，请先核对政策依据或硬性条件。", "policy_not_admissible", 409)


def _event(connection, case_id, query, kind, value, now, plan_id=None, note=None):
    connection.execute(
        """INSERT INTO case_events(id,case_id,query_id,actor_member_id,kind,value,plan_id,created_at,note)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (str(uuid4()), case_id, query["id"] if query else None,
         principal.get()[1] if kind in {"status", "condition", "material", "workflow"}
         else (query["actor_member_id"] if query else principal.get()[1]),
         kind, value, plan_id, now, note),
    )


def _intent(connection, scope, query, body, now, from_batch=False):
    intent = _choice(body.get("intent"), INTENTS, "请选择处理意向。")
    policy_id = body.get("policyId")
    policy, version = _policy(scope["region"], policy_id)
    item = _case(connection, scope, policy_id)
    _revision(body, item)
    conditions, blocked = _conditions(policy, scope, query)
    if intent == "verify" or from_batch:
        _require_verified(policy, blocked)
    origin = _candidate_origin(query["id"], policy_id, body.get("proof")) if from_batch or body.get("proof") else None
    _remember_policy(connection, policy, version, scope["region"])
    if item is None:
        case_id = str(uuid4())
        connection.execute(
            """INSERT INTO cases(id,user_id,member_id,region,policy_id,intent,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (case_id, principal.get()[0], scope["member_id"], scope["region"], policy_id, intent, now, now),
        )
    else:
        case_id = item["id"]
        if item["intent"] != intent:
            connection.execute("UPDATE cases SET intent=?,revision=revision+1,updated_at=? WHERE id=?", (intent, now, case_id))
    if query is not None:
        connection.execute(
            """INSERT INTO case_sources(case_id,query_id,origin,conditions_json,policy_version,created_at,policy_source_json)
               VALUES(?,?,?,?,?,?,?) ON CONFLICT(case_id,query_id) DO NOTHING""",
            (case_id, query["id"], origin or "政策详情", _json(conditions), version, now,
             _json(policy.get("source") or {})),
        )
    if item is None or item["intent"] != intent:
        _event(connection, case_id, query, "intent", intent, now)
        if item is not None and "verify" in (intent, item["intent"]):
            connection.execute(
                """UPDATE plans SET advice_json=NULL,revision=revision+1,updated_at=?
                   WHERE id IN (SELECT plan_id FROM plan_tasks WHERE case_id=?)""", (now, case_id))


def _items(connection, member_id, region, query_id, plan_id=None):
    sql = """SELECT c.*, p.policy_name FROM cases c JOIN policy_records p USING (region,policy_id)
             WHERE c.user_id=? AND c.member_id=?"""
    args = (principal.get()[0], member_id)
    if region:
        sql += " AND c.region=?"
        args += (region,)
    if plan_id:
        sql += " AND EXISTS(SELECT 1 FROM plan_tasks WHERE plan_id=? AND case_id=c.id)"
        args += (plan_id,)
    result = {}
    for row in connection.execute(sql + " ORDER BY c.created_at,c.id", args):
        sources = list(connection.execute(
            """SELECT s.*, a.archived_at FROM case_sources s
               JOIN query_history h USING(query_id) LEFT JOIN query_archives a USING(root_id)
               WHERE s.case_id=? ORDER BY s.query_id=? DESC,s.created_at DESC,s.query_id""",
            (row["id"], query_id),
        ))
        source = sources[0] if sources else None
        events = connection.execute("SELECT * FROM case_events WHERE case_id=? ORDER BY created_at,id", (row["id"],))
        changes, intent_history = [], []
        for event in events:
            if event["kind"] == "intent":
                intent_history.append({"id": event["id"], "intent": event["value"], "at": event["created_at"], "queryId": event["query_id"]})
            elif event["kind"] == "status" and (plan_id is None or event["plan_id"] == plan_id):
                changes.append({"id": event["id"], "status": event["value"], "at": event["created_at"],
                                "planId": event["plan_id"], "note": event["note"]})
            elif event["kind"] == "workflow" and event["plan_id"] == plan_id:
                detail = _load(event["note"])
                if detail["reason"] != "legacy_status" and detail["oldStage"] != detail["newStage"]:
                    changes.append({"id": event["id"], "status": STAGE_STATUSES[detail["newStage"]],
                                    "at": event["created_at"], "planId": event["plan_id"],
                                    "note": (detail.get("details") or {}).get("note")})
        result[row["policy_id"]] = {
            "id": row["policy_id"], "caseId": row["id"], "name": row["policy_name"], "intent": row["intent"],
            "status": row["status"], "revision": row["revision"], "memberId": member_id, "region": row["region"],
            "origin": source["origin"] if source else "", "conditions": _load(source["conditions_json"], []) if source else [],
            "queryIds": [entry["query_id"] for entry in sources],
            "activeQueryIds": [entry["query_id"] for entry in sources if entry["archived_at"] is None],
            "changes": changes, "intentHistory": intent_history,
            "updatedAt": row["updated_at"],
        }
    return result


def _consultation_view(entry):
    form = _load(entry["form_json"])
    return {"id": entry["id"], "pid": entry["policy_id"], "memberId": entry["member_id"],
            "userId": principal.get()[0],
            "planId": entry["plan_id"], "taskId": entry["task_id"], "queryId": entry["query_id"],
            "createdAt": entry["created_at"], "sourceType": form.get("sourceType"),
            "revision": form.get("sourceRevision", 0), "form": form}


def _consultations(connection, member_id, region, query_id):
    sql = """SELECT l.*, c.policy_id,c.member_id FROM consultations l JOIN cases c ON c.id=l.case_id
             WHERE c.user_id=? AND c.member_id=? AND l.plan_id IS NULL"""
    args = (principal.get()[0], member_id)
    if region:
        sql += " AND c.region=?"
        args += (region,)
    if query_id:
        sql += " AND l.query_id=?"
        args += (query_id,)
    return [_consultation_view(row) for row in connection.execute(sql + " ORDER BY l.created_at,l.id", args)]


def _plan_view(connection, row):
    tasks, ids, prepared, preparation, revisions = [], [], {}, {}, {}
    for task in connection.execute(
        """SELECT t.*, c.policy_id,c.intent, p.policy_name FROM plan_tasks t JOIN cases c ON c.id=t.case_id
           JOIN policy_records p ON p.policy_id=c.policy_id AND p.region=c.region WHERE t.plan_id=? ORDER BY c.policy_id""",
        (row["id"],),
    ):
        policy_id = task["policy_id"]
        ids.append(policy_id)
        requirements = _task_requirements(task)
        source_query = connection.execute("SELECT structured_json FROM queries WHERE id=? AND user_id=? AND member_id=?",
                                          (requirements.get("queryId") or row["query_id"], row["user_id"], row["member_id"])).fetchone()
        recommendation = (_load(source_query[0], {}).get("v32_candidates", {}).get(policy_id) if source_query else None)
        workflow = requirements.get("workflow", {})
        stage = _task_stage(task["status"], workflow)
        last_result = connection.execute(
            """SELECT note,created_at FROM case_events WHERE plan_id=? AND case_id=? AND kind='status'
               AND value='completed' AND note IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1""",
            (row["id"], task["case_id"]),
        ).fetchone()
        first_submission = workflow.get("firstSubmission") or _first_submission_event(connection, row, task)
        latest_supplement = workflow.get("latestSupplement")
        if latest_supplement is None and first_submission and workflow.get("submission") != first_submission:
            latest_supplement = workflow.get("submission")
        outcome = workflow.get("outcome")
        if outcome and outcome["result"] == "completed":
            last_result = {"note": outcome["note"] or outcome["officialReply"], "created_at": outcome["at"]}
        tasks.append({"id": task["id"], "policyId": policy_id, "memberId": row["member_id"], "name": task["policy_name"],
                      "status": task["status"], "intent": task["intent"], "region": row["region"],
                      "stage": stage, "submission": workflow.get("submission"), "outcome": outcome,
                      "firstSubmission": first_submission or workflow.get("submission"),
                      "latestSupplement": latest_supplement,
                      "consultationContact": requirements.get("consultationContact"),
                      "analysisRecommendation": recommendation,
                      "submissionReview": workflow.get("review"),
                      "workflowActions": _task_workflow_actions(stage),
                      "requirements": requirements["conditions"], "queryId": requirements.get("queryId"),
                      "removedAt": task["removed_at"],
                      "revision": task["revision"], "createdAt": task["created_at"], "updatedAt": task["updated_at"],
                      "nextStatuses": list(TASK_TRANSITIONS[task["status"]]),
                      "lastResult": dict(last_result) if last_result else None})
        for check in connection.execute("SELECT * FROM preparations WHERE task_id=?", (task["id"],)):
            key = check["evidence_key"]
            revisions.setdefault(policy_id, {})[key] = check["revision"]
            if key == "ready":
                prepared[policy_id] = bool(check["checked"])
            else:
                preparation.setdefault(policy_id, {})[key] = bool(check["checked"])
    active = [task for task in tasks if task["removedAt"] is None and task["intent"] == "verify"]
    done = sum(task["stage"] == "completed" for task in active)
    closed = done + sum(task["stage"] == "rejected" for task in active)
    status = ("empty" if not active else "completed" if done == len(active)
              else "closed" if closed == len(active) else "active")
    if row["paused_at"] is not None:
        status = "paused"
    consultations = [
        _consultation_view(entry)
        for entry in connection.execute(
            """SELECT l.*, c.policy_id,c.member_id FROM consultations l JOIN cases c ON c.id=l.case_id
               WHERE l.plan_id=? ORDER BY l.created_at,l.id""", (row["id"],))
    ]
    latest_consultations = {}
    for entry in consultations:
        if entry["taskId"] is not None:
            latest_consultations[entry["taskId"]] = entry["form"]
    for task in tasks:
        form = latest_consultations.get(task["id"], {})
        contact = task["consultationContact"]
        newest = next((entry for entry in reversed(consultations) if entry["taskId"] == task["id"]), None)
        if contact and (not newest or contact["at"] >= newest["createdAt"]):
            task["consultationStatus"] = "contacted"
        elif form.get("responseStatus") == "received":
            task["consultationStatus"] = "reply_recorded"
        elif form.get("responseStatus") == "waiting":
            task["consultationStatus"] = "contacted"
        else:
            task["consultationStatus"] = "unrecorded"
        task["awaitingConsultation"] = task["consultationStatus"] == "contacted"
    return {"id": row["id"], "queryId": row["query_id"], "memberId": row["member_id"], "from": row["from_route"],
            "region": row["region"], "ids": ids, "tasks": tasks, "createdAt": row["created_at"], "revision": row["revision"],
            "status": status, "pausedAt": row["paused_at"], "pauseReason": row["pause_reason"],
            "progress": {"ids": [task["policyId"] for task in active], "total": len(tasks), "active": len(active),
                                           "removed": len(tasks)-len(active), "done": done, "closed": closed, "status": status},
            "prepared": prepared, "preparation": preparation, "preparationRevisions": revisions,
            "consultations": consultations, "advice": _load(row["advice_json"])}


def _projection(connection, member_id, region=None, query=None, plan=None):
    member = _member(connection, member_id, allow_archived=True)
    query_id = query["id"] if query is not None else plan["query_id"] if plan is not None else None
    if plan is not None:
        plan_rows = [plan]
    else:
        sql, args = "SELECT * FROM plans WHERE user_id=? AND member_id=?", (principal.get()[0], member_id)
        if region:
            sql += " AND region=?"
            args += (region,)
        if query is not None:
            sql += " AND id IN (SELECT plan_id FROM query_plan_sources WHERE query_id=?)"
            args += (query_id,)
        plan_rows = connection.execute(sql + " ORDER BY created_at DESC,id", args)
    items = _items(connection, member_id, region, query_id, plan["id"] if plan is not None else None)
    plans = {row["id"]: _plan_view(connection, row) for row in plan_rows}
    if plan is not None:
        for task in plans[plan["id"]]["tasks"]:
            items[task["policyId"]]["status"] = task["status"]
    return {"queryId": query_id, "memberId": member_id, "member": member_id, "label": member["name"],
            "memberArchived": member["archived_at"] is not None,
            "mode": query["mode"] if query is not None else ("self" if member_id == principal.get()[1] else "family"),
            "region": region, "items": items, "profile": _load(query["structured_json"], {}) if query is not None else None,
            "consultations": _consultations(connection, member_id, region, query_id) if plan is None else [],
            "plans": plans}


def _query_view(connection, query):
    return {**_projection(connection, query["member_id"], query["region"], query=query),
            "memberId": query["member_id"], "actorMemberId": query["actor_member_id"],
            "createdAt": query["created_at"]}


def _history(connection, query, *, active=True):
    row = connection.execute(
        """SELECT h.*, a.archived_at FROM query_history h
           LEFT JOIN query_archives a USING(root_id) WHERE h.query_id=?""", (query["id"],)).fetchone()
    _require(not active or row["archived_at"] is None, "这条查询历史已删除。", "not_found", 404)
    return row


def _history_view(connection, query, attempt=None):
    history = _history(connection, query)
    root = history["root_id"]
    versions = [dict(row) for row in connection.execute(
        """SELECT q.id AS queryId, q.created_at AS createdAt, q.region, h.version
           FROM query_history h JOIN queries q ON q.id=h.query_id
           WHERE h.root_id=? ORDER BY h.version DESC""", (root,))]
    stored = connection.execute("SELECT * FROM query_snapshots WHERE query_id=?", (query["id"],)).fetchone()
    attempts = [dict(row) for row in connection.execute(
        "SELECT attempt, created_at AS createdAt FROM query_assessments WHERE query_id=? ORDER BY attempt DESC",
        (query["id"],))]
    selected = attempts[0]["attempt"] if attempt is None and attempts else attempt
    assessment = None
    if selected is not None:
        saved = _get(connection, "SELECT result_json FROM query_assessments WHERE query_id=? AND attempt=?",
                     (query["id"], selected), "未找到这次分析。")
        assessment = _attach_admission(query["id"], _load(saved["result_json"]))
    return {
        "queryId": query["id"], "rootId": root, "version": history["version"], "versions": versions,
        "memberId": query["member_id"], "actorMemberId": query["actor_member_id"],
        "memberLabel": _member(connection, query["member_id"], allow_archived=True)["name"],
        "mode": query["mode"], "region": query["region"], "createdAt": query["created_at"],
        "profile": _load(query["structured_json"]), "form": _load(stored["form_json"]) if stored else None,
        "result": _load(stored["result_json"]) if stored else None, "assessment": assessment,
        "assessmentAttempts": attempts, "assessmentAttempt": selected,
        "planIds": [r[0] for r in connection.execute(
            "SELECT plan_id FROM query_plan_sources WHERE query_id=? ORDER BY plan_id", (query["id"],))],
        "caseIds": [r[0] for r in connection.execute(
            "SELECT case_id FROM case_sources WHERE query_id=? ORDER BY case_id", (query["id"],))],
    }


def _query_list(connection, body):
    member = _member(connection, _uuid(body.get("memberId", principal.get()[1])), allow_archived=True)
    rows = connection.execute(
        """SELECT q.id AS queryId, h.root_id AS rootId, h.version, q.mode, q.region,
                  q.created_at AS createdAt, EXISTS (
                      SELECT 1 FROM query_snapshots s WHERE s.query_id=q.id
                  ) AS hasSnapshot
           FROM queries q JOIN query_history h ON h.query_id=q.id
           WHERE q.user_id=? AND q.member_id=?
               AND NOT EXISTS (SELECT 1 FROM query_archives a WHERE a.root_id=h.root_id)
               AND NOT EXISTS (SELECT 1 FROM query_history n WHERE n.root_id=h.root_id AND n.version>h.version)
           ORDER BY q.created_at DESC,q.id""", (principal.get()[0], member["id"]))
    return {"memberId": member["id"], "queries": [dict(row) for row in rows]}


def _archive_query(connection, body, now):
    query = _query(connection, body.get("queryId"))
    history = _history(connection, query, active=False)
    head = connection.execute("SELECT max(version) FROM query_history WHERE root_id=?",
                              (history["root_id"],)).fetchone()[0]
    _require(history["version"] == head and type(body.get("expectedVersion")) is int
             and body["expectedVersion"] == head, "查询已有更新版本，请刷新后重试。", "revision_conflict", 409)
    connection.execute("INSERT INTO query_archives VALUES (?,?) ON CONFLICT(root_id) DO NOTHING",
                       (history["root_id"], now))
    return {"rootId": history["root_id"], "archived": True}


def _plan_view_context(connection, plan):
    data = _projection(connection, plan["member_id"], plan["region"], plan=plan)
    view = data["plans"][plan["id"]]
    advice = view["advice"]
    evidence = {}
    if view["progress"]["ids"]:
        try:
            evidence = action_plan.generate({"region": plan["region"], "policy_ids": view["progress"]["ids"]}, analyze=False)
        except (DeepSeekError, OSError, ValueError, KeyError):
            policies = []
            for policy_id in view["progress"]["ids"]:
                try:
                    policies.extend(action_plan.generate(
                        {"region": plan["region"], "policy_ids": [policy_id]}, analyze=False)["policies"])
                except (DeepSeekError, OSError, ValueError, KeyError):
                    continue
            evidence = {"policies": policies}
    data["policyEvidence"] = evidence.get("policies", [])
    data["policyDependencies"] = [row for item in evidence.get("assessments", [])
                                  for row in item["dependencies"]]
    by_policy = {row["id"]: row for row in data["policyEvidence"]}
    events_by_case = {}
    for event in connection.execute(
        """SELECT id,case_id,kind,note,created_at FROM case_events
           WHERE plan_id=? AND kind IN ('workflow','condition','material') ORDER BY created_at,rowid""",
        (plan["id"],),
    ):
        events_by_case.setdefault(event["case_id"], []).append(
            {"id": event["id"], "kind": event["kind"], "at": event["created_at"], **_load(event["note"])})
    now = _now()
    for task in view["tasks"]:
        task["conditionChecks"], task["materials"] = [], []
        policy_id = task["policyId"]
        task["workflowHistory"] = events_by_case.get(data["items"][policy_id]["caseId"], [])
        evidence_view = by_policy.get(policy_id)
        if evidence_view:
            stored = connection.execute("SELECT * FROM plan_tasks WHERE id=?", (task["id"],)).fetchone()
            try:
                policy, _ = _policy(plan["region"], policy_id)
                task["materials"] = _material_view(plan["region"], evidence_view, _task_requirements(stored),
                                                   view["preparation"].get(policy_id, {}))
                task["conditionChecks"] = [
                    {key: value for key, value in check.items() if key != "fingerprint"}
                    for check in _conditions_for_task(connection, plan, stored, policy, now)]
            except FollowupError:
                evidence_view = None
        if data["memberArchived"] or task["removedAt"] is not None or task["intent"] != "verify":
            task["workflowActions"] = []
        task["nextAction"] = _next_task_action(task["stage"], task["conditionChecks"], task["materials"], bool(evidence_view))
        if task["stage"] == "rejected":
            task["relatedPolicies"] = _related_policies(connection, plan, task)
    if advice:
        version = evidence.get("evidenceVersion")
        if advice.get("format") != "coordination.v2" or not version or advice.get("evidenceVersion") != version:
            view["advice"], view["adviceStale"] = None, True
    data["availableTasks"] = [
        {"id": item["id"], "name": item["name"]}
        for item in _items(connection, plan["member_id"], plan["region"], None).values()
        if item["intent"] == "verify" and item["activeQueryIds"] and item["id"] not in data["items"]
    ] if not data["memberArchived"] else []
    return data


def _make_member(connection, body, now):
    relation = _choice(body.get("relation"), RELATIONSHIPS - {"本人"}, "请选择家庭成员关系。")
    name = _text(body.get("name"), "请填写成员姓名或自定义称呼。", 80)
    member_id = str(uuid4())
    connection.execute(
        "INSERT INTO members(id,user_id,name,relationship,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        (member_id, principal.get()[0], name, relation, now, now),
    )
    return {"member": _member_view(_member(connection, member_id))}


def _update_member(connection, body, now, archive=False):
    member = _member(connection, _uuid(body.get("memberId")), allow_archived=True)
    _revision(body, member)
    member_id = member["id"]
    if archive:
        _require(member_id != principal.get()[1], "本人的资料不能归档。")
        archived = body.get("archived")
        _require(type(archived) is bool, "请选择归档或恢复。")
        connection.execute("UPDATE members SET archived_at=?,revision=revision+1,updated_at=? WHERE id=?",
                           (now if archived else None, now, member_id))
    else:
        name = _text(body.get("name"), "请填写成员姓名或自定义称呼。", 80)
        allowed = {"本人"} if member_id == principal.get()[1] else RELATIONSHIPS - {"本人"}
        relation = _choice(body.get("relation"), allowed, "请选择家庭成员关系。")
        connection.execute("UPDATE members SET name=?,relationship=?,revision=revision+1,updated_at=? WHERE id=?",
                           (name, "self" if member_id == principal.get()[1] else relation, now, member_id))
    return {"member": _member_view(_member(connection, member_id, allow_archived=True))}


def _make_query(connection, body, now, match=None):
    query_id, member_id = _uuid(body.get("queryId")), _uuid(body.get("memberId"))
    _member(connection, member_id)
    actor_id = _uuid(body.get("actorMemberId", principal.get()[1]))
    _require(principal.get() == LOCAL or actor_id == principal.get()[1],
             "操作人必须为当前登录用户。", "invalid_actor", 403)
    _member(connection, actor_id)
    mode = _choice(body.get("mode"), {"family", "self"}, "请选择查询模式。")
    _require((mode == "self") == (member_id == principal.get()[1]) and (mode == "self") == (actor_id == member_id),
             "查询模式与家庭成员不一致。")
    region = _choice(body.get("region"), semantic.REGIONS, "请选择当前查询地区。")
    profile = _object(body.get("profile"), "查询资料格式无效。")
    age = profile.get("age")
    _require(type(age) is int and 0 <= age <= 120 and profile.get("region", region) == region, "请核对年龄和查询地区。")
    for field in ("hukou", "insurance", "disability"):
        _require(profile.get(field) is None or type(profile[field]) is bool, "请核对已确认的政策条件。")
    _require(profile.get("family_economic") is None or isinstance(profile["family_economic"], str), "请核对家庭经济类别。")
    payload = _json(profile)
    _require(len(payload) <= 32000, "查询资料超过允许大小。")
    row = connection.execute("SELECT * FROM queries WHERE id=?", (query_id,)).fetchone()
    previous = body.get("previousQueryId")
    parent = _query(connection, previous) if previous is not None else None
    ancestry = _history(connection, parent) if parent is not None else None
    if parent is not None:
        _require((parent["member_id"], parent["actor_member_id"], parent["mode"]) == (member_id, actor_id, mode),
                 "不能把一个成员的查询编辑为另一个成员的查询。", "query_scope_conflict", 409)
    if row is not None:
        _require(tuple(row[key] for key in ("user_id", "member_id", "actor_member_id", "region", "mode", "structured_json"))
                 == (principal.get()[0], member_id, actor_id, region, mode, payload),
                 "该查询编号已用于其他资料。", "query_conflict", 409)
        history = _history(connection, row)
        root, version = (ancestry["root_id"], ancestry["version"] + 1) if ancestry else (query_id, 1)
        _require((history["root_id"], history["version"]) == (root, version),
                 "该查询编号已用于其他版本。", "query_conflict", 409)
        if match is not None:
            stored = _get(connection, "SELECT form_json FROM query_snapshots WHERE query_id=?", (query_id,),
                          "这条历史查询没有原始结果。")
            _require(stored["form_json"] == _json(body.get("form")),
                     "该查询编号已用于其他资料。", "query_conflict", 409)
    else:
        if ancestry:
            head = connection.execute("SELECT max(version) FROM query_history WHERE root_id=?",
                                      (ancestry["root_id"],)).fetchone()[0]
            _require(type(body.get("expectedVersion")) is int and body["expectedVersion"] == ancestry["version"] == head,
                     "查询已有更新版本，请刷新后重试。", "revision_conflict", 409)
        connection.execute(
            """INSERT INTO queries(id,user_id,member_id,actor_member_id,region,mode,structured_json,created_at)
               VALUES(?,?,?,?,?,?,?,?)""", (query_id, principal.get()[0], member_id, actor_id, region, mode, payload, now))
        if ancestry:
            connection.execute("UPDATE query_history SET root_id=?,version=? WHERE query_id=?",
                               (ancestry["root_id"], ancestry["version"] + 1, query_id))
        if match is not None:
            form = _object(body.get("form"), "查询表单无效。")
            text = _text(form.get("text"), "请填写本次查询情况。", 4000)
            ui_form = _object(form.get("uiForm"), "查询表单无效。")
            answers = _object(ui_form.get("answers"), "补充资料格式无效。")
            _require(all(isinstance(value, str) for value in answers.values()), "补充资料格式无效。")
            ai = _object(ui_form.get("ai", {}), "辅助分析资料格式无效。")
            description = _text(ai.get("description", ""), "补充描述格式无效。", 2000, required=False)
            _require(isinstance(ai.get("suggestions", []), list) and len(_json(form)) <= 32000,
                     "查询表单超过允许大小或格式无效。")
            _require(ui_form.get("mode") == mode and ui_form.get("city") == region
                     and str(ui_form.get("age")) == str(age) and ui_form.get("answers") == profile.get("answers"),
                     "查询表单与已确认资料不一致。")
            scenes = profile.get("scenes", [])
            form_scenes = ui_form.get("scenes", [])
            confirmed = ai.get("confirmed", [])
            _require(all(isinstance(group, list) and len(group) <= 30
                         and all(isinstance(x, str) and 0 < len(x) <= 40 for x in group)
                         for group in (scenes, form_scenes, confirmed))
                     and set(scenes) == set(form_scenes) | set(confirmed), "生活变化选项与已确认资料不一致。")
            base = {key: profile[key] for key in semantic.FACT_KEYS if key in profile}
            for field, key in (("beneficiary", "relation"), ("operator", "operator")):
                value = _text(profile.get(field), "请核对查询人物。", 80)
                _require(value == ui_form.get(field), "查询人物与已确认资料不一致。")
                base[key] = value
            match_input = {"text": text, "mode": mode, "age": age, "region": region, "profile": base}
            if scenes:
                base["confirmed_scenes"] = sorted(set(scenes))
            if description and description != answers.get("notes", "").strip():
                match_input.update(life_description=description, answers=answers)
            result = match(match_input)
            age_conflict = next((item for item in result["profile"].get("conflicts", []) if item["kind"] == "年龄"), None)
            _require(age_conflict is None,
                     "表单年龄与生活描述不一致，请核对受益人的年龄并修改相应资料。", "age_conflict", 422)
            connection.execute("INSERT INTO query_snapshots VALUES (?,?,?,?)",
                               (query_id, _json(result), _json(form), now))
        if ancestry:
            _recheck_after_query_edit(connection, ancestry["root_id"], parent, _query(connection, query_id), now)
    return _query_view(connection, _query(connection, query_id))


def _rule_admission(connection, query, member_id=None):
    _require(member_id is None or member_id == query["member_id"],
             "查询与所选成员不一致。", "query_scope_conflict", 409)
    _member(connection, query["member_id"])
    _history(connection, query)
    stored = connection.execute("SELECT result_json FROM query_snapshots WHERE query_id=?", (query["id"],)).fetchone()
    _require(stored is not None, "旧查询没有规则结果快照。", "snapshot_missing", 409)
    rule = _load(stored["result_json"])
    catalogue = {}
    if rule["results"]:
        try:
            catalogue = {policy["policy_id"]: policy for policy in semantic._catalog(query["region"])
                         if policy["region"]["scope"] == query["region"]}
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise FollowupError(503, "catalogue_unavailable", "政策依据暂不可读取。") from error
    return _attach_admission(query["id"], {
        "queryId": query["id"], "memberId": query["member_id"],
        "entries": policy_assessment.rule_entries(rule, catalogue),
    })


def assess_history(query_id, operation):
    """Run the existing assessment using the saved version and keep each displayed attempt."""
    with transaction() as db:
        saved = _history_view(db, _query(db, query_id))
    _require(saved["result"] is not None, "旧查询没有可分析的原始快照。", "snapshot_missing", 409)
    previous = saved["assessment"]
    if previous is not None and not previous["errors"]:
        return previous
    form = saved["form"]["uiForm"]
    ai = form.get("ai") or {}
    answers = form.get("answers") or {}
    hints = {
        "help": {"sometimes": "日常生活偶尔需要他人照料", "often": "日常生活经常需要他人照料"},
        "mobility": {"yes": "行动不便"}, "meal": {"yes": "需要社区助餐"},
        "delivery": {"yes": "需要送餐服务"}, "living": {"alone": "独居"},
    }
    scenes = list(dict.fromkeys(saved["profile"].get("scenes", []) + [
        values[answers[field]] for field, values in hints.items() if answers.get(field) in values
    ]))
    rule = {k: v for k, v in saved["result"].items() if k != "policyDetails"}
    context = {
        "query": {"text": saved["form"]["text"], "mode": saved["mode"], "profile": rule["profile"]},
        "description": "" if ai.get("status") == "skipped" else ai.get("description", "").strip(),
        "scenes": scenes, "inferences": ai.get("suggestions", []) if ai.get("status") == "success" else [],
    }
    result = operation(context, rule)
    attempt = (saved["assessmentAttempt"] or 0) + 1
    with transaction(write=True) as db:
        _history(db, _query(db, query_id))
        db.execute("INSERT OR IGNORE INTO query_assessments VALUES (?,?,?,?)",
                   (query_id, attempt, _json(result), _now()))
        row = db.execute("SELECT result_json FROM query_assessments WHERE query_id=? AND attempt=?",
                         (query_id, attempt)).fetchone()
    return _attach_admission(query_id, _load(row["result_json"]))


def _active_case(connection, scope, query, policy_id):
    case = _case(connection, scope, policy_id)
    _require(case is not None and case["intent"] == "verify", "请选择当前成员的待核实政策。", "not_in_queue", 409)
    policy, _ = _policy(scope["region"], policy_id)
    requirements, blocked = _conditions(policy, scope, query)
    _require_verified(policy, blocked)
    return case, requirements


def _task_requirements(task):
    saved = _load(task["requirements_json"], [])
    return saved if isinstance(saved, dict) else {"conditions": saved}


def _task_stage(status, workflow):
    return workflow.get("stage") or LEGACY_STAGES[status]


def _latest_query(connection, query):
    if query is None:
        return None
    return connection.execute(
        """SELECT q.* FROM queries q JOIN query_history h ON h.query_id=q.id
           WHERE h.root_id=(SELECT root_id FROM query_history WHERE query_id=?)
           ORDER BY h.version DESC LIMIT 1""", (query["id"],)
    ).fetchone() or query


def _condition_input(policy, row_id, fact):
    """Classify supported inputs without interpreting free text as a rule."""
    if policy["policy_id"] == "fs_med_002" and fact == "family_economic":
        return "reference", "拟申请的认定类别和所需条件可向受理机构核实。", None
    if policy["policy_id"] == "gz_elderly_009":
        special = {
            "disability_required": ("reference", "正式评估结果及出具机构可在下方正式评估条件中记录。", "other:2"),
            "other:0": ("reference", "请补充本市医保参保情况。长护险参保关系由医保经办机构核实。", "insurance_required"),
            "other:1": ("reference", "可记录家人观察到的持续时间。规范诊疗及失能持续时间由评估机构核实。", "missing_information:1"),
            "other:2": ("official", "需由失能评估或老年人照护需求综合评估确认。可记录已收到的结果及出具机构。", None),
            "missing_information:0": ("reference", "请在参保要求一项填写，可复用已保存的参保信息。", "insurance_required"),
            "missing_information:1": ("observation", "可记录观察到的持续时间，正式失能持续时间由评估机构核实。", None),
            "missing_information:2": ("reference", "可在正式评估条件中记录结果和来源。", "other:2"),
            "missing_information:3": ("reference", "请向医保经办机构核实定点护理机构及选择要求。", None),
        }
        if row_id in special:
            return special[row_id]
    if row_id == "region" or fact == "age":
        return "rule", "系统按本次查询的地区和年龄核对。资料缺失或有变化时，请更新查询。", None
    if fact in {"hukou", "insurance", "expense_scope"}:
        return "fact", "可按已知情况补充。资格由主管部门核定。", None
    if fact in {"disability", "family_economic"}:
        return "official", "以评估或主管部门出具的认定结果为准。可记录已收到的结果及出具机构。", None
    return "reference", "当前资料无法直接判断，请依据政策原文向主管部门核实。", None


def _condition_checks(policy, original, latest, requirements, now):
    first = _load(original["structured_json"], {}) if original else {}
    current = _load(latest["structured_json"], {}) if latest else {}
    facts = {key: current.get(key) for key in semantic.FACT_KEYS}
    confirmed, _, _ = semantic._conditions(policy, policy["region"]["scope"], current.get("age"), facts)
    confirmed = {row["id"]: row for row in confirmed}
    known_region, pending, _ = semantic._conditions(policy, policy["region"]["scope"], None, {})
    result = []
    for row in known_region + pending:
        key = row["id"]
        if key.startswith("age_"):
            fact = "age"
        elif key.endswith("_required"):
            fact = key.removesuffix("_required")
        elif key.startswith("qualify:"):
            qualifier = policy["conditions"]["qualify"][int(key.split(":")[1])]
            fact = qualifier.get("key")
        else:
            fact = None
        old_value, value = first.get(fact), current.get(fact)
        if key == "region":
            old_value = original["region"] if original else None
            value = latest["region"] if latest else None
        baseline_at = original["created_at"] if original else None
        if old_value is None or old_value == "unknown":
            baseline = requirements.get("conditionBaselines", {}).get(key, {})
            old_value, baseline_at = baseline.get("value"), baseline.get("at")
        previous = requirements.get("conditionChecks", {}).get(key)
        personal_report = previous.get("reported") if previous else None
        advisory = key == "thresholds" or key.startswith("missing_information:")
        geography_changed = (fact in {"hukou", "insurance"} and original and latest
                             and original["region"] != latest["region"])
        changed = (old_value is not None and value != old_value) or geography_changed
        confirmed_at = (baseline_at if value == old_value and baseline_at is not None
                        else latest["created_at"] if latest else None)
        fingerprint = _json([row["text"], row["reference"], value,
                             latest["region"] if fact in {"hukou", "insurance"} and latest else None])
        matches_previous = previous and previous["fingerprint"] == fingerprint
        age_source_at = previous["at"] if matches_previous else confirmed_at
        expired_age = fact == "age" and age_source_at is not None and now - age_source_at >= AGE_RECHECK_MS
        if matches_previous and not expired_age and not personal_report:
            state = "pending" if previous["answer"] == "unknown" else "confirmed"
            answer, source, at = previous["answer"], "user_record", previous["at"]
        elif (previous and not matches_previous) or changed or expired_age:
            state, answer = "stale", "unknown"
            source = "user_record" if previous else "confirmed_profile"
            at = previous["at"] if previous else baseline_at if changed else confirmed_at
        elif key in confirmed and value != "unknown" and (key != "region" or value == policy["region"]["scope"]):
            row = confirmed[key]
            state, answer, source, at = "confirmed", "met", "confirmed_profile", confirmed_at
        elif value is False or value == "none" or (key == "region" or fact == "age") and value is not None:
            state, answer, source, at = "confirmed", "not_met", "confirmed_profile", confirmed_at
        else:
            state, answer, source, at = "pending", "unknown", "policy_rule", None
        editable = not advisory and (state != "confirmed" or source == "user_record")
        input_kind, guidance, related = _condition_input(policy, key, fact)
        # New personal observations and reports use the existing task receipt.
        report = personal_report if matches_previous and not expired_age else None
        assessment_recorded = (policy["policy_id"] == "gz_elderly_009" and key == "other:2"
                               and type(current.get("disability")) is bool)
        if assessment_recorded:
            guidance = "本次查询已有用户提供的评估情况。正式结果以评估机构核实为准。"
        changed_at = (age_source_at + AGE_RECHECK_MS if expired_age and not changed
                      else latest["created_at"] if latest else None)
        result.append({**row, "state": state, "answer": answer, "source": source, "at": at,
                       "advisory": advisory, "editable": editable,
                       "inputKind": input_kind, "guidance": guidance, "relatedCondition": related,
                       "canRecord": (input_kind in {"official", "observation"}
                                     and not assessment_recorded
                                     and not (source == "confirmed_profile" and state == "confirmed"))
                                    or (input_kind == "fact" and editable),
                       "reported": report,
                       "changedAt": changed_at if state == "stale" else None,
                       "fingerprint": fingerprint})
    return result


def _conditions_for_task(connection, plan, task, policy, now):
    requirements = _task_requirements(task)
    query_id = requirements.get("queryId") or plan["query_id"]
    original = _query(connection, query_id) if query_id else None
    return _condition_checks(policy, original, _latest_query(connection, original), requirements, now)


def _recheck_after_query_edit(connection, root_id, previous, current, now):
    tasks = connection.execute(
        """SELECT t.*, p.region,p.query_id,c.policy_id FROM plan_tasks t
           JOIN plans p ON p.id=t.plan_id JOIN cases c ON c.id=t.case_id
           JOIN query_history h ON h.query_id=COALESCE(json_extract(t.requirements_json,'$.queryId'),p.query_id)
           WHERE h.root_id=? AND p.user_id=? AND p.member_id=? AND t.removed_at IS NULL""",
        (root_id, current["user_id"], current["member_id"]),
    )
    for task in tasks:
        if task["region"] == current["region"]:
            connection.execute("INSERT OR IGNORE INTO query_plan_sources VALUES (?,?)", (task["plan_id"], current["id"]))
        try:
            policy, _ = _policy(task["region"], task["policy_id"])
        except FollowupError:
            continue
        requirements = _task_requirements(task)
        original = _query(connection, requirements.get("queryId") or task["query_id"])
        before = _condition_checks(policy, original, previous, requirements, now)
        after = _condition_checks(policy, original, current, requirements, now)
        changed = [index for index, (old, new) in enumerate(zip(before, after)) if old["fingerprint"] != new["fingerprint"]]
        if not changed:
            continue
        for index in changed:
            old = before[index]
            if old["source"] == "confirmed_profile" and old["state"] == "confirmed":
                requirements.setdefault("conditionBaselines", {}).setdefault(
                    old["id"], {"value": _load(old["fingerprint"])[2], "at": old["at"]})
        after = _condition_checks(policy, original, current, requirements, now)
        connection.execute("UPDATE plan_tasks SET requirements_json=?,revision=revision+1,updated_at=? WHERE id=?",
                           (_json(requirements), now, task["id"]))
        for index in changed:
            old, new = before[index], after[index]
            detail = {"taskId": task["id"], "conditionId": new["id"], "oldState": old["state"],
                      "newState": new["state"], "oldAnswer": old["answer"], "newAnswer": new["answer"],
                      "source": "confirmed_profile", "reason": "家庭情况有更新", "reference": new["reference"],
                      "sourceQueryId": current["id"]}
            _event(connection, task["case_id"], original, "condition", new["answer"], now, task["plan_id"], _json(detail))


def _related_policies(connection, plan, task):
    source = task["queryId"] or plan["query_id"]
    if source is None:
        return []
    current = _latest_query(connection, _query(connection, source))
    if current["region"] != plan["region"]:
        return []
    stored = connection.execute("SELECT result_json FROM query_snapshots WHERE query_id=?", (current["id"],)).fetchone()
    if stored is None:
        return []
    try:
        catalogue = {policy["policy_id"]: policy for policy in semantic._catalog(plan["region"])
                     if policy["region"]["scope"] == plan["region"]}
        rows = policy_assessment.rule_entries(_load(stored["result_json"]), catalogue)
    except (OSError, ValueError, KeyError, TypeError):
        return []
    rejected_reason = " ".join((task.get("outcome") or {}).get(key, "") for key in ("note", "officialReply"))
    terms = {word for word in ("户籍", "居住", "参保", "收入", "支出", "医疗", "照护", "评估", "材料", "费用")
             if word in rejected_reason}
    candidates = []
    for row in rows:
        identifier = row["policy_id"]
        if identifier == task["policyId"] or row["display_state"] != "candidate" or identifier not in catalogue:
            continue
        policy = catalogue[identifier]
        if semantic._validity(policy, date.today()) != "active" or not row["evidence_state"]["official_source_verified"]:
            continue
        synopsis = policy["policy_name"] + " " + " ".join(policy.get("missing_information") or [])
        matching = sorted(term for term in terms if term in synopsis)
        candidates.append((len(matching), {
            "id": identifier, "name": row["policy_name"], "sourceUrl": row["evidence_state"]["official_url"],
            "reason": "可进一步核对：" + "、".join(matching) if matching else "与同一成员的原查询情况相关。",
            "unknowns": (policy.get("missing_information") or [])[:3],
        }))
    return [item for _, item in sorted(candidates, key=lambda pair: -pair[0])[:5]]


def _insert_task(connection, plan_id, case, requirements, source_id, now):
    connection.execute(
        "INSERT INTO plan_tasks(id,plan_id,case_id,requirements_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        (str(uuid4()), plan_id, case["id"], _json({"conditions": requirements, "queryId": source_id}), now, now),
    )


def _batch_receipt(connection, identifier):
    row = _get(connection, "SELECT response_json FROM operations WHERE user_id=? AND operation_id=?",
               (principal.get()[0], _uuid(identifier)), "未找到本次处理回执。")
    batch = _load(row["response_json"]).get("batch")
    _require(batch is not None, "未找到本次处理回执。", "not_found", 404)
    return batch


def _batch_view(connection, identifier):
    batch = _batch_receipt(connection, identifier)
    query = _query(connection, batch["queryId"])
    archived = _history(connection, query, active=False)["archived_at"] is not None
    member = _member(connection, query["member_id"], allow_archived=True)
    items = _items(connection, query["member_id"], query["region"], query["id"])
    verify_ids = {entry["policyId"] for entry in batch["entries"] if entry["intent"] == "verify"}
    return {"batch": batch, "label": member["name"], "queryArchived": archived,
            "memberArchived": member["archived_at"] is not None,
            "items": {key: item for key, item in items.items() if key in verify_ids and
                      item["intent"] == "verify" and query["id"] in item["activeQueryIds"]}}


def _plan_source(connection, scope, query, policy_id):
    case = _case(connection, scope, policy_id)
    _require(case is not None and case["intent"] == "verify",
             "请选择当前成员和地区的待核实政策。", "not_in_queue", 409)
    sources = connection.execute(
        """SELECT q.* FROM case_sources s JOIN queries q ON q.id=s.query_id
           JOIN query_history h ON h.query_id=q.id LEFT JOIN query_archives a USING(root_id)
           WHERE s.case_id=? AND a.root_id IS NULL AND q.user_id=? AND q.member_id=? AND q.region=?
             AND (? IS NULL OR q.id=?)
           ORDER BY s.created_at DESC,q.id""",
        (case["id"], principal.get()[0], scope["member_id"], scope["region"],
         query["id"] if query is not None else None, query["id"] if query is not None else None),
    ).fetchall()
    _require(sources, "所选政策缺少可用的查询来源，请重新查询并核对。", "plan_source_required", 409)
    policy, _ = _policy(scope["region"], policy_id)
    for source in sources:
        requirements, blocked = _conditions(policy, scope, source)
        if not blocked:
            _require_verified(policy, False)
            return case, requirements, source["id"]
    _require_verified(policy, True)


def _create_plan(connection, body, now, *, match_query_root=False):
    ids = body.get("ids")
    _require(isinstance(ids, list) and 0 < len(ids) <= 32 and all(isinstance(value, str) for value in ids)
             and len(ids) == len(set(ids)), "请选择一项或多项待核实政策。")
    batch = _batch_receipt(connection, body["batchId"]) if "batchId" in body else None
    query_id = body.get("queryId")
    if batch is not None:
        _require(query_id == batch["queryId"] and
                 set(ids) <= {entry["policyId"] for entry in batch["entries"] if entry["intent"] == "verify"},
                 "请选择本批次中打算去核实的政策。", "batch_scope_conflict", 409)
    query = _query(connection, query_id) if query_id is not None else None
    if query is not None:
        _require(_history(connection, query, active=False)["archived_at"] is None,
                 "本次查询已删除，请从成员清单重新核对。", "plan_source_required", 409)
        _require(body.get("memberId", query["member_id"]) == query["member_id"],
                 "查询与所选成员不一致。", "query_scope_conflict", 409)
        scope = query
    else:
        scope = {"member_id": _uuid(body.get("memberId")),
                 "region": _choice(body.get("region"), semantic.REGIONS, "请选择待核实政策所在地区。")}
    _member(connection, scope["member_id"])
    cases = [_plan_source(connection, scope, query, policy_id) for policy_id in sorted(ids)]
    source_ids = list(dict.fromkeys(source_id for _, _, source_id in cases))
    existing = connection.execute("SELECT id FROM plans WHERE user_id=? AND member_id=? AND region=?",
                                  (principal.get()[0], scope["member_id"], scope["region"]))
    root_id = _history(connection, query)["root_id"] if match_query_root else None
    for row in existing:
        tasks = list(connection.execute("""SELECT t.case_id,t.removed_at,h.root_id FROM plan_tasks t
            JOIN plans p ON p.id=t.plan_id LEFT JOIN query_history h
            ON h.query_id=COALESCE(json_extract(t.requirements_json,'$.queryId'),p.query_id)
            WHERE t.plan_id=?""", (row["id"],)))
        if root_id and any(task["root_id"] != root_id for task in tasks if task["removed_at"] is None):
            continue
        if {task["case_id"] for task in tasks if task["removed_at"] is None} == {case["id"] for case, _, _ in cases}:
            connection.executemany("INSERT OR IGNORE INTO query_plan_sources VALUES (?,?)",
                                   [(row["id"], source_id) for source_id in source_ids])
            return row["id"]
    plan_id = str(uuid4())
    source = _text(body.get("from") or "", "计划来源格式无效。", 2048, required=False)
    connection.execute(
        "INSERT INTO plans(id,user_id,member_id,region,query_id,from_route,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        (plan_id, principal.get()[0], scope["member_id"], scope["region"], source_ids[0], source, now, now),
    )
    connection.executemany("INSERT INTO query_plan_sources VALUES (?,?)",
                           [(plan_id, source_id) for source_id in source_ids[1:]])
    for case, requirements, source_id in cases:
        _insert_task(connection, plan_id, case, requirements, source_id, now)
    return plan_id


def _consultation(connection, scope, query, plan, task, case, body, now):
    form = _object(body.get("form"), "请填写咨询记录。")
    values = {}
    source = form.get("sourceType")
    if "sourceType" in form:
        values["sourceType"] = _choice(source, CONSULTATION_SOURCES, "请选择有效的咨询记录来源。")
        values["sourceRevision"] = 1
    note = source in ("personal_note", "ai_organized")
    structured = source is not None or "responseStatus" in form
    for key, limit in (("date", 10), ("channel", 80), ("result", 120), ("answer", 800), ("pending", 500)):
        values[key] = _text(form.get(key, ""), "请核对咨询日期、渠道和结果。", limit,
                            required=key in {"date", "channel"} or (key == "result" and not structured))
    if "content" in form:
        values["content"] = _text(form["content"], "咨询内容格式无效。", 800, required=False)
    if structured:
        values["institution"] = _text(form.get("institution"), "请填写咨询机构。", 120)
        if note:
            _require(not values["answer"] and "responseStatus" not in form, "笔记或整理稿请填写记录内容。")
            values["recordText"] = _text(form.get("recordText"), "请填写记录内容。", 800)
            values["result"] = "个人咨询笔记" if source == "personal_note" else "AI 辅助整理"
        else:
            statuses = {"received"} if source == "official_reply_recorded" else {"waiting", "received"}
            values["responseStatus"] = _choice(form.get("responseStatus"), statuses, "请核对答复状态。")
            _require(bool(values["answer"]) == (values["responseStatus"] == "received"),
                     "收到答复时请填写实际答复，尚未收到时请留空。")
            values["result"] = "收到答复" if values["responseStatus"] == "received" else "尚未收到答复"
        values["followUpMaterials"] = _text(form.get("followUpMaterials", ""), "后续材料说明过长。", 500, required=False)
        values["followUpStatus"] = _choice(form.get("followUpStatus"), {"none", "pending", "done"}, "请选择后续状态。")
        _require(bool(values.get("content")), "请填写实际提出的问题。")
        values["time"] = _text(form.get("time", ""), "咨询时间格式无效。", 5, required=False)
        if values["time"]:
            _require(len(values["time"]) == 5 and values["time"][2] == ":" and
                     values["time"][:2].isascii() and values["time"][:2].isdigit() and
                     values["time"][3:].isascii() and values["time"][3:].isdigit() and
                     int(values["time"][:2]) < 24 and int(values["time"][3:]) < 60, "咨询时间格式无效。")
    values["source"] = "user_record"
    try:
        _require(date.fromisoformat(values["date"]).isoformat() == values["date"], "咨询日期格式无效。")
    except ValueError as error:
        raise FollowupError(400, "invalid_input", "咨询日期格式无效。") from error
    consultation_id = str(uuid4())
    connection.execute(
        "INSERT INTO consultations(id,case_id,plan_id,task_id,query_id,form_json,created_at) VALUES(?,?,?,?,?,?,?)",
        (consultation_id, case["id"], plan["id"] if plan else None, task["id"] if task else None,
         query["id"] if query else None, _json(values), now),
    )
    return consultation_id


def _consultation_row(connection, identifier, member_id=None):
    row = _get(connection, """SELECT l.*, c.policy_id,c.member_id,p.policy_name,m.name AS member_name
                              FROM consultations l JOIN cases c ON c.id=l.case_id
                              JOIN policy_records p ON p.policy_id=c.policy_id AND p.region=c.region
                              JOIN members m ON m.id=c.member_id WHERE l.id=? AND c.user_id=?""",
               (_uuid(identifier), principal.get()[0]), "未找到咨询记录。")
    _require(member_id is None or member_id == row["member_id"], "未找到该成员的咨询。", "not_found", 404)
    return row


def _update_consultation_source(connection, body):
    row = _consultation_row(connection, body.get("consultationId"), _uuid(body.get("memberId")))
    form = _load(row["form_json"])
    revision = form.get("sourceRevision", 0)
    _revision(body, {"revision": revision})
    source = _choice(body.get("sourceType"), CONSULTATION_SOURCES, "请选择有效的咨询记录来源。")
    if source != form.get("sourceType"):
        if source == "official_reply_recorded" and not form.get("recordedOfficialAnswer"):
            answer = _text(body.get("officialAnswer"), "请单独填写实际取得的官方答复。", 800)
            _require("".join(answer.split()) != "".join(form.get("recordText", "").split()),
                     "整理稿或笔记不能直接作为官方答复，请填写实际取得的答复。")
            form["recordedOfficialAnswer"] = answer
        form.update(sourceType=source, sourceRevision=revision + 1)
        connection.execute("UPDATE consultations SET form_json=? WHERE id=?", (_json(form), row["id"]))
    return {"consultationId": row["id"], "sourceType": source, "revision": form["sourceRevision"]}


def _material_view(region, policy, requirements, legacy):
    record, _ = _policy(region, policy["id"])
    catalogue = record.get("materials") or []
    rows = []
    for item in policy["materials"]:
        index = int(item["ref"].split(":")[1])
        note = catalogue[index].get("note") or ""
        key = hashlib.sha256(_json([item["text"], item["clause"], note]).encode("utf-8")).hexdigest()
        rows.append({**item, "key": key, "note": note})
    if not rows:
        rows.append({"key": "unknown", "text": "向受理机构核对材料清单", "verified": False,
                     "note": "现有政策资料未列明具体材料。", "clause": None})
    for row in rows:
        previous = requirements.get("materials", {}).get(row["key"])
        if not previous:
            state = "ready" if row["verified"] and legacy.get(row.get("ref")) else (
                "missing" if row["verified"] else "unknown")
            previous = {"state": state, "reason": ""}
        elif previous["state"] == "ready" and not row["verified"]:
            previous = {**previous, "state": "unknown"}
        row.update(previous)
    return rows


def _task_materials(connection, plan, task, policy_id):
    try:
        policy = action_plan.generate({"region": plan["region"], "policy_ids": [policy_id]}, analyze=False)["policies"][0]
    except (DeepSeekError, OSError, ValueError, KeyError):
        raise FollowupError(503, "catalogue_unavailable", "材料依据暂不可读取，请保留输入并重试。") from None
    legacy = {row["evidence_key"]: row["checked"] for row in connection.execute(
        "SELECT evidence_key,checked FROM preparations WHERE task_id=?", (task["id"],))}
    return _material_view(plan["region"], policy, _task_requirements(task), legacy)


def _update_material(connection, plan, task, query, policy_id, body, now):
    _revision(body, task)
    material = next((row for row in _task_materials(connection, plan, task, policy_id)
                     if row["key"] == body.get("materialKey")), None)
    _require(material is not None, "这项材料的依据已变化，请重新打开材料清单。", "material_conflict", 409)
    state = _choice(body.get("state"), {"ready", "missing", "unknown"}, "请选择材料状态。")
    _require(state != "ready" or material["verified"], "这项材料的要求还需确认。")
    reason = _text(body.get("reason", ""), "材料备注过长。", 500, required=False)
    requirements = _task_requirements(task)
    update = {"state": state, "reason": reason}
    if all(material[key] == value for key, value in update.items()):
        return
    requirements.setdefault("materials", {})[material["key"]] = update
    connection.execute("UPDATE plan_tasks SET requirements_json=?,revision=revision+1,updated_at=? WHERE id=?",
                       (_json(requirements), now, task["id"]))
    detail = {"taskId": task["id"], "materialKey": material["key"], "oldState": material["state"],
              "newState": state, "source": "user_record", "reason": reason or "更新材料准备情况"}
    _event(connection, task["case_id"], query, "material", state, now, plan["id"], _json(detail))


def _task_workflow_actions(stage):
    return {
        "pending": ["start_preparation", "review_submission", "confirm_submission", "pause"],
        "preparing": ["review_submission", "confirm_submission", "pause"],
        "ready_to_submit": ["review_submission", "confirm_submission", "pause"],
        "in_progress": ["record_result", "pause"],
        "needs_supplement": ["review_submission", "confirm_submission", "record_result", "pause"],
        "paused": ["resume"],
        "completed": ["correct_result"],
        "rejected": ["correct_result"],
    }[stage]


def _next_task_action(stage, conditions, materials, evidence_available):
    if stage in {"completed", "rejected"}:
        return {"type": "review", "reason": "查看已记录的办理结果与过程。"}
    if stage == "paused":
        return {"type": "resume", "reason": "已保留原有进度，可以在方便时继续。"}
    if any(row["editable"] and row["state"] == "stale" for row in conditions):
        return {"type": "conditions", "reason": "家庭资料或政策要求有变化，请重新核实受影响的条件。"}
    if stage == "in_progress":
        return {"type": "result", "reason": "当前事项处于办理中，收到进展或答复后可以更新。"}
    if not evidence_available:
        return {"type": "conditions", "reason": "政策办理依据暂不可读取，请重试或向受理机构核实。"}
    if any(row["editable"] and row["state"] == "pending" and row["source"] == "policy_rule" for row in conditions):
        return {"type": "conditions", "reason": "有尚未核实或因资料变化需要重新核实的条件。"}
    if stage == "pending":
        return {"type": "conditions", "reason": "核对当前情况后可以开始准备材料。"}
    if any(row["verified"] and row["state"] != "ready" for row in materials):
        return {"type": "materials", "reason": "政策明确列出的材料还有缺项，可以逐项准备。"}
    if stage == "needs_supplement":
        return {"type": "materials", "reason": "请按收到的答复准备补充材料，补交后可再次记录提交。"}
    return {"type": "submission", "reason": "查看受理信息和提交前检查，实际提交后再确认。"}


def _workflow_event(connection, task, plan, query, old, new, action, now, details=None):
    event = {"taskId": task["id"], "oldStage": old, "newStage": new, "source": "user_record",
             "reason": action, "at": now}
    if details is not None:
        event["details"] = details
    _event(connection, task["case_id"], query, "workflow", new, now, plan["id"], _json(event))


def _save_task_requirements(connection, task, requirements, now, status):
    connection.execute("UPDATE plan_tasks SET requirements_json=?,status=?,revision=revision+1,updated_at=? WHERE id=?",
                       (_json(requirements), status, now, task["id"]))


def _save_condition(connection, plan, task, query, policy_id, body, now):
    _revision(body, task)
    policy, _ = _policy(plan["region"], policy_id)
    checks = _conditions_for_task(connection, plan, task, policy, now)
    selected = next((row for row in checks if row["id"] == body.get("conditionId")), None)
    _require(selected is not None, "该核对条件已变化，请刷新后重新核对。", "condition_conflict", 409)
    _require(selected["canRecord"], "这项条件需通过政策依据或更新查询资料核实。", "condition_not_editable", 409)
    answer = _choice(body.get("answer"), {"met", "not_met", "unknown"}, "请选择条件核对结果。")
    report = None
    if selected["inputKind"] in {"official", "observation"}:
        _require(answer == "unknown", "只能记录已知情况，正式条件仍需核实。", "official_verification_required", 409)
        if selected["inputKind"] == "official":
            status = _choice(body.get("reportStatus"), {"received", "not_received", "unknown"}, "请选择是否已获得正式结果。")
            report = {"status": status}
            if status == "received":
                report.update(result=_text(body.get("reportedResult"), "请填写已知正式结果。", 160),
                              source=_text(body.get("reportedSource"), "请填写结果的来源。", 160))
        else:
            report = {"status": _choice(body.get("reportStatus"), {"six_months", "under_six_months", "unknown"}, "请选择已知时长。")}
    if (report is not None and report == selected["reported"]) or (
            report is None and selected["source"] == "user_record"
            and selected["state"] != "stale" and selected["answer"] == answer):
        return
    requirements = _task_requirements(task)
    requirements.setdefault("conditionChecks", {})[selected["id"]] = {
        "answer": answer, "at": now, "fingerprint": selected["fingerprint"],
        **({"reported": report} if report else {}),
    }
    connection.execute("UPDATE plan_tasks SET requirements_json=?,revision=revision+1,updated_at=? WHERE id=?",
                       (_json(requirements), now, task["id"]))
    detail = {"taskId": task["id"], "conditionId": selected["id"], "oldState": selected["state"],
              "oldAnswer": selected["answer"], "newState": "pending" if answer == "unknown" else "confirmed",
              "newAnswer": answer, "source": "user_record", "reason": "核对条件", "reference": selected["reference"]}
    if report:
        detail["reported"] = report
    _event(connection, task["case_id"], query, "condition", answer, now, plan["id"], _json(detail))


def _submitted_snapshot(connection, plan, task, policy_id, now, *, require_ready=False):
    policy, _ = _policy(plan["region"], policy_id)
    conditions = _conditions_for_task(connection, plan, task, policy, now)
    materials = _task_materials(connection, plan, task, policy_id)
    if require_ready:
        _require(all(row["state"] == "ready" for row in materials if row["verified"]),
                 "请先准备政策明确列出的必要材料。", "materials_required", 409)
    return {"conditions": conditions, "materials": materials}


def _optional_date(body, key, message):
    value = _text(body.get(key, ""), message, 10, required=False)
    if value:
        try:
            _require(date.fromisoformat(value).isoformat() == value, message)
        except ValueError:
            raise FollowupError(400, "invalid_input", message) from None
    return value


def _submission_record(body, now):
    return {"submittedDate": _optional_date(body, "submittedDate", "请核对实际提交日期。"),
            "channel": _text(body.get("channel", ""), "请核对提交渠道。", 120, required=False),
            "receiptNumber": _text(body.get("receiptNumber", ""), "请核对受理编号。", 120, required=False),
            "source": "user_record", "at": now}


def _first_submission_event(connection, plan, task):
    for event in connection.execute(
        "SELECT note FROM case_events WHERE plan_id=? AND case_id=? AND kind='workflow' ORDER BY created_at,rowid",
        (plan["id"], task["case_id"]),
    ):
        value = _load(event["note"], {})
        if value.get("reason") in {"confirm_submission", "legacy_status"} and value.get("newStage") == "in_progress":
            return value.get("details")
    return None


def _apply_task_workflow(connection, plan, task, query, policy_id, body, now):
    _revision(body, task)
    requirements = _task_requirements(task)
    workflow = requirements.setdefault("workflow", {})
    old = _task_stage(task["status"], workflow)
    action = _choice(body.get("action"), {"start_preparation", "review_submission", "confirm_submission",
                                          "record_result", "pause", "resume", "correct_result"}, "请选择办理操作。")
    _require(action in _task_workflow_actions(old), "当前办理阶段无法执行这项操作。", "status_transition", 409)
    stage, details = old, None
    if action == "start_preparation":
        stage = "preparing"
    elif action == "review_submission":
        _require(body.get("requirementsConfirmed") is True, "请先核对当前条件、材料和受理信息。")
        checklist = _submitted_snapshot(connection, plan, task, policy_id, now)
        details = {"at": now, **checklist}
        workflow["review"] = details
        if old != "needs_supplement":
            stage = "ready_to_submit"
    elif action == "confirm_submission":
        _require(body.get("submitted") is True, "只有实际提交后才能确认。")
        checklist = _submitted_snapshot(connection, plan, task, policy_id, now)
        details = {**_submission_record(body, now), "review": {"at": now, **checklist}}
        if old == "needs_supplement":
            workflow.pop("outcome", None)
            first = _first_submission_event(connection, plan, task)
            workflow.setdefault("firstSubmission", first or workflow.get("submission"))
            workflow["latestSupplement"] = details
        else:
            workflow["firstSubmission"] = details
            workflow["submission"] = details
        stage = "in_progress"
    elif action == "record_result":
        result = _choice(body.get("result"), RESULT_STAGES, "请选择实际办理结果。")
        reply = _text(body.get("officialReply", ""), "请核对官方答复字数。", 800, required=False)
        note = _text(body.get("note", ""), "请填写办理结果或实际原因。", 800, required=False)
        _require(result == "waiting" or note or reply, "请填写实际结果、原因或官方答复。")
        details = {"result": result, "note": note, "officialReply": reply, "source": "user_record",
                   "resultDate": _optional_date(body, "resultDate", "请核对实际结果日期。"), "at": now}
        workflow["outcome"] = details
        stage = RESULT_STAGES[result]
    elif action == "correct_result":
        _require(body.get("correctionConfirmed") is True, "请确认更正当前结果。")
        explanation = _text(body.get("correctionReason"), "请填写更正原因。", 800)
        details = {"correctionReason": explanation, "previousOutcome": workflow.get("outcome")}
        workflow.pop("outcome", None)
        stage = "in_progress" if workflow.get("submission") else "preparing"
    elif action == "pause":
        workflow["resumeStage"] = old
        stage = "paused"
    elif action == "resume":
        stage = workflow.pop("resumeStage", "pending")
    workflow["stage"] = stage
    _save_task_requirements(connection, task, requirements, now, STAGE_STATUSES[stage])
    _workflow_event(connection, task, plan, query, old, stage, action, now, details)


def _update_status(connection, case, query, plan, task, body, now):
    _revision(body, case)
    status = _choice(body.get("status"), STATUSES, "请选择处理状态。")
    old = task["status"] if task is not None else case["status"]
    if task is not None and "expectedTaskRevision" in body:
        _revision({"expectedRevision": body["expectedTaskRevision"]}, task)
    if status == old:
        return
    note = None
    if task is not None:
        requirements = _task_requirements(task)
        workflow = requirements.setdefault("workflow", {})
        _require("stage" not in workflow, "请使用当前任务的提交及结果记录。", "workflow_required", 409)
        _require(status in TASK_TRANSITIONS[old], "请按任务当前状态选择下一步。", "status_transition", 409)
        details = None
        if status == "applicable":
            _require(body.get("submitted") is True, "只有实际提交后才能确认。", "submission_confirmation_required", 409)
            _require(body.get("requirementsConfirmed") is True, "请先核对当前条件、材料和受理信息。")
            details = {**_submission_record(body, now),
                       "review": {"at": now, **_submitted_snapshot(
                           connection, plan, task, case["policy_id"], now, require_ready=True)}}
            workflow["submission"] = details
        if status == "completed":
            note = _text(body.get("result"), "请填写实际办理结果。", 800)
            _require(body.get("requirementsConfirmed") is True, "请先确认办理条件和材料要求已经核对。")
            _require(all(row["state"] == "ready" for row in _task_materials(connection, plan, task, case["policy_id"])
                         if row["verified"]), "请先准备政策明确列出的必要材料。", "materials_required", 409)
            details = {"result": "completed", "note": note, "officialReply": "", "source": "user_record",
                       "resultDate": "", "at": now}
            workflow["outcome"] = details
        _save_task_requirements(connection, task, requirements, now, status)
        _workflow_event(connection, task, plan, query, LEGACY_STAGES[old], LEGACY_STAGES[status], "legacy_status", now, details)
    else:
        connection.execute("UPDATE cases SET status=?,revision=revision+1,updated_at=? WHERE id=?", (status, now, case["id"]))
    _event(connection, case["id"], query, "status", status, now, plan["id"] if plan else None, note)


def _prepare(connection, scope, plan, task, policy_id, body, now):
    key = _text(body.get("key", "ready"), "准备事项无效。", 150)
    checked = body.get("checked")
    _require(type(checked) is bool, "请选择准备状态。")
    if key.startswith("material:"):
        _require(not any(row["ref"] == key and row["key"] in _task_requirements(task).get("materials", {})
                         for row in _task_materials(connection, plan, task, policy_id) if row.get("ref")),
                 "请使用新的逐项材料清单。", "material_conflict", 409)
    if key != "ready":
        evidence = action_plan.generate({"region": scope["region"], "policy_ids": [policy_id]}, analyze=False)["policies"][0]
        allowed = {f"condition:{index}" for index in range(len(evidence["conditions"]))}
        allowed.update(row["ref"] for row in evidence["materials"] if row["verified"])
        _require(key in allowed, "未找到该准备事项。", "not_found", 404)
    current = connection.execute("SELECT * FROM preparations WHERE task_id=? AND evidence_key=?", (task["id"], key)).fetchone()
    _revision(body, current)
    connection.execute(
        """INSERT INTO preparations(id,task_id,evidence_key,checked,created_at,updated_at) VALUES(?,?,?,?,?,?)
           ON CONFLICT(task_id,evidence_key) DO UPDATE SET checked=excluded.checked,
           revision=preparations.revision+1,updated_at=excluded.updated_at""",
        (str(uuid4()), task["id"], key, int(checked), now, now),
    )


def generate_plan_advice(payload):
    with transaction() as connection:
        plan = _plan(connection, payload.get("planId"))
        _member(connection, plan["member_id"])
        _revision(payload, plan)
        ids = _plan_view(connection, plan)["progress"]["ids"]
        _require(len(ids) >= 2, "请先在计划中保留至少两项政策。")
    result = action_plan.generate({"region": plan["region"], "policy_ids": ids})
    result["followupProof"] = _proof([plan["id"], plan["revision"], plan["region"], sorted(ids), result])
    return result


def _command(connection, body, now):
    kind = _choice(body.get("type"), {"intent", "batch", "createPlan", "consult", "status", "prepared", "material",
                                      "advice", "task", "memberUpdate", "memberArchive", "favorite",
                                      "consultationSource", "consultContact", "condition", "workflow", "planPause"}, "不支持该操作。")
    if kind == "consultationSource":
        return _update_consultation_source(connection, body)
    if kind == "favorite":
        return _set_favorite(connection, body, now)
    if kind in {"memberUpdate", "memberArchive"}:
        return _update_member(connection, body, now, archive=kind == "memberArchive")
    if kind == "createPlan":
        plan_id = _create_plan(connection, body, now)
        return {"planId": plan_id, "data": _plan_view_context(connection, _plan(connection, plan_id))}
    plan = _plan(connection, body["planId"]) if body.get("planId") else None
    query_id = body.get("queryId") or (plan["query_id"] if plan else None)
    query = _query(connection, query_id) if query_id else None
    if query is not None and (plan is None or kind in {"intent", "batch"}):
        _history(connection, query)
    scope = plan if plan is not None else query
    _require(scope is not None, "请先选择有效查询或计划。")
    _member(connection, scope["member_id"])
    _require(body.get("memberId", scope["member_id"]) == scope["member_id"],
             "未找到该成员的办理记录。", "not_found", 404)
    if plan is not None and query is not None:
        _require(all(plan[key] == query[key] for key in ("user_id", "member_id", "region")),
                 "该计划与本次查询的成员或地区不一致。")
    if kind == "planPause":
        _require(plan is not None and body.get("memberId") == plan["member_id"], "请选择成员计划。")
        _revision(body, plan)
        paused = body.get("paused")
        _require(type(paused) is bool and paused != (plan["paused_at"] is not None), "计划状态已变化。", "status_transition", 409)
        reason = _text(body.get("reason", ""), "请核对暂停原因。", 500, required=False)
        connection.execute("UPDATE plans SET paused_at=?,pause_reason=?,revision=revision+1,updated_at=? WHERE id=?",
                           (now if paused else None, reason if paused else None, now, plan["id"]))
        return {"data": _plan_view_context(connection, _plan(connection, plan["id"]))}
    if plan is not None and plan["paused_at"] is not None:
        _require(False, "请先恢复这份计划。", "plan_paused", 409)
    if kind in {"intent", "batch"}:
        _require(query is not None, "请先完成本次查询。")
        entries = body.get("entries") if kind == "batch" else [body]
        _require(isinstance(entries, list) and 0 < len(entries) <= 32, "请选择要保存的处理意向。")
        seen = set()
        for entry in entries:
            policy_id = _text(_object(entry).get("policyId"), "请选择政策。", 80)
            _require(policy_id not in seen, "同一政策只能选择一次。")
            seen.add(policy_id)
            _intent(connection, query, query, entry, now, from_batch=kind == "batch")
        data = _query_view(connection, query)
        response = {"data": data}
        if kind == "batch":
            response["batch"] = {"id": body["operationId"], "queryId": query["id"],
                                 "memberId": query["member_id"], "region": query["region"],
                                 "entries": [{"policyId": entry["policyId"], "intent": entry["intent"],
                                              "name": data["items"][entry["policyId"]]["name"]} for entry in entries]}
        return response
    if kind == "advice":
        _require(plan is not None, "请选择少跑腿计划。")
        _revision(body, plan)
        view = _plan_view(connection, plan)
        ids = sorted(view["progress"]["ids"])
        advice = _object(body.get("advice")).copy()
        proof = advice.pop("followupProof", "")
        _require(isinstance(proof, str) and proof.isascii() and hmac.compare_digest(
            proof, _proof([plan["id"], plan["revision"], plan["region"], ids, advice])),
                 "协同依据已变化，请重新核对。", "advice_conflict", 409)
        try:
            version = action_plan.generate({"region": plan["region"], "policy_ids": ids}, analyze=False)["evidenceVersion"]
        except (DeepSeekError, OSError, ValueError, KeyError):
            raise FollowupError(409, "advice_conflict", "当前办理依据无法核对，未保存。") from None
        _require(advice["evidenceVersion"] == version, "政策办理依据已更新，请重新核对。", "advice_conflict", 409)
        if plan["advice_json"] != _json(advice):
            connection.execute("UPDATE plans SET advice_json=?,revision=revision+1,updated_at=? WHERE id=?",
                               (_json(advice), now, plan["id"]))
        return {"data": _plan_view_context(connection, _plan(connection, plan["id"]))}
    policy_id = _text(body.get("policyId"), "请选择政策。", 80)
    case = _case(connection, scope, policy_id)
    _require(case is not None, "未找到当前成员的这项政策记录。", "not_found", 404)
    task = connection.execute("SELECT * FROM plan_tasks WHERE plan_id=? AND case_id=?", (plan["id"], case["id"])).fetchone() if plan else None
    if "taskId" in body:
        _require(task is not None and body["taskId"] == task["id"], "未找到对应任务。", "not_found", 404)
    if kind in {"condition", "workflow", "consultContact"}:
        _require(task is not None and body.get("taskId") == task["id"] and body.get("memberId") == scope["member_id"],
                 "请选择当前成员的办理任务。", "not_found", 404)
    task_query = _task_requirements(task).get("queryId") if task is not None else None
    if task_query is not None:
        query = _query(connection, task_query)
    if kind == "task":
        _require(plan is not None, "请选择少跑腿计划。")
        action = _choice(body.get("action"), {"add", "remove", "restore"}, "不支持该任务操作。")
        _revision(body, task if action != "add" else plan)
        if action == "add":
            _require(task is None, "这项任务已在计划中。", "task_exists", 409)
            _, requirements, source_id = _plan_source(connection, scope, None, policy_id)
            _insert_task(connection, plan["id"], case, requirements, source_id, now)
            connection.execute("INSERT OR IGNORE INTO query_plan_sources VALUES (?,?)", (plan["id"], source_id))
        else:
            _require(task is not None, "未找到计划任务。", "not_found", 404)
            if action == "restore":
                _active_case(connection, scope, query, policy_id)
            connection.execute("UPDATE plan_tasks SET removed_at=?,revision=revision+1,updated_at=? WHERE id=?",
                               (now if action == "remove" else None, now, task["id"]))
        connection.execute("UPDATE plans SET advice_json=NULL,revision=revision+1,updated_at=? WHERE id=?", (now, plan["id"]))
    else:
        _require((not plan or task is not None and task["removed_at"] is None) and case["intent"] == "verify",
                 "该政策已离开当前待核实清单。", "not_in_queue", 409)
        if kind == "status":
            _update_status(connection, case, query, plan, task, body, now)
        if kind == "material":
            _require(task is not None, "请选择计划任务。")
            _update_material(connection, plan, task, query, policy_id, body, now)
        if kind == "condition":
            _save_condition(connection, plan, task, query, policy_id, body, now)
        if kind == "workflow":
            _apply_task_workflow(connection, plan, task, query, policy_id, body, now)
        if kind == "consultContact":
            _revision(body, task)
            requirements = _task_requirements(task)
            requirements["consultationContact"] = {"at": now, "source": "user_record"}
            _save_task_requirements(connection, task, requirements, now, task["status"])
        if kind == "consult":
            consultation_id = _consultation(connection, scope, query, plan, task, case, body, now)
        if kind == "prepared":
            _require(task is not None, "请选择计划任务。")
            _prepare(connection, scope, plan, task, policy_id, body, now)
    data = _plan_view_context(connection, _plan(connection, plan["id"])) if plan else _query_view(connection, query)
    return {"data": data, **({"consultationId": consultation_id} if kind == "consult" else {})}


def _dispatch(method, path, body, match=None):
    if method == "GET":
        with transaction() as connection:
            if path == "/api/followup/favorites":
                return _favorites(connection, body)
            if path == "/api/followup/queries":
                return _query_list(connection, body)
            if path in ("/api/followup/members", "/api/followup/overview"):
                members = [_member_view(row) for row in connection.execute(
                    "SELECT * FROM members WHERE user_id=? ORDER BY created_at,id", (principal.get()[0],))]
                if path.endswith("/members"):
                    return {"members": members}
                member_id = _uuid(body.get("memberId", principal.get()[1]))
                return {**_projection(connection, member_id), "members": members}
            resource, _, identifier = path.rpartition("/")
            if identifier == "rule-admission" and resource.startswith("/api/followup/queries/"):
                query_id = resource.removeprefix("/api/followup/queries/")
                _require("/" not in query_id, "未找到该后续服务接口。", "not_found", 404)
                return _rule_admission(connection, _query(connection, query_id), body.get("memberId"))
            if resource == "/api/followup/batches":
                return _batch_view(connection, identifier)
            if resource == "/api/followup/queries":
                query = _scoped_query(connection, identifier, body)
                _history(connection, query)
                return _query_view(connection, query)
            if resource == "/api/followup/query-history":
                attempt = body.get("attempt")
                _require(attempt is None or isinstance(attempt, str) and attempt.isascii()
                         and attempt.isdigit() and 0 < len(attempt) <= 8, "分析编号无效。")
                return _history_view(connection, _scoped_query(connection, identifier, body), int(attempt) if attempt else None)
            if resource == "/api/followup/plans":
                plan = _plan(connection, identifier)
                _require(body.get("memberId", plan["member_id"]) == plan["member_id"], "未找到该成员的计划。", "not_found", 404)
                if "queryId" in body:
                    query = _scoped_query(connection, body["queryId"], {"memberId": plan["member_id"]})
                    _require(query["region"] == plan["region"] and connection.execute(
                        "SELECT 1 FROM query_plan_sources WHERE plan_id=? AND query_id=?",
                        (plan["id"], query["id"])).fetchone() is not None,
                        "计划与指定查询不一致。", "query_scope_conflict", 409)
                return _plan_view_context(connection, plan)
            if resource == "/api/followup/consultations":
                row = _consultation_row(connection, identifier, body.get("memberId"))
                return {"consultation": {**_consultation_view(row), "policyName": row["policy_name"],
                                         "memberName": row["member_name"]}}
    if method == "POST":
        operations = {"/api/followup/members": _make_member,
                      "/api/followup/queries": lambda db, value, now: _make_query(db, value, now, match),
                      "/api/followup/query-history/archive": _archive_query, "/api/followup/commands": _command}
        if path in operations:
            operation_id = _uuid(body.get("operationId"), "请提供有效的操作编号。")
            digest = hashlib.sha256(_json([path, body]).encode("utf-8")).hexdigest()
            with transaction(write=True) as connection:
                old = connection.execute("SELECT * FROM operations WHERE user_id=? AND operation_id=?",
                                         (principal.get()[0], operation_id)).fetchone()
                if old is not None:
                    _require(digest == old["request_hash"], "该操作编号已用于不同内容。", "idempotency_conflict", 409)
                    if path.endswith("/queries") or (path.endswith("/commands") and body.get("queryId")
                                                       and not body.get("planId") and body.get("type") != "createPlan"):
                        _history(connection, _query(connection, body.get("queryId")))
                    return _load(old["response_json"])
                now = _now()
                result = operations[path](connection, body, now)
                connection.execute("INSERT INTO operations VALUES(?,?,?,?,?)",
                                   (principal.get()[0], operation_id, digest, _json(result), now))
                return result
    raise FollowupError(404, "not_found", "未找到该后续服务接口。")


def dispatch(method, path, body, match=None):
    try:
        return _dispatch(method, path, body, match)
    except sqlite3.OperationalError as error:
        if (getattr(error, "sqlite_errorcode", 0) & 0xFF) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
            raise FollowupError(503, "database_busy", "记录暂忙，请重试本次操作。") from error
        raise
    except sqlite3.IntegrityError as error:
        raise FollowupError(409, "integrity_conflict", "记录关系已变化，操作未保存。请重新读取。") from error
