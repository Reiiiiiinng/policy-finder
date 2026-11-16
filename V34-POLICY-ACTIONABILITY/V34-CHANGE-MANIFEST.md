# 变更、分支及预览

- 基线为 `85718fec0b1a55a71b95275435f1d609afba0149`，GitHub 比对确认 `feature/v3.3-latest` 指向同一提交。
- 本地分支 `feature/v3.4-policy-actionability` 位于 `D:/Codex/policy-finder/v3.4-policy-actionability`。原 V3.3 验收目录没有 Git 元数据，已有未提交文件及历史数据库保留在原目录。
- [本地人工验收](http://127.0.0.1:28768/) 使用回环地址和新建隔离库，接入真实 DeepSeek 与 CleverSee。请使用合成描述。另可访问[模拟 AI 预览](http://127.0.0.1:28766/)。
- 没有推送、部署、编辑凭据或迁移历史库。仅将软件和报告纳入本地 Git 提交。截图、运行证据和数据库留在本地。

## 代码与测试文件

- `backend/action_plan.py`
- `backend/cleversee.py`
- `backend/followup_api.py`
- `backend/household_analysis.py`
- `backend/policy_engine.py`
- `backend/semantic_discovery.py`
- `data/foshan_medical_assistance_v1.json`
- `frontend/analysis.html`
- `frontend/assets/followup-page.js`
- `frontend/assets/household-analysis.css`
- `frontend/assets/household-analysis.js`
- `frontend/assets/policy-actionability.js`
- `frontend/assets/policy-search.js`
- `frontend/follow-up.html`
- `frontend/policy.html`
- `preview.py`
- `tests/edge_remediation.mjs`
- `tests/preview_regression.py`
- `tests/preview_trip.py`
- `tests/test_cleversee.py`
- `tests/test_matching_p0.py`
- `tests/test_v32.py`

## 交付

六份专题报告、此清单与 evidence 位于本目录。完整交付副本另存入原 V3.3 验收目录。
