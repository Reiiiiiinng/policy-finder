"""
日期字段规范的单元测试（不联网、不读数据文件，只测规则本身）。

    python .tools/datespec-test.py

为什么单独一个测试：
  datacheck.py 只能告诉你「现有数据是否符合规范」，它无法证明规则本身没收窄
  也没被放水 —— 把断言全部放宽成 `bool(pub)` 也会让十个条目全绿。这个文件用
  构造出来的用例把规则的两端都钉住：

    - 已核验条目：只到年/月 ⇒ 必须判失败（比旧规则更严，旧规则只看格式）
    - 待核验条目：只到年/月 + 有备注 ⇒ 通过；没有备注 ⇒ 失败
    - 空发布日期：仅当有备注说明原因时通过
    - 成文日期：可选；填了必须是 YYYY-MM-DD，且不得晚于发布日期

规则实现复用 datacheck.publish_date_rule / document_date_rule，
避免测试与校验脚本各写一份而互相漂移。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import datacheck  # noqa: E402

NOTE = "官方页面只标注到年份，尚未取得日级发布日期，暂记年份并保持待核验。"

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   %s" % name)
    else:
        FAIL += 1
        print("  FAIL %s %s" % (name, detail))


def pol(pub=None, doc=None, status="verified", note=""):
    src = {"publish_date": pub if pub is not None else ""}
    if doc is not None:
        src["document_date"] = doc
    return {"policy_id": "case", "source": src,
            "verification": {"status": status, "note": note}}


def expect_publish(name, policy, want):
    ok, why = datacheck.publish_date_rule(policy)
    check("%s → %s（%s）" % (name, "通过" if want else "失败", why), ok == want, why)


def expect_doc(name, policy, want):
    ok, why = datacheck.document_date_rule(policy)
    check("%s → %s（%s）" % (name, "通过" if want else "失败", why), ok == want, why)


print("== publish_date：已核验条目必须精确到日 ==")
expect_publish("verified + 2024-03-22", pol("2024-03-22"), True)
expect_publish("verified + 2025（只有年份）", pol("2025"), False)
expect_publish("verified + 2024-09（只有年月）", pol("2024-09"), False)
expect_publish("verified + 空", pol(""), False)
expect_publish("verified + 格式错误 2024/03/22", pol("2024/03/22"), False)
expect_publish("verified + 日历非法 2024-02-31", pol("2024-02-31"), False)

print("\n== publish_date：待核验条目允许部分精度，但必须有备注 ==")
expect_publish("to_verify + 2025 + 备注", pol("2025", None, "to_verify", NOTE), True)
expect_publish("to_verify + 2024-09 + 备注", pol("2024-09", None, "to_verify", NOTE), True)
expect_publish("to_verify + 2025 + 无备注", pol("2025", None, "to_verify", ""), False)
expect_publish("to_verify + 2025 + 备注太短", pol("2025", None, "to_verify", "待补"), False)
expect_publish("to_verify + 空 + 备注", pol("", None, "to_verify", NOTE), True)
expect_publish("to_verify + 空 + 无备注", pol("", None, "to_verify", ""), False)
expect_publish("to_verify + 2024/03/22", pol("2024/03/22", None, "to_verify", NOTE), False)

print("\n== document_date：可选，填了必须合规 ==")
expect_doc("未填", pol("2024-03-22"), True)
expect_doc("2024-03-14 < 2024-03-22", pol("2024-03-22", "2024-03-14"), True)
expect_doc("与发布日期同日 2024-03-22", pol("2024-03-22", "2024-03-22"), True)
expect_doc("晚于发布日期 2024-03-23", pol("2024-03-22", "2024-03-23"), False)
expect_doc("只有年月 2024-03", pol("2024-03-22", "2024-03"), False)
expect_doc("格式错误 2024/03/14", pol("2024-03-22", "2024/03/14"), False)

print("\n== 两条规则的严格度不得被同步放宽 ==")
# 回归护栏：如果哪天有人把规则改成「比旧规则更松」，这里会先红。
loose = pol("2025", None, "verified", NOTE)
ok, _ = datacheck.publish_date_rule(loose)
check("已核验 + 只有年份 + 有备注 仍然失败（不能靠备注蒙过 verified 的日级要求）",
      ok is False, "规则被放水")
strict_still = pol("2024-03-22")
ok, _ = datacheck.publish_date_rule(strict_still)
check("已核验 + 精确日期 仍然通过（不是把所有记录判死）", ok is True, "规则过严")

print("\n通过 %d，失败 %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
