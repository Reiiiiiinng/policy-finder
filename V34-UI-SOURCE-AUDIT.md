# V3.4 UI 来源审计

审计基线为 `9edd23c3dbf43273de58c15b0e6e07b5fc18e14d`。GitHub 和原 V3.4 工作区的分支头一致，原工作区干净。

| 来源 | 实际范围 | 结论 |
| --- | --- | --- |
| [codex/v33-plan-visual](https://github.com/Reiiiiiinng/policy-finder/tree/codex/v33-plan-visual) | 分支头 `826e972a44f1`，末次 UI 提交 `97744415001b`。与 V3.4 的共同祖先为 `85718fe`，候选领先 7 个提交，落后 V3.4 的 3 个提交。 | 视觉覆盖最完整。有实现源码、17 页同输入对照与 18 步巡查。开发侧 QA 已通过，产品负责人整体验收待确认。 |
| 原工作区及 `theme-cb` | 实际检出 `merge/theme-partner`，与本地和远程跟踪的 `theme-cb` 一致，均为 `0a864cccc9db`。原工作区与自身 HEAD 无已跟踪改动。 | 10 月的 B 版前端。首页、家庭选择、发现、详情、本人模式、咨询有历史验收记录。报告写明对文本、人像、导航和返回链进行了实际测试，未找到明确的产品负责人签收记录。 |
| 其他未提交内容 | 原工作区有 5 个 `frontend/_*.html` 和 3 个 `_*-preview.css`，以及多套 `.ui-shots`。另有 `design-lab/skill-study-20261027`、`proto-3pages-20261029`、`v3.3-trip-review/evidence/references`。 | v6 变体、规范适配和三页 HTML 是设计预览。V3.3 参考图对照实现截图，不能单独证明实现或签收。 |
| V3.4 现有文件与工作副本 | 已有家庭输入、分析、推荐、权益集中核对／完成、少跑腿计划各分步、咨询、家庭成员与历史。V3.4 相对共同祖先修改 10 个前端文件。 | 保留 2px 推荐描边、真实政策数据、行动状态投影、政策详情及官方渠道、搜索意图与真实分析逻辑。现有计划与成员历史的布局尚未吸收候选后续视觉。 |

### 页面与依赖

- 首页已有高保真 B 版，候选仅做文案换行、标识和控件一致性。保留原首页结构和素材。
- AI 发现、家庭输入、分析和推荐已有 V3.4 流程。候选补充统一图标、焦点、表单和详情视觉。共享分析脚本既渲染页面也负责草稿、追问、状态和 API，须逐块比对。
- 集中核对与完成使用 V3.4 的选中状态、服务端核对结果和行动信息。沿用渲染及数据绑定，检查候选样式是否与 V3.4 描边或底部行动区冲突。
- 少跑腿计划新视觉含现有任务、真实进度与四步路线。条件、材料、渠道、咨询记录和进度的 V3.4 数据与动作由 `followup-page.js` 共用，计划 UI 需与该脚本同步选入。
- 咨询候选重排信息结构，V3.4 加有真实佛山渠道。政策详情需同时核对来源、动态渠道与收藏选人返回。
- 我的、成员及历史候选有可运行实现。保留成员作用域、记录查看和删除确认，验证计划恢复。

### 截图证据

- [候选 17 页前后对照](https://github.com/Reiiiiiinng/policy-finder/tree/826e972a44f14e2360f3245a15001b8df0b539c8/docs/design-process/initial-final-20261116)
- [候选开发侧巡查与确认范围](https://github.com/Reiiiiiinng/policy-finder/blob/826e972a44f14e2360f3245a15001b8df0b539c8/docs/design-process/full-review-20261116/audit.md)
- [原 B 版验收截图](evidence/audit/theme-cb-result-390.png) · [V3.4 基线推荐截图](evidence/audit/v34-baseline-result-390.png)
- [候选推荐](evidence/audit/04-results-final.jpg) · [候选计划](evidence/audit/06-plan-final.jpg) · [候选历史](evidence/audit/17-history-final.jpg)
- [候选相对 V3.3 的前端差异](evidence/audit/candidate-vs-v33.diff) · [候选与 V3.4 前端差异统计](evidence/audit/candidate-vs-v34-stat.txt)

### 候选 UI 文件差异

相对共同祖先 `85718fe`，UI 文件差异如下。文档头提交只补图文说明与离线报告。

| 文件 | 状态 | 增 | 删 |
| --- | --- | ---: | ---: |
| `frontend/analysis.html` | modified | 2 | 0 |
| `frontend/assets/ai-flow-polish.css` | added | 165 | 0 |
| `frontend/assets/brand-mark.svg` | added | 1 | 0 |
| `frontend/assets/consult-guide.css` | added | 77 | 0 |
| `frontend/assets/family-records-polish.css` | added | 82 | 0 |
| `frontend/assets/followup-page.js` | modified | 83 | 27 |
| `frontend/assets/history-polish.css` | added | 60 | 0 |
| `frontend/assets/home-hifi.css` | modified | 1 | 1 |
| `frontend/assets/home-hifi.js` | modified | 22 | 1 |
| `frontend/assets/household-analysis.js` | modified | 22 | 7 |
| `frontend/assets/mine-business.js` | modified | 7 | 4 |
| `frontend/assets/navigation-policy.js` | modified | 1 | 1 |
| `frontend/assets/plan-family-v2.webp` | added | 0 | 0 |
| `frontend/assets/plan-overview.css` | added | 135 | 0 |
| `frontend/assets/policy-detail-polish.css` | added | 357 | 0 |
| `frontend/assets/query-history-page.js` | modified | 93 | 14 |
| `frontend/assets/ui-foundation.css` | added | 26 | 0 |
| `frontend/consult.html` | modified | 46 | 22 |
| `frontend/discover.html` | modified | 1 | 1 |
| `frontend/discovery-c.html` | modified | 1 | 1 |
| `frontend/find.html` | modified | 51 | 6 |
| `frontend/follow-up.html` | modified | 2 | 1 |
| `frontend/index.html` | modified | 3 | 4 |
| `frontend/mine.html` | modified | 1 | 1 |
| `frontend/original-home.html` | modified | 1 | 1 |
| `frontend/plan.html` | modified | 1 | 1 |
| `frontend/policy.html` | modified | 102 | 41 |
| `frontend/query-history.html` | modified | 21 | 8 |
| `frontend/records.html` | modified | 1 | 1 |
| `frontend/search.html` | modified | 1 | 1 |
| `frontend/self.html` | modified | 1 | 1 |
| `frontend/services.html` | modified | 1 | 1 |
| `frontend/verify-list.html` | modified | 1 | 1 |
