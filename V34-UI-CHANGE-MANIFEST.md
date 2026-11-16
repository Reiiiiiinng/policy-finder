# V3.4 UI 变更清单

| 文件 | 变更 |
| --- | --- |
| `frontend/assets/ui-foundation.css`、`brand-mark.svg` 与页面引用 | 统一焦点、暖白控件、品牌图标和提示位置。 |
| `index.html`、`home-hifi.css/js` | 原首页文字换行、家庭成员选择入口和控件判空。 |
| `find.html`、`analysis.html`、`ai-flow-polish.css`、`household-analysis.js` | 发现入口、成员与本人语境、推荐卡选中效果、查询历史与新建查询入口，复用 V3.4 分析状态。 |
| `policy.html`、`policy-detail-polish.css`、`navigation-policy.js` | 详情阅读布局、原文和官方渠道、效力判定及收藏返回校验。 |
| `follow-up.html`、`followup-page.js`、`plan-overview.css`、`plan-family-v2.webp` | 计划总览和成员卡；其余办理分步持续使用 V3.4 状态和命令。 |
| `consult.html`、`consult-guide.css` | 咨询准备、官方政策目录和已有咨询记录。 |
| `services.html`、`mine.html`、`mine-business.js`、`family-records-polish.css` | 我的服务、成员管理、AI 发现记录和待核实清单。 |
| `query-history.html`、`query-history-page.js`、`history-polish.css` | 成员筛选、查询记录卡、查看、移除确认与取消。 |
| `discover.html`、`discovery-c.html`、`original-home.html`、`plan.html`、`records.html`、`search.html`、`self.html`、`verify-list.html` | 基础样式接入。 |
| `tests/edge_remediation.mjs`、`tests/navigation_return.test.mjs` | 支持折叠表单及暂停管理走查，真实两轮追问和搜索，全站响应检查，以及收藏返回测试。 |

完整清单可通过 `git diff --name-status 9edd23c HEAD` 查看。历史库、原工作区和正式 B 版资源保留在原位置。
