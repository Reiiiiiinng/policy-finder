"""Build traceable, bounded recommendations from policy records."""
from datetime import date
from hashlib import sha256
from itertools import combinations
import json
import re

from deepseek_client import DeepSeekClient, DeepSeekError
import semantic_discovery as evidence


def official_channels(policy):
    """Read only catalogued channels that carry their own official reference."""
    channels = []
    for row in policy.get("channels", []):
        source = evidence._official_url(row.get("source_url"))
        if source and row.get("checked_at") and row.get("name") and row.get("level"):
            channels.append({**row, "source_url": source,
                             "online_url": evidence._official_url(row.get("online_url"))})
    return channels


def _project(policy):
    source = policy.get("source") or {}
    url = evidence._official_url(source.get("official_url"))
    validity = evidence._validity(policy, date.today())
    trusted = (policy.get("verification") or {}).get("status") == "verified" and bool(url) and validity == "active"
    steps = [{"ref": f"step:{i}", "field": f"application_process[{i}].step", "text": row["step"],
              "verified": trusted and row.get("to_verify") is False}
             for i, row in enumerate(policy.get("application_process") or []) if row.get("step")]
    materials = [{"ref": f"material:{i}", "field": f"materials[{i}].item", "text": row["item"],
                  "clause": row.get("source_ref"), "verified": trusted and bool(row.get("source_ref"))
                  and not row.get("to_verify") and not any(word in row["item"] for word in ("未列明", "以实际", "待核实"))}
                 for i, row in enumerate(policy.get("materials") or []) if isinstance(row, dict) and row.get("item")]
    conditions = [{"field": f"conditions.qualify[{i}]", "text": row.get("requirement") or row["label"],
                   "label": row.get("label"), "clause": row.get("source_ref"),
                   "verified": trusted and bool(row.get("source_ref")) and not row.get("to_verify")}
                  for i, row in enumerate((policy.get("conditions") or {}).get("qualify", []))
                  if row.get("requirement") or row.get("label")]
    audiences = [{"field": f"target_people[{i}]", "text": text}
                 for i, text in enumerate(policy.get("target_people") or [])]
    places = [row for row in steps if any(term in row["text"] for term in ("机构", "街道", "乡镇", "窗口"))]
    deadlines = [row for row in steps if re.search(r"[0-9一二三四五六七八九十]+\s*(个工作日|工作日|日内|天内|个月内)", row["text"])]
    prerequisites = [row for row in steps if row["text"].startswith("先") or "无需另行办理参保手续" in row["text"]]
    missing = list(policy.get("missing_information") or [])
    if not trusted:
        missing.append("政策来源或时效需要核实")
    if not any(row["verified"] for row in places):
        missing.append("受理机构或办理地点需要核实")
    missing.append("具体地址、预约及出行时间需要核实")
    if not any(row["verified"] for row in deadlines):
        missing.append("办理时限需要核实")
    if not any(row["verified"] for row in materials):
        missing.append("具体收件材料需要核实")
    if not any(row["verified"] for row in steps):
        missing.append("办理流程需要核实")
    return {
        "id": policy["policy_id"], "name": policy["policy_name"], "region": policy["region"]["scope"],
        "source": {"department": source.get("department"), "document_no": source.get("document_no"),
                   "document": source.get("document"), "url": url},
        "validity": validity, "audiences": audiences, "eligibility": conditions, "locations": places,
        "deadlines": deadlines, "prerequisites": prerequisites, "missing": missing,
        "conditions": policy.get("missing_information") or [], "steps": steps, "materials": materials,
        "trusted": trusted, "channels": official_channels(policy) if trusted else [],
    }


def _channel(text):
    if (not any(term in text for term in ("非即时结算", "未能享受", "不能", "不得", "不实行", "无法"))
            and ("即时结算" in text or ("一站式" in text and "结算" in text))
            and ("医药机构" in text or "定点医疗机构" in text)):
        return "settlement"
    if (("街道办事处" in text or "乡镇人民政府" in text)
            and any(word in text for word in ("提出", "申请", "审核"))):
        return "local_application"
    return None


def _names_program(text, policy):
    return policy["name"] in text or any(program in policy["name"] and program in text
                                      for program in ("大病保险", "医疗救助"))


def _options(left, right):
    options = {}
    for a in left["steps"]:
        for b in right["steps"]:
            if not a["verified"] or not b["verified"]:
                continue
            channels = _channel(a["text"]), _channel(b["text"])
            joint = (("一站式" in a["text"] and _names_program(a["text"], right)) or
                     ("一站式" in b["text"] and _names_program(b["text"], left)))
            independent = ("单独申请", "分别申请", "必须分别办理", "独立审批")
            if channels == ("settlement", "settlement") and joint:
                kind, stage = "coordinate", "在符合条件的定点机构核对一站式结算"
            elif set(channels) == {"settlement", "local_application"}:
                kind, stage = "separate", "街道申请或认定与机构结算分别办理"
            elif all(any(word in row["text"] for word in independent)
                     and not any(word in row["text"] for word in ("无需", "无须", "不必", "不需要", "可合并"))
                     for row in (a, b)):
                kind, stage = "separate", "按各政策要求独立申请或审批"
            else:
                continue
            options.setdefault(kind, {"kind": kind, "stage": stage, "left": a, "right": b})
    return list(options.values())


def _dependencies(left, right):
    result = []
    categories = ("最低生活保障边缘家庭", "支出型困难家庭")
    for dependent, authority in ((left, right), (right, left)):
        for before in dependent["prerequisites"]:
            for decision in authority["steps"]:
                if (before["verified"] and decision["verified"] and "审核确认决定" in decision["text"]
                        and any(term in before["text"] and term in decision["text"] for term in categories)):
                    result.append({"policyId": dependent["id"], "prerequisitePolicyId": authority["id"],
                                   "condition": before, "decision": decision})
    return result


def _same_rows(left, right, field, key):
    return [{"left": a, "right": b} for a in left[field] for b in right[field]
            if a["verified"] and b["verified"] and a.get(key) and a[key] == b.get(key)]


def _choices(pairs):
    client = DeepSeekClient.from_env(timeout=25)
    choices = []
    for offset in range(0, len(pairs), 24):
        batch = pairs[offset:offset + 24]
        result = client.chat_json([
            {"role": "system", "content": "依据政策库已核验的办理环节，为每对政策选择已有选项的索引。"
             "同一部门、地点、共同条件或材料本身均不能证明合并。协同只限选项标明的具体环节。"
             "街道申请/认定和定点机构结算是不同办理程序。有街道提交与机构结算两条原文时，选择分别办理选项。"
             "选项是经服务端检查的原文依据。只有 options 为空，或多个选项且无法选定时才选 null。"
             "单个选项应返回 0。严禁自行创造证据、地点、时限或材料。"
             '按输入顺序为每一对输出一行，只返回 JSON {"choices":[{"pair":0,"option":null}]}，'
             "pair 是本批从零起的索引，必须完整且不能重复。"},
            {"role": "user", "content": json.dumps({"pairs": batch}, ensure_ascii=False)},
        ], max_tokens=1800)
        rows = result.get("choices")
        if not isinstance(rows, list) or len(rows) != len(batch):
            raise DeepSeekError("INVALID_ANALYSIS", "协同判断缺少必要结果，未保存，请重试。")
        selected = {}
        for row in rows:
            if not isinstance(row, dict) or set(row) != {"pair", "option"}:
                raise DeepSeekError("INVALID_ANALYSIS", "协同判断格式无法核验，未保存，请重试。")
            index, option = row["pair"], row["option"]
            if (type(index) is not int or not 0 <= index < len(batch) or index in selected
                    or (option is not None and (type(option) is not int or not 0 <= option < len(batch[index]["options"])))):
                raise DeepSeekError("INVALID_ANALYSIS", "协同判断引用不存在的依据，未保存，请重试。")
            selected[index] = option
        choices.extend(selected[i] for i in range(len(batch)))
    return choices


def generate(payload, analyze=True):
    if not isinstance(payload, dict) or not isinstance(payload.get("region"), str) or payload["region"] not in evidence.REGIONS:
        raise DeepSeekError("INVALID_INPUT", "请选择当前查询地区。")
    ids = payload.get("policy_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= 32 or not all(isinstance(pid, str) for pid in ids):
        raise DeepSeekError("INVALID_INPUT", "请选择 1 至 32 项政策。")
    catalogue = {row["policy_id"]: row for row in evidence._catalog(payload["region"])
                 if row["region"]["scope"] == payload["region"]}
    if any(pid not in catalogue for pid in ids):
        raise DeepSeekError("INVALID_INPUT", "计划中包含当前地区未收录的政策。")
    policies = [_project(catalogue[pid]) for pid in sorted(set(ids))]
    version = sha256(json.dumps(policies, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    policy_pairs = list(combinations(policies, 2))
    pairs = [{"ids": [a["id"], b["id"]], "options": _options(a, b)} for a, b in policy_pairs]
    model_used = bool(analyze and pairs)
    choices = _choices(pairs) if model_used else [None] * len(pairs)
    assessments = []
    for (left, right), pair, option in zip(policy_pairs, pairs, choices):
        proof = pair["options"][option] if option is not None else None
        decision = "model" if proof else "pending"
        if model_used and proof is None and [item["kind"] for item in pair["options"]] == ["separate"]:
            proof, decision = pair["options"][0], "verified_independent_procedure"
        assessments.append({"ids": pair["ids"], "kind": proof["kind"] if proof else "pending", "evidence": proof,
                            "decision": decision,
                            "common_materials": _same_rows(left, right, "materials", "text"),
                            "common_prerequisites": _same_rows(left, right, "eligibility", "label"),
                            "dependencies": _dependencies(left, right),
                            "source_departments": [left["source"]["department"], right["source"]["department"]]})
    return {"format": "coordination.v2", "evidenceVersion": version, "policies": policies,
            "assessments": assessments, "model_used": model_used}
