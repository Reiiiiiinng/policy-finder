# 《政策找人》—— AI 赋能公共服务权益发现平台

> 2026 年第九届传智杯 AIGC 多维设计创新挑战赛 · 方向：AI 赋能公共服务 · 主题：绿智共生

## 一、项目定位

**不是**政策搜索网站、**不是**政策问答机器人、**不是** ChatGPT 套壳、**不是**自动审批系统。

核心转变：从「人找政策」到「政策找人」——从用户的生活处境出发，反向发现他可能需要、但从未知晓的公共服务权益。

目标场景：老年人公共服务。家属（如子女）用一句话描述老人的生活变化，系统提示「可能相关」的权益，并明确告知为什么推荐、还需确认什么、去哪里核实。

**四步主流程**：`确认情况 → 发现可能相关政策 → 查看政策依据 → 进一步确认`。两条轴贯穿始终：**家庭协助**（谁在帮谁查、关键信息需受益人确认）与**生活事件**（AI 识别的生活变化可被用户纠正）。每条推荐都能展开**证据链**：依据什么（用户的事实）→ 要求什么（政策的结构化条件）→ 出自哪里（部门 / 文号 / 发布日期 / 核验状态）。

## 二、当前阶段：可运行产品原型

本阶段**不接入大模型、不训练模型**，先把产品骨架与数据层做实：

```
描述生活变化 → 情况确认台（核对事实 / 增删生活事件 / 三值确认硬条件）
             → AI 初步匹配（结果分强相关 / 可能相关 / 待确认）
             → 证据链与政策依据（条件 / 来源 / 办理 / 去哪核实）
             → 进一步确认（用户表态，或回去调整后重新匹配）
```

后续再接 DeepSeek / RAG / Embedding，把当前的关键词画像解析与规则匹配替换掉。

## 三、目录结构

```
.
├── frontend/           移动端页面（原生 HTML/CSS/JS，无构建）
│   ├── index.html      首页：选择帮助对象 + 「怎么用」四步说明
│   ├── family.html     家庭协助页：操作者 ≠ 受益人，确认查询关系
│   ├── discover.html   确认情况 + AI发现（家庭模式）
│   ├── policy.html     政策依据页：六段结构 + 第4步进一步确认
│   ├── self.html       同 discover 的本人模式（称谓为「您」）
│   └── assets/         style.css / app.js
├── backend/            接口与匹配逻辑（Python 标准库，零第三方依赖）
│   ├── server.py       HTTP 服务 + 静态托管 + /api/*
│   └── policy_engine.py 画像解析、规则匹配、证据链、场景库
├── data/               政策数据库
│   ├── guangzhou_elderly_policy_v1.1.json  当前使用
│   └── guangzhou_elderly_policy_v1.json    V1 初版（保留）
├── .tools/             开发期测试脚本（不影响运行时，见第十一节）
└── docs/               项目说明
    ├── README.md
    └── policy-data-notes.md  政策核验记录与待核验清单
```

## 四、启动方式

```bash
# Python 3.9+ 即可，无需 pip install
python backend/server.py
# 打开 http://127.0.0.1:8000
```

服务同时提供静态页面与接口。修改端口：`PORT=8080 python backend/server.py`。

## 五、页面流程

产品主流程分四步，页面顶部常驻流程指示器，让用户始终知道自己在哪一步：

| 步骤 | 页面 | 作用 |
| --- | --- | --- |
| — | 首页 `index.html` | 选择帮助对象（我的父母 / 我的长辈 / 我自己），含「怎么用」四步说明 |
| 1 确认情况 | 家庭协助页 `family.html` | 明确「操作者 ≠ 受益人」，选择查询关系并勾选已向本人核实 |
| 1 确认情况 | 发现页 `discover.html` / `self.html` | 一句话描述生活变化 → **情况确认台**：核对基础事实、增减生活事件 chip、确认户籍/医保/失能 |
| 2 发现可能相关政策 | 同上（结果区） | 结果按「强相关 / 可能相关 / 待确认」分层；每张卡可展开**证据链** |
| 3 查看政策依据 | 详情页 `policy.html` | 六段结构：这是什么 / 为什么推荐（证据链）/ 还需要确认什么 / 去哪里核实 / 怎么办理 / 政策来源 |
| 4 进一步确认 | 同上（页尾） | 用户明确表态：打算去核实 / 先记下来 / 情况不适用；并可回到第1步调整 |

**两条贯穿全流程的轴**：

- **家庭协助轴**：家人代查时，顶部持续显示「谁在帮谁查」关系条与「待本人确认 / 已向本人核实」标记；本人模式下不显示。
- **生活事件轴**：AI 识别出的生活变化以 chip 呈现，**用户可点掉或补上**，纠正结果会写回画像（`confirmed_scenes`）并重新匹配，后续轮次不会被覆盖。

**入口分流规则**：`target = parents / family` → `family.html`（家庭协助模式）；`target = self` → `self.html`（本人模式）。两种模式共用同一套匹配接口与渲染函数，仅称谓与文案不同（`/api/match` 传 `mode: "self"`）。

**详情页回跳定位**：详情页第 4 步的「回去调整生活变化 / 回去补充关键条件」分别跳回 `discover.html?focus=scene` 与 `?focus=cond`，自动滚动并高亮对应区块。

## 六、接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务与数据库状态 |
| GET | `/api/policies` | 政策列表（精简字段） |
| GET | `/api/scenes` | 生活事件库（可带 `?profile=` 标注已识别项） |
| GET | `/api/tiers` | 分层口径说明 |
| GET | `/api/policy/<id>` | 政策详情（含 rag_text） |
| POST | `/api/profile` | 文本 → 老人画像 |
| POST | `/api/match` | 画像/文本 → 可能相关权益列表（含 `evidence`、`tier`、`scene_library`、`tier_summary`） |
| POST | `/api/explain` | 单条政策 → 渲染后的推荐理由 |

示例：

```bash
curl -X POST http://127.0.0.1:8000/api/match \
  -H "Content-Type: application/json" \
  -d '{"text":"我父亲72岁，一个人在广州生活，最近行动不方便。","relation":"父亲","operator":"女儿"}'
```

**人机协同参数**：`/api/match` 的 `profile` 支持 `confirmed_scenes`（数组，replace 语义的最终事件清单）与 `scenes_edited`（标记用户已纠正）。命中时后端回传同样字段，保证前端多轮交互中用户的纠正不被丢弃。

## 七、匹配逻辑（当前为规则引擎）

1. **画像解析**：从文本中抽取年龄（含中文数字）、地区、生活场景标签（独居/行动不便/吃饭困难/需要照护/长期卧床/医疗护理压力/记忆下降/跌倒风险/子女无法陪伴/经济压力）、亲属关系与操作者身份。
2. **硬条件判断（三值）**：年龄门槛、户籍、医保参保、失能状态。`未知 → 转为「待确认」并列出缺口`，`明确不符合 → 不推荐`，`符合 → 保留`。地区不符直接不推荐。
3. **场景打分**：命中 `match.scene_signals` 越多得分越高，叠加政策优先级。
4. **理由生成**：只由画像事实支撑——政策侧表述（`ai_reason`）+ 仅当场景确实命中时才生成的 `scene_reason_map` 条目。**没有任何场景命中时，只保留年龄类理由并强制降权、标为待确认**，杜绝"描述中提到…"式的无依据断言。
5. **证据链派生**（`build_evidence_chain`）：把匹配结果拆成三段，供前端展示与复核——
   - 画像依据：命中的生活事件 + 用户提供的年龄/地区；
   - 政策条件：逐条列出该政策的结构化条件与状态（`met` / `unknown` / `failed`），状态文字是「已确认 / 待确认 / 已确认不符合」，**不出现「符合资格」**；
   - 官方依据：责任部门、文件名、文号、发布时间、核验状态。
   三段内容全部从数据库已有字段派生，**不新增字段、不改写政策表述**；`to_verify` 条目的文件名/文号/链接一律留空。
6. **结果分层**（`assign_tier`）：`强相关`（有场景命中且无关键缺口）/ `可能相关`（有场景命中但有待确认项）/ `待确认`（仅年龄门槛命中）。仅用于展示分组，不改变推荐与否。

## 八、产品红线（不可违反）

1. 系统**不判定资格**，只输出「可能相关 / 待确认 / 待核验」。
2. 文案只用：可能相关、初步匹配、建议确认、待核实。
3. **不编造政策**：政策名称、部门、条件、流程、金额一律以官方公开文件为准。
4. 未知内容一律保留 `to_verify`，页面显式标注「来源待核验」。
5. 金额类信息不写入数据库，只引导用户向主管部门核实本人适用标准。
6. 操作者 ≠ 受益人，关键信息需受益人确认。

## 九、绿色价值（绿智共生）

- 把「多次跑窗口、反复问、重复交材料」压缩为一次线上初步匹配与核实指引。
- 减少因信息不对称导致的往返跑动与纸质材料消耗。
- 不做任何未经证实的碳减排数字宣称。

## 十、下一步

- [ ] 接入 DeepSeek 做生活变化的语义解析（替换关键词画像）
- [ ] 用 `build_rag_text()` 的输出做 Embedding，建立政策向量库
- [ ] 引入 RAG：检索 + 结构化条件双重校验，理由可溯源到原文片段
- [ ] 规则引擎升级为可配置的 DSL，支持多城市扩展
- [ ] 补充 007/008 两条 `to_verify` 政策的一手来源
- [x] 详情页增加「更正信息并重新匹配」入口 → 已实现（回跳定位 + 生活事件纠正 + 关键条件补充）
- [ ] 把「进一步确认」的表态结果接到本地提醒（如「隔周提醒去核实」）

## 十一、测试与回归

改动前先跑基线，改完再跑一遍。以下命令需先启动服务（`python backend/server.py`）。

```bash
python .tools/baseline.py check   # 引擎回归：12 个用例与基线快照逐字段比对
python .tools/apitest.py          # 接口冒烟：41 项（含硬条件三值、to_verify、双模式）
node .tools/render-test.js        # 渲染单测：62 项（vm 里跑 app.js 纯函数）
node .tools/page-check.js         # 页面接线：103 项（内联脚本语法、函数引用、红线文案）
python .tools/e2e.py              # 端到端：驱动本机 Edge 跑完整流程，家庭 38 / 本人 37 项
```

- `baseline.py` 只比对**不应被改动**的部分（结果条数、顺序、status、score、理由文本、待确认项），新增字段不参与比对。
  基线快照在 `.tools/baseline_snapshot.json`；若有意修改匹配逻辑，用 `python .tools/baseline.py save` 更新，并在修改记录里说明。
- `e2e.py` 会把 `.tools/e2e_page.html` 临时复制为 `frontend/_e2e.html`，跑完自动删除。断言结果经 `/__e2e_log` 回传，因此不受无头浏览器截图时机限制。
- 端到端覆盖：确认台渲染 → 增删生活事件 → 硬条件三值确认 → 结果分层 → 证据链展开 → 详情页 → 进一步确认表态 → 回跳确认台。
- `agent-browser` 在本机因 Chromium 下载超时不可用，端到端改用系统自带 Edge（`msedge.exe`）无头模式。

## 十二、修改记录

| 日期 | 修改文件 | 修改原因 | 可能影响 |
| --- | --- | --- | --- |
| 2026-09-29 | `data/guangzhou_elderly_policy_v1.1.json` | 建立 V1.1 政策库，字段支持 RAG | 数据层基础，前端与引擎均依赖 |
| 2026-09-29 | `backend/policy_engine.py` | 画像解析与规则匹配实现 | 匹配结果排序与状态 |
| 2026-09-29 | `backend/server.py` | 提供接口并托管静态页面 | 本地启动方式固定为 8000 端口 |
| 2026-09-29 | `frontend/*` | 四个移动端页面 | 页面跳转依赖 sessionStorage |
| 2026-09-29 | `backend/policy_engine.py` | 修复硬条件未做否定判断的问题 | 用户明确选「否」时政策不再被推荐 |
| 2026-09-29 | `data/*.json` | `ai_reason` 拆为政策侧表述 + `scene_reason_map` | 消除无依据断言，理由全部可由画像支撑 |
| 2026-09-29 | `frontend/discover.html`、`frontend/self.html`、`frontend/assets/app.js` | 修复点击「是/否/不确定」后页面先跳顶再弹回 | 局部刷新不再清空结果区，重绘前锁定容器高度；按钮补 `type="button"` |
| 2026-09-29 | `backend/server.py` | 监听地址改为读 `HOST` 环境变量（默认 `0.0.0.0`） | 支持局域网手机访问与云端部署，本地 127.0.0.1 照常 |
| 2026-09-29 | `backend/policy_engine.py` | 新增 `_dedup()` | 待确认信息去重，保留更完整表述 |
| 2026-09-29 | `frontend/index.html` | 入口分流 | 「我自己」不再进入家庭协助页 |
| 2026-09-29 | `frontend/self.html`（新增） | 本人模式页面 | 复用同一匹配接口与渲染函数 |
| 2026-09-29 | `backend/policy_engine.py`、`backend/server.py` | `build_profile(mode="self")` | 本人模式称谓为「您」，家庭模式行为不变 |
| 2026-09-29 | `frontend/policy.html` | 详情页读取 `profile` 或 `selfProfile` | 本人模式进入详情也能显示个性化推荐原因 |
| 2026-09-29 | `frontend/assets/style.css` | UI 升级第一阶段：全局视觉系统重写（温暖绿 + 米白 + 浅暖提示 + 浅蓝信任区；字号阶梯适老化；卡片三级层级；动效系统与 `prefers-reduced-motion`；safe-area；桌面端容器观感） | 全部页面共享新视觉；所有既有 class 与 CSS 变量名保留，业务逻辑零改动 |
| 2026-09-29 | `frontend/index.html` | UI 升级第一阶段：首页重做（「政策找人」大标题 + 理念副标题；入口改为 我的父母/我的长辈/我自己；新增「操作者 ≠ 受益人」对照块；新增数据可信度条，数字实时取自 `/api/policies`，接口失败整条隐藏） | 入口 `data-target` 与分流逻辑未变；新增仅读取既有接口 |
| 2026-09-29 | `backend/policy_engine.py` | `score_policy()` 增加 4 个来源透传字段（department / document_no / publish_date / checked_at） | 纯数据透传，匹配逻辑与结果零变化（已回归：非户籍排除长寿金、医保否排除长护险） |
| 2026-09-29 | `frontend/assets/app.js` | 结果卡升级为四段结构（推荐/待确认+原因解释/来源信任区/查看详情）；新增 `personalize`（本人模式称谓）、`explainMissing`（为什么需要确认）、`filterAnsweredMissing`（已答事实去重）、`showToast`、AI 流程组件 | 措辞红线全部保留：可能相关/初步匹配/建议确认/需要核实 |
| 2026-09-29 | `frontend/discover.html`、`frontend/self.html` | AI 发现过程改为两次真实请求驱动（`/api/profile` → 前两步打勾，`/api/match` → 后两步打勾），完成后保留「AI 分析依据」摘要条；补充信息增加 toast 反馈 | 无 setTimeout 假进度；滚动恢复与高度锁定逻辑原样保留 |
| 2026-09-29 | `frontend/family.html` | 三步进度条（当前步高亮）、查询关系双框（操作者→受益人）、信息状态逐项 ✓/○ 清单 | 保留全部原功能：角色网格、本人操作默认确认、勾选确认、下一步分流 |
| 2026-09-29 | `frontend/assets/style.css` | 新增卡片分段/核验徽章/AI 流程/进度条/状态清单样式；按钮统一 ≥56px；底部说明 13px | 兼容全部既有页面 |
| 2026-09-29 | `frontend/assets/style.css`、`frontend/*` | UI 升级第一阶段：全局视觉系统重写（温暖绿 + 米白 + 浅暖提示 + 浅蓝信任区；字号阶梯适老化；卡片三级层级；动效系统与 `prefers-reduced-motion`；safe-area；桌面端容器观感） | 全部页面共享新视觉；所有既有 class 与 CSS 变量名保留，业务逻辑零改动 |
| 2026-09-29 | `frontend/index.html` | UI 升级第一阶段：首页重做（「政策找人」大标题 + 理念副标题；入口改为 我的父母/我的长辈/我自己；新增「操作者 ≠ 受益人」对照块；新增数据可信度条，数字实时取自 `/api/policies`，接口失败整条隐藏） | 入口 `data-target` 与分流逻辑未变；新增仅读取既有接口 |
| 2026-09-29 | `backend/policy_engine.py` | `score_policy()` 增加 4 个来源透传字段（department / document_no / publish_date / checked_at） | 纯数据透传，匹配逻辑与结果零变化（已回归：非户籍排除长寿金、医保否排除长护险） |
| 2026-09-29 | `frontend/assets/app.js` | 结果卡升级为四段结构（推荐/待确认+原因解释/来源信任区/查看详情）；新增 `personalize`（本人模式称谓）、`explainMissing`（为什么需要确认）、`filterAnsweredMissing`（已答事实去重）、`showToast`、AI 流程组件 | 措辞红线全部保留：可能相关/初步匹配/建议确认/需要核实 |
| 2026-09-29 | `frontend/discover.html`、`frontend/self.html` | AI 发现过程改为两次真实请求驱动（`/api/profile` → 前两步打勾，`/api/match` → 后两步打勾），完成后保留「AI 分析依据」摘要条；补充信息增加 toast 反馈 | 无 setTimeout 假进度；滚动恢复与高度锁定逻辑原样保留 |
| 2026-09-29 | `frontend/family.html` | 三步进度条（当前步高亮）、查询关系双框（操作者→受益人）、信息状态逐项 ✓/○ 清单 | 保留全部原功能：角色网格、本人操作默认确认、勾选确认、下一步分流 |
| 2026-09-29 | `frontend/assets/style.css` | 新增卡片分段/核验徽章/AI 流程/进度条/状态清单样式；按钮统一 ≥56px；底部说明 13px | 兼容全部既有页面 |
| 2026-10-03 | `backend/policy_engine.py` | 新增 `build_evidence_chain()`：把匹配结果拆成「画像依据 / 政策条件 / 官方依据」三段；新增 `assign_tier()` 结果分层；新增 `build_scene_library()` 生活事件库 | 全部从数据库已有字段派生，**未改动数据库结构与匹配逻辑**（baseline 12 用例回归一致） |
| 2026-10-03 | `backend/server.py` | 新增 `GET /api/scenes`、`GET /api/tiers`；`POST /api/match` 增加 `tier_summary`、`scene_library`，并支持 `confirmed_scenes` 覆盖（人机协同纠正）；新增 `__e2e_log` 供端到端自测回传断言 | 接口只增不改，既有调用方不受影响 |
| 2026-10-03 | `frontend/assets/app.js` | 新增 `renderFlow`/`mountFlow`（四阶段流程指示器，正常使用时也显示）、`renderSituationBoard`（情况确认台：生活事件 chip 可增删 + 硬条件三值前置）、`renderEvidenceChain`（证据链）、`renderRelationStrip`（家庭协助轴常驻）；`renderResultCards` 改为分层展示 + 证据链懒展开 | 原有 `renderProfileCard`/`renderConfirmCard`/`renderSceneSummary`/`statusBadge` 等全部保留可用 |
| 2026-10-03 | `frontend/discover.html`、`frontend/self.html` | 页面重排为「描述 → 情况确认台 → 分层结果」，演示案例卡改由 JS 注入，新增 `?focus=scene\|cond` 回跳定位；bindScenes 写入 `scenes_edited` 标记 | 保留原有的局部刷新锁高、滚动恢复、AI 流程真实打勾逻辑 |
| 2026-10-03 | `frontend/policy.html` | 五问结构扩为六段（新增「去哪里核实」）；第 2 问改为渲染完整证据链；新增第 4 步「进一步确认」表态出口与回跳入口；状态徽章改读真实匹配结果（原为硬编码「可能相关」） | 原五问内容与浅蓝来源信任卡全部保留；`risk_notice` 仍展示 |
| 2026-10-03 | `frontend/index.html`、`frontend/family.html`、`frontend/assets/style.css` | 首页新增「怎么用」四步说明卡；各页挂载流程指示器与关系条；`style.css` 追加流程指示器/确认台/分层/证据链/核实指引/进一步确认等样式（累计约 3258 行） | 仅新增选择器，未修改任何既有规则 |
| 2026-10-03 | `backend/server.py`、`backend/policy_engine.py`、`frontend/discover.html` | **修复**：用户纠正的生活事件在重新匹配后被丢弃——前端用 `data.profile` 覆盖本地存储，而 profile 不含 `confirmed_scenes`。改为后端回传 `confirmed_scenes`/`scenes_edited`，并在仅收到 `scenes_edited` 时沿用上次结果 | 人机协同恢复有效；匹配逻辑本身未变（baseline 回归一致） |
| 2026-10-03 | `.tools/*` | 新增 5 个测试脚本：`baseline.py`（引擎基线快照比对）、`apitest.py`（41 项接口冒烟）、`render-test.js`（62 项渲染单测）、`page-check.js`（103 项页面接线与红线扫描）、`e2e.py`+`e2e_page.html`（驱动 Edge 跑完整流程，家庭 38 / 本人 37 项） | 仅开发期使用，不影响运行时；`__e2e_log` 端点只在本地自测时收数据 |
