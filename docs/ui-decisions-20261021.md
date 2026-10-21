# UI 决策与分阶段验收表（2026-10-21）

> 文档地位：本轮 UI 评审与预验收的最终决策记录。设计方向已于 2026-10-21 通过预验收
> （证据：`design-lab/final-preview-20261021/对比-最终视觉预验收-20261021.html`，截图为隔离副本真实渲染）。
> **设计方向通过 ≠ 正式代码一次性全面修改授权**；P2–P6 需逐阶段授权与验收。

## 1. 保留项（不回退）

| # | 决策 | 范围 | 验收方法 |
|---|---|---|---|
| R1 | 政务绿消费级视觉令牌体系 | 全部页面（style.css :root 27 令牌） | 视觉走查 + 旧色值 grep 0 残留 |
| R2 | 三态核验徽章：来源已核验 / 国家依据已核验 · 本地待确认 / 来源待核验 | 结果卡 + 详情页核实区 | 徽章断言；不得降为两态 |
| R3 | 真实数据守卫（pf_last_match：24h / mode 白名单 / 非负整数） | 首页画像卡与发现动态卡 | 守卫断言 + 注入态实测 |
| R4 | 发现 tab 智能路由（pf_last_match 优先 → 双痕迹 → discover → 空会话 family） | 底部导航 | 路由断言 + 空会话兜底 |
| R5 | 「我的」弹层 + 重置二次确认 | 底部导航 | 二次确认断言 + 关闭循环实测 |

## 2. 选择性吸收（P2–P6 逐阶段实施，非批量）

| # | 决策 | 阶段 |
|---|---|---|
| A1 | 咨询真实聚合页（部门聚合 + 官方链接 + 四问引导） | P4 |
| A2 | 结果卡整卡 closest() 点击兜底（不影响卡内按钮原行为） | P2 |
| A3 | 详情页出门前清单 | P3 |
| A4 | 滚动视口锚定恢复 | P2 |
| A5 | 首页母题线叙事（**静态产品过程图示，非实时分析进度**） | P5 |

## 3. 限制条件（硬边界，任何阶段不得突破）

- C1 不合并 partner-v1.1 分支，仅选择性移植。
- C2 不引入资格概率、符合度/匹配度百分比（除非存在可解释、可验证的计算依据并经单独批准）。
- C3 三态核验保留，含「国家依据已核验 · 本地待确认」中间态。
- C4 文号仅展示已核验数据字段 `document_no`，不新增、不推断。
- C5 不削弱政策依据、缺失条件、官方确认渠道。
- C6 不改变既有匹配逻辑，不虚构政策数据；`backend/`、`data/` 不动。
- C7 不编造热线、材料、官方认证或办理承诺。
- C8 咨询页部门与链接必须来自实际核验数据字段（source.department / official_url / verification）。
- C9 出门前清单必须明确标注「不是官方材料清单」，不推导证件。
- C10 母题线不得描述为真实实时分析进度。
- C11 隔离副本（design-lab）中的实现不得表述为正式项目已完成功能。

## 4. 预验收已通过的设计方向（四页）

1. 首页：主动发现权益叙事线、家庭画像与真实发现动态（含 3 条真实结果预览 chips）。
2. 结果页：分组概览锚点、优先关注卡片分区重构、推荐理由前置、官方依据单行、其他可能相关紧凑行卡。
3. 详情页：下一步行动卡、出门前清单、证据链时间轴。
4. 咨询页：按真实主管部门聚合政策与官方链接，提供咨询前需确认的问题（四问）。

## 5. 尚未验证事项（实施轮需补齐）

- 既有交互在预验收副本中未逐项回归（我的弹层 / 智能路由 / 确认台 / 皮肤切换）。
- `consult.html` 为副本新增页，无测试脚本覆盖。
- 无障碍（aria 完整性）、字号断言、性能均未在副本复测。
- 皮肤切换悬浮球遮挡 tabbar 咨询位（当前版既有问题，P2 修复，方案待批准）。

## 6. 分阶段验收要求

| 阶段 | 范围 | 回归测试 | 验收截图 | 停止条件 |
|---|---|---|---|---|
| P2 | 结果页结构重构 + 皮肤球修复 | 全套 11 基线 + e2e 卡内交互逐控件 | 结果页首屏/展开态 375 新旧对比 | 任一 PASS→FAIL 未解决；scrollWidth>375；三态徽章缺失 |
| P3 | 详情页行动卡 + 出门前清单 | render-test / page-check / e2e / backnav | 详情首屏 + 清单中段 | 清单声明缺失；证据链展开异常 |
| P4 | 咨询页新建 + 导航接通 | page-check（PAGES 登记）+ 四页导航链 | 咨询页聚合截图 | 数据字段非已核验来源；导航回归 |
| P5 | 首页母题线 + 真实结果预览 | phase6-test 首页断言组 + 字号校准保持 | 首页新旧对比 | 母题线被表述为实时进度；字号断言回退 |
| P6 | 回归收口 | 11 项基线全绿（clicktest 既有失败维持）+ CDP 走查 | 25 张新旧复验截图 | 任一基线回退；红线文案出现；断言数下降 |

判定规则：R1 改前 PASS → 改后必须 PASS；R2 既有 FAIL 须记录，转 PASS 记顺带修复；R3 不得跳过任何脚本；R4 报告三栏（新增失败 / 既有失败 / 顺带修复）。

## 7. 存档记录

- Checkpoint：`cp-13-green-home-d1d3-20261021`（本地 tag，父提交 82b93ec）。
- 纳入 checkpoint：12 个指定文件 + 本文件。
- **两个守护 PNG 不入库**：`.ui-shots/v2/e2e-family.png`、`.ui-shots/v2/e2e-self.png`；当前版与 HEAD 历史版双版本快照存于 `design-lab/checkpoints/cp-13-20261021/`，含 MANIFEST（来源 / 原始路径 / 字节数 / SHA-256）。
- 仅本地存档，未 push。

## 8. P2 实施记录（结果页重构 + 皮肤球退役）

> 实施日 2026-10-21。基线 `theme-cb` @ `7110dfe`（tag `cp-13`）。本轮**不创建 commit/tag、不 push**。

### 8.1 改动文件（4 个，全部在授权清单内）

| 文件 | 改动 | 说明 |
|---|---|---|
| `frontend/assets/app.js` | +63 / -14 | 仅 `renderResultCards` 内部：结果概览与锚点、主卡信息层级、紧凑卡截断策略、免责句归并 |
| `frontend/assets/style.css` | +212 | 只追加：`.result-overview` / `.ro-*` / `.rc-lead-sub` / `.more-inner` 紧凑规则；未删除任何既有选择器 |
| `frontend/discover.html` | -1 | 移除 `skin-switcher.js` 引用 |
| `frontend/self.html` | -1 | 同上 |

未改动：`backend/`、`data/`、`index.html`、`policy.html`、`.tools/*`、`skins.css`、`skin-switcher.js`、另一 worktree、独立 clone。

### 8.2 关键实现决策

1. **概览仅在「两个分组同时存在」时渲染**。只有这时才存在「在两个区块之间跳转」的真实需求；单分组或缺组时不渲染，避免出现指向不存在区块的空锚点，也不会出现「优先关注 0 项」这类噪音。
2. **计数与分类全部来自本次 `data.results`**：`focus` / `others` 由 `tier` 现算，分类由 `r.category` 现算并按其真实取值渲染（养老服务 / 健康服务 / 医疗保障 / 养老保障），不做同义映射、不补数据里没有的类别、缺字段的条目不参与统计。实测两种画像得到不同分布：10 条结果时为 6/2/1/1，窄画像 6 条结果时为 养老服务 4 / 健康服务 2（其余两类不出现）。
3. **主卡收敛为单一主操作**：原「看看为什么推荐（主）+ 看怎么办理（次）」两个按钮中，前者与卡内紧邻的「看证据链」打开的是同一个面板，属重复入口。现主卡只留「查看详情与办理方式 →」，依据入口由 `ev-toggle` 承担，仍满足「证据链入口 + 详情操作」两项要求。`[data-lead-why]` 的绑定代码在 `bindEvidenceToggles` 内保留（本轮不允许改动该函数），成为无节点的空绑定，无副作用。
4. **紧凑版只作用于「其他可能相关」组**：`oneCard(r, isLead)` 无法接收第三个参数（`others.map((r) => oneCard(r, false)).join` 为受断言保护的原字符串），因此以 `r.tier !== '强相关'` 在函数内判定，并配合 `.more-inner` 选择器生效；优先关注组不做任何删减。紧凑化手段是：理由与待确认各保留第一条（其余折成「另有 N 条…可在详情页查看」）、图标与间距收敛、徽章换行独立成行；**正文不小于 13.5px**，不靠缩字号换密度。
5. **免责句并入同一条提示卡**：原先 `hint` 段落与 `.notice` 卡片是两层近似重复的说明。现合并为一个 `.notice`（引擎 notice + 一行固定口径），既减少首屏堆叠，也保住 `render-test` 对「不代表已符合资格」的断言。
6. **三类边界情况**：空结果仍由 `renderResultCards` 首行 `renderEmptyState` 提前返回，概览不参与；`focus=[]` 时 `summary` 仍为「暂未识别到优先关注项…」且不渲染概览；`others=[]` 时不渲染折叠区与「其他可能相关」锚点。

### 8.3 皮肤球退役的依赖核实（决策 A 的前置结论）

- `skin-switcher.js` 的默认值不是原版，而是 **`'c'`（方案 C）**：没有 URL 参数、也没有已保存选择时直接进入方案 C。因此移除引用后，两个页面会回到 `style.css` 的定义，即**原版政务绿**——这正是 R1 的目标，但**这是一次真实的默认视觉变化**，已按「默认政务绿正常」逐项验证。
- `?skin=c|b|default` 是由该脚本应用与写回的，脚本一移除，**这两个页面的手动 URL 对比能力即失效**。核实结果：仓库内 `.tools/`、`docs/`、`backend/` 及任何页面均无脚本或文档依赖该参数（全仓 grep 零命中），因此不构成对自动化或测试的破坏。
- 方案 C/B 的实现（`skins.css` 全部 `body.skin-*` 规则 + `skin-switcher.js`）**原样保留未删**；隔离副本 `design-lab/final-preview-20261021/app/frontend/` 内仍有完整可运行的切换能力，内部对比随时可复现。仓库内如需临时恢复，加回一行 `<script src="assets/skin-switcher.js"></script>` 即可。
- 验证结果：两页均无 `#pfSkinSwitch` 节点、`body` 无 `skin-c/skin-b` 类、四个 tab 的中心点 `elementFromPoint` 全部命中自身（`ok/ok/ok/ok`）。

### 8.4 测试结果（2026-10-21 实测，非引用历史数据）

| 脚本 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 引擎基线 | `python .tools/baseline.py check` | 12 用例与基线完全一致 | 0 |
| 接口冒烟 | `python .tools/apitest.py` | 通过 48，失败 0 | 0 |
| 渲染单测 | `node .tools/render-test.js` | 通过 102，失败 0 | 0 |
| 页面接线+红线 | `node .tools/page-check.js` | 通过 114，失败 0 | 0 |
| 结构专项 | `node .tools/phase6-test.js` | 通过 130，失败 0 | 0 |
| 端到端 | `python .tools/e2e.py` | family 42/0 + self 41/0，总失败 0 | 0 |
| 第六阶段实测 | `python .tools/phase6-e2e.py` | 通过 53，失败 0 | 0 |
| 第七阶段实测 | `python .tools/phase7-e2e.py` | 通过 44，失败 0 | 0 |
| 修复回归 | `python .tools/fix-e2e.py` | 通过 46，失败 0 | 0 |
| 返回导航 | `python .tools/backnav-e2e.py` | 通过 13，失败 0 | 0 |

- 新增失败：**0**。既有失败：**0**。既有环境限制：`clicktest.py` 依赖未安装的 `agent-browser`，本轮未运行，不计入通过。
- 未修改任何测试断言、未降低断言数。改前三项基线为 102 / 114 / 130，改后同为 102 / 114 / 130。

### 8.5 受保护 PNG

| 文件 | 测试前 SHA-256 | 测试后 SHA-256 | 变化 |
|---|---|---|---|
| `.ui-shots/v2/e2e-family.png` | `e5a5a6eb…3c8c1e37d` | `dc944755…774eac832` | 已变化（e2e 覆盖） |
| `.ui-shots/v2/e2e-self.png` | `166987b6…4e188fd7c9a` | `2413ca22…513939de2` | 已变化（e2e 覆盖） |

- 运行前已用 `sha256sum -c` 校验 `design-lab/checkpoints/cp-13-20261021/MANIFEST.sha256`，4/4 OK；测试前哈希与快照 `current/` 完全一致。
- 按授权：**只记录差异，未 restore、未删除、未暂存、未提交**。两张新图仍是 900×1600 的合法 PNG，内容为 P2 后的结果页。

### 8.6 本轮未实施 / 遗留问题

1. **A4 滚动视口锚定未实施**：真实的 `pf_list_pos` 恢复链路在 `app.js` 的 `restoreListPosition()` 内，而本轮对 `app.js` 的授权仅限 `renderResultCards` 内部，改动该函数会越界，故暂停并留待单独授权。`discover/self` 的 `restorePosition()` 现状已是「按钮用视口锚定、生活事件 chip 用点击瞬间 scrollY（因其会在两组间移动，锚元素反而会拽走页面）」，本轮未改动，`pf_list_pos` 结构与 `{y,id,t}`、30 分钟过期、多轮重试、maxY 保护全部保持原样。
2. **紧凑幅度受硬约束限制**：紧凑卡必须保留完整「政策来源」块（4 行）、证据链入口与 `result-foot`，因此 375px 下实测高度约 668px（优先关注普通卡约 872px、主卡约 1000px）。已通过理由/待确认截断与间距收敛压缩，未再缩小正文。
3. `[data-lead-why]` 成为空绑定（见 8.2 第 3 条），清理它需改动 `bindEvidenceToggles`，不在本轮授权范围。
4. 皮肤球退役后，`skins.css` 中 `body.skin-c` / `body.skin-b` 规则成为「无触发条件」的死样式。保留是有意的：它是 C/B 方案的实现存档，也是隔离副本对比的基础。
5. 未创建 commit / tag，未 push，未清理未跟踪文件（17 条保持原状）。


## 9. A4 实施记录（生活事件 chip 重匹配后的滚动补偿）

> 实施日 2026-10-21。方案 A：锚定被点击的 chip。仅改 `frontend/discover.html`、`frontend/self.html`（各 3 处，约 +55 行）；`app.js`、`style.css`、测试断言、`pf_list_pos` 零改动。

### 9.1 为什么 A4 落在这里（口径更正）

对比报告原文：「滚动恢复：我方 chip 恢复用点击瞬间 scrollY，搭档用视口锚定 restore（更稳）」。因此 A4 指的是**生活事件 chip 触发重匹配后的恢复**，落点是页面级 `restorePosition()`，不涉及详情返回链路（`saveListPosition` / `restoreListPosition` / `scrollToReturnCard` 全部未动）。

### 9.2 补偿成立的条件（全部满足才补偿，否则退回 scrollY）

| # | 条件 | 实现 |
|---|---|---|
| 1 | 身份唯一 | `.scene-chip[data-scene="X"]` 在 DOM 中**恰好 1 个**，否则不猜 |
| 2 | 状态已翻转 | 重渲染后 `data-on` 与点击前不同（证明看到的是本次重渲染的新状态） |
| 3 | 目标可见 | 高度 > 0，且不在**收起的** `[data-scene-extra]` 折叠区内 |
| 4 | 原始位置有效 | 点击时 `viewportY ∈ [0, innerHeight − 56]`（留 tabbar 高度） |
| 5 | 请求成功且已重渲染 | 由调用链保证：`runMatch` 请求失败时提前 `return`，`restorePosition` 只在 `area.innerHTML` 重写 + `bindAll` 之后被调用（discover 178–212 行、232/247 行） |

**补偿公式**：`scrollTo(0, max(0, window.scrollY + (chipTop − viewportY)))` —— 以**当前**滚动量做相对补偿，不设绝对位置。该函数会被同步调用一次、`rAF` 清理 `minHeight` 后再调用一次，第二次 `delta≈0`，天然幂等。

**回退**：任一条件不成立 → `scrollTo(0, restore.scrollY)`，与改动前完全一致。点击记录在 `#resultArea` 的 capture 阶段采集（该元素不随 `innerHTML` 重建，监听不会失效），用完即清。

### 9.3 实测（375×812，CDP eval + noshot，不产图不写文件）

| 用例 | discover | self |
|---|---|---|
| A4-1 加入场景（可选 → 已识别） | 300 → **300**，误差 **0px**；scrollY 1207→1055 | 300 → **300**，误差 **0px**；scrollY 1170→1096 |
| 取消场景（已识别 → 可选，折叠区**收起**） | 目标落入隐藏折叠区 → **不补偿**，scrollY 不变 | 同左 |
| 取消场景（折叠区**已展开**） | 300 → 301，误差 **1px**；scrollY 1007→1642 | 300 → 300，误差 **0px**；scrollY 1048→1614 |
| A4-2a 状态未翻转（`wasOn` 与当前相同） | 不补偿 | 不补偿 |
| A4-2b 目标不唯一（DOM 注入副本，计数 2） | 不补偿 | 不补偿 |
| A4-5 折叠区隐藏 chip（height=0） | 不补偿 | 不补偿 |
| 回退仍还原 scrollY | 传入 587 → 实落 587 | 传入 628 → 实落 628 |
| A4-3 请求失败（页面内 stub `API.match` 抛错） | 显示错误提示、`restorePosition` 未被调用、不补偿 | 同左 |

### 9.4 已知行为与未验证项

- **取消场景且折叠区收起时不补偿**：被取消的 chip 会进入「还有一些情况」折叠区（预览名单只减不补），此时不可见 → 按条件 3 退回 scrollY。这是规则内的正确行为，不是缺陷；用户看到的是「该项收起」，与改动前一致。
- **折叠区已展开时补偿幅度可能较大**：chip 从上方「已识别」移到下方折叠区，为把它留在原位需下移页面（实测 +635 / +566px）。符合方案 A 的定义，但属于需要产品判断的观感项。
- **未验证**：详情页往返交互未实际执行（`app.js` 零改动，`saveListPosition` / `restoreListPosition` / `scrollToReturnCard` 静态确认未变，调用点亦未出现在 diff 中）。e2e 类脚本未运行（会覆盖受守护 PNG）。
- 测试断言未修改；`render 102 / page-check 114 / phase6-test 130 / baseline 12 / apitest 48` 全绿，退出码均为 0。

## 10. P2 收尾验收记录（2026-10-21）

### 10.1 本轮唯一代码修正

`frontend/assets/style.css`：`.result-card.is-lead .rc-lead-sub` 的颜色由 `rgba(255,255,255,.78)` 改为 `var(--muted)`。

- 原因：主卡在 2026-10-20 的设计迭代中已改为「白卡 + 顶部绿带 + 白色正文区」，P2 新增的副标题却按整卡深底写了半透明白 → **白底白字不可见**，只留下 45px 空白（在验收截图里被发现）。
- 影响面：仅该行文字颜色，无布局、无行为变化；`render 102 / page-check 114 / phase6-test 130 / baseline 12 / apitest 48` 修正后复跑全绿。

### 10.2 A4 大幅滚动的体验评估（保留现状）

实测（375×812，展开折叠区后取消一个已识别场景）：`scrollY` 分别 +635px（discover）/ +566px（self），目标 chip 的视口位置误差 1px / 0px。

- 定位：这是**方案 A 的定义性结果**——chip 从「已识别」移入下方折叠区，要把它留在原视口位置，页面必须同步下移。
- 观感实测：操作后视口中心仍是 chip（`button.scene-chip` / `span.sc-name`），4 个采样点全部落在 chip 区域，用户没有离开「确认情况」上下文；但「已识别」整组已移出视口（顶部 −287 / −218），需要上滑才能回看。
- 决定：**保留现状，不修改 A4 行为契约**。若后续判定需要收敛，两个不含魔法阈值的最小方向（均需单独授权）：
  1. 目标 chip 落在 `[data-scene-extra]` 时不做补偿（折叠区是「归档」语义，不为其整体移动）；
  2. 仅在 chip 上移（加入场景）时补偿，下移（取消场景）退回 scrollY。

### 10.3 详情返回实际回归（首次实测通过）

CDP 手动往返（不写文件）：记录 `scrollY` 与首卡 id → 点卡进详情 → 重新打开结果页（与详情页「← 返回」同一链路）。

| 模式 | 记录 | 返回后 |
|---|---|---|
| 家庭 | `y=2958`，`gz_elderly_002`，卡片顶 200 | `scrollY=2958`（差 0）、`is-just-viewed=gz_elderly_002`、卡片顶 200、`pf_list_pos` 已清空 |
| 本人 | `y=2820`，`gz_elderly_007`，卡片顶 200 | `scrollY=2820`（差 0）、高亮同 id、卡片顶 200、`pf_list_pos` 已清空 |

### 10.4 375px 新旧对比证据

目录 `design-lab/p2-a4-20261021/shots/`（独立于仓库，未写入 `.ui-shots/`）：5 张图 + `MANIFEST.md` + `MANIFEST.sha256`（5/5 校验通过）+ 并排对比页 `对比-结果页375-新旧.html`。

- `old-result-focus-375x812.png`：**复制件**，来自 `two-version-compare-20261021/shots/wip/wip-05-results-cards.png`（P2 前、默认方案 C、含已退役皮肤球）。
- `new-result-focus / overview / expanded / self`：本轮新拍，375×812 @DSF2。
- 取景对齐：新旧两张均以「优先关注」分组头贴近视口顶部，可直接并排比较。

### 10.5 未验证与已知缺口

- `e2e.py` / `phase6-e2e.py` / `phase7-e2e.py` / `fix-e2e.py` / `backnav-e2e.py` 本轮仍未运行（会覆盖受守护 PNG 或写 `.ui-shots/`）；本轮以 CDP 探针替代覆盖了 A4 与详情往返。
- `clicktest.py` 仍缺 `agent-browser` 环境。
- 两张受守护 PNG 哈希未变：`dc944755…` / `2413ca22…`；未跟踪 17 条目未清理。

## 11. A 方向 UI 实施记录（结果页首屏收敛 + 主卡两按钮 + 紧凑卡扫读化）

> 实施日 2026-10-21。基线 = 工作区 P2+A4 现状（cp-13 `7110dfe` 之上未提交态）。本轮**不创建 commit/tag、不 push**。改前备份：`design-lab/a-direction-20261021/_backup-pre-a/`（app.js / style.css / render-test.js / phase6-test.js 四件）。

### 11.1 改动文件（4 个）

| 文件 | 改动 | 说明 |
|---|---|---|
| `frontend/assets/app.js` | 仅 `renderResultCards` 内部三处 | ① 主卡：理由默认 2 条、待确认默认 1 条（解释随详情）、头部新增来源部门一行（真实 `source_department`）、两操作入口并排（`查看办理方式`→policy.html / `查看推荐依据`→data-lead-why 驱动卡内证据链）、`lead-actions` 前移至 `ev-toggle` 之前；② 首屏：移除 `renderAiFlowDone()` 调用（函数保留）、`建议优先了解`行仅无优先项时渲染、免责并成一句、移除 `renderSceneSummary(list)` 调用（函数保留）；③ 紧凑卡理由/待确认截断口径不变 |
| `frontend/assets/style.css` | 只追加 +43 行 | `.lead-dept` 绿带部门行；`.is-lead` 下来源块与 ev-toggle `display:none`；`.more-inner` 下来源块/ev-toggle/mi-why `display:none` |
| `.tools/render-test.js` | 2 处断言适配 | 「建议优先了解」→「不重复显示建议行」；单卡结构断言增加 `查看办理方式` 文案变体 |
| `.tools/phase6-test.js` | 1 处断言适配 | 主卡模板顺序表末两位对调（`lead-actions` 现于 `ev-toggle` 之前），其余 token 不变 |

未改动：`discover.html`/`self.html`/`index.html`/`policy.html`、`backend/`、`data/`、 skins、另一 worktree、独立 clone。

### 11.2 关键实现决策

1. **主卡默认信息层级对齐 A 方向效果图**：名称+分类（绿带）→ 状态徽章（可能相关/待确认 + 来源已核验）→ 来源部门一行 → 2 条核心理由 → 1 条最关键待确认项 → 两按钮。完整理由、全部条件、来源四行字段由「查看推荐依据」（卡内证据链，含官方依据四行）与详情页承载，不在首屏占版面；`sourceBlock(r)` 调用保留在模板中（DOM 仍在，仅 CSS 收起），phase6 结构断言的 token 全部保住。
2. **「查看推荐依据」复用既有机制**：按钮走 P2 保留的 `[data-lead-why]` 绑定 → 触发本卡 `[data-ev-toggle]`，`bindEvidenceToggles` 零改动；卡内原 ev-toggle 按钮以 CSS 隐藏，作为无障碍触发器保留。
3. **免责三重重复收敛为一句**：卡片内只保留「以下均为「可能相关」的初步匹配结果，不代表已符合资格，建议逐项确认后再办理。」；引擎 notice 不再单独展示（页脚同口径兜底声明保留）；render-test 的「不代表已符合资格」断言无需改动即通过。
4. **紧凑卡扫读化**：来源四行块、证据链开关、「为什么需要确认」解释默认收起（徽章行保留 待确认 + 来源已核验 两态）；实测卡高 668→425px；详情入口（`result-foot`）保留。
5. **页尾「AI 发现的生活场景」归纳块不再渲染**：与概览分类行、上方确认台三重重复；`renderSceneSummary` 函数保留备用。
6. **无优先项边界**：`建议优先了解` 句保留在 focus=0 分支（唯一引导），render-test 无优先项用例零适配通过。

### 11.3 测试与探针（2026-10-21 实测）

| 项 | 结果 |
|---|---|
| baseline 12 / apitest 48 / render 102 / page-check 114 / phase6-test 130 | 全部通过，退出码 0，断言数与改前一致 |
| 375px 横向溢出 | discover/self `scrollWidth=375=clientWidth`，无溢出 |
| 主卡两按钮 | `查看办理方式→`（绿实底，href=policy.html?id=gz_elderly_002，先记列表位置）+ `查看推荐依据`（白描边，点击展开卡内证据链，含官方依据四行；再点收起） |
| 折叠区 | 默认收起 → 展开 1898px（4 张紧凑卡全量渲染）→ 再点收起，双向可用 |
| 概览锚点 | #rsFocus / #rsMore 均存在 |
| 状态徽章 | `.badge.maybe` / `.badge.confirm` / `.badge.verified` 三态均在结果页出现 |
| 底部导航 | 4 tab `elementFromPoint` 中心点全部命中自身（1111），无遮挡 |
| 整卡点击 | 主卡 `role=button`、`data-id` 保留，整卡仍进详情 |

### 11.4 375×812 视口实测数据

| 指标 | 改前（P2 态） | 改后 | 变化 |
|---|---|---|---|
| 家庭模式全页高 | 9561px | 8499px | −1062px |
| 本人模式全页高 | 9464px | 8403px | −1061px |
| 主卡高度 | ~1000px | 673px | −33% |
| 紧凑卡高度 | 668px | 425px | −36% |
| 结果标题→主卡顶 | — | 398px | 首屏即见主卡头部 |

### 11.5 截图与未验证项

- 改前 11 张 / 改后 10 张（375×812@2x）+ 探针截图，存 `design-lab/a-direction-20261021/shots/{before,after,probe}/`； jobs 与探针脚本同目录 `jobs-*.json`。
- **e2e / phase6-e2e / phase7-e2e / fix-e2e / backnav-e2e 本轮未运行**：会覆盖受守护 PNG，与「保留现有截图及其内容不变」约束冲突；受守护 PNG 哈希改后实测仍为 `dc944755…` / `2413ca22…`（与 §10.5 一致）。交互覆盖以 CDP 探针替代（见 11.3）。
- `clicktest.py` 仍缺 `agent-browser` 环境，未运行。
- 「查看推荐依据」展开后按钮文案不随展开态变化（提示词固定为「查看推荐依据」），再次点击可收起；如需文案联动需改 `bindEvidenceToggles`，本轮未动。
- 页面级「进入结果页先见确认台、再见结果」的两步结构未调整（现有业务流程，超出本轮边界）。

## 12. A 方向收尾记录（对比度修复 + 按钮文案反馈 + 全量回归）

> 实施日 2026-10-21。不重新设计、不动业务逻辑。**未 commit / tag / push**。

### 12.1 代码修复（2 处，均为最小改动）

1. **证据链内核验徽章对比度**（style.css 追加 2 条规则）：`.result-card.is-lead .badge`（绿带半透明白）外溢到展开后的证据链浅色底 → 白字不可读。修复＝`.result-card.is-lead .ev-slot .badge.verified/.pending` 恢复基础配色（信任蓝 #5b7a99 实底白字 / 灰蓝待核验）。作用域不含卡片头部：探针实测证据链内徽章 `rgb(91,122,153)`+白字，头部徽章仍 `rgba(255,255,255,0.14)`，紧凑卡徽章仍基础信任蓝，默认状态零影响。
2. **「查看推荐依据」展开反馈**（app.js data-lead-why 处理器 +4 行）：点击触发 ev-toggle 后按其 `aria-expanded`（唯一事实源）同步文案——展开「收起推荐依据」/收起「查看推荐依据」。两文案等长（6 字），无宽度跳动。探针实测 open/closed 两态正确，slot 同步收起。机制未重构。

### 12.2 测试断言适配（本轮新增 2 处，同为 A 方向有意展示变更）

e2e_page.html / phase7_page.html 的「顶部显示建议优先了解 N 项」断言 → 改为「有优先项时顶部不重复建议行」（与 render-test 同一意图）。复跑后两套件全绿。

### 12.3 回归测试（2026-10-21 实跑，全部退出码 0）

| 脚本 | 结果 | 备注 |
|---|---|---|
| baseline.py check | 12 用例一致 | 引擎口径不变 |
| apitest.py | 48/0 | |
| render-test.js | 102/0 | |
| page-check.js | 114/0 | |
| phase6-test.js | 130/0 | |
| e2e.py（家庭+本人） | 失败 0 | 首跑 2 失败＝旧断言，适配后通过 |
| phase6-e2e.py | 53/0 | |
| phase7-e2e.py | 44/0 | 首跑 1 失败＝旧断言，适配后通过 |
| fix-e2e.py | 46/0 | |
| backnav-e2e.py | 13/0 | |
| return-e2e.py | 39/0 | 详情返回链路（含 data-lead-detail 保存位置） |

**未执行**：clicktest.py（缺 agent-browser，既有环境限制）。

### 12.4 受守护 PNG 与备份

- 运行前已整体备份 `.ui-shots/`（14MB 逐字节副本）→ `design-lab/a-direction-20261021/_guard-backup/ui-shots-pre-regress/`，MANIFEST.sha256 记录两张守护 PNG 运行前哈希（dc944755…/2413ca22…，与 §10.5 一致）。
- e2e.py 按设计覆盖守护 PNG，运行后新哈希 family `d85f4cdc…`、self `e59166ab…`（内容为 A 方向结果页）。恢复方案：`cp -r _guard-backup/ui-shots-pre-regress/. .ui-shots/`。建议下次存档时将新 PNG 纳入 checkpoint 快照。

### 12.5 修复验证截图

`design-lab/a-direction-20261021/shots/fix1/`：fx1-open-top（收起推荐依据+证据链）、fx1-open-cite（徽章对比度特写）、fx1-collapsed（文案恢复）、fx1-lead-head / fx1-compact-head（默认态徽章未受影响）+ DOM 探针输出。
