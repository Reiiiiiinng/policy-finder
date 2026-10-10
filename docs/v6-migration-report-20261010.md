# 《政策找人》v6 正式前端实现 · 交付汇报（2026-10-10）

> 承接：v6迁移实施方案-只读审查（Round 8）。本次为正式实现，**未提交、未推送、未合并**。

## 1. 实测改动文件（相对迁移前 f17bd4c，均为工作区未提交改动）

| 文件 | 改动 | 内容 |
| --- | --- | --- |
| `frontend/assets/app.js` | +124 行 | `CAT_ICONS` 分类图标 + `catSvgIcon()`；`oneCard(r, isLead)` 双分支（焦点主权益卡 / 普通卡）；`focus[0]` 升级主卡；`more-tip` 文案更新；`bindEvidenceToggles` 扩展 `[data-lead-why]` / `[data-lead-detail]` |
| `frontend/assets/style.css` | +374 行 | 文件末尾追加「v6 视觉迁移层」：主卡深绿渐变、主次按钮、分组头语义、截断口径、**皮肤层适配（重要）** |
| `.tools/render-test.js` | 1 处断言 | 单卡文案断言兼容两种卡形态 |
| `.tools/phase6-test.js` | 3 处断言 | 模板截取改为按 `<article>` 分支；`.map` 写法断言更新 |

`data/`、`backend/`、`policy.html`、`skins.css`、`skin-switcher.js` **零改动**。备份：`D:/Codex/policy-finder-backup/theme-cb-f17bd4c-20261010-215046/`。

## 2. 实现口径（与 Round 8 审查结论一致）

- 主按钮「看看为什么推荐」→ 触发本卡已有 `data-ev-toggle` 内联证据链展开，**未新增抽屉/接口**
- 次按钮「看怎么办理」→ 走既有 `policy.html?id=` 路由，先 `saveListPosition` 保返回定位
- 未迁移 v6 原型 data.js（字段名 `policyId/serviceType` 与生产 `policy_id/service_type` 不兼容）
- skins.css / skin-switcher.js 保留；三条产品红线文案未触碰

## 3. 关键问题与修复（本次最大风险）

**皮肤层叠冲突**：`skins.css` 在 `style.css` 之后加载，默认皮肤 C 的「头条卡」规则
（`body.skin-c .is-focus-items .result-card:first-child`，特异性 (0,4,1)）把主卡盖成米白底，
而主卡文字是白色 → **白底白字不可读**（迁移审查曾预判）。

修复：在 style.css 末尾追加「皮肤层适配」段，用 `body.skin-c/-b .tier-block .is-focus-items .result-card.is-lead`
（(0,5,1)）把 v6 主卡视觉在三态皮肤下统一固定，并恢复 skin-b 下「还需确认/来源」浅色块。
注意首次修复时特异性算成 (0,4,1) 仍打平告负，第二次加 `.tier-block` 前缀才生效——
**已用 getComputedStyle 探针实测验证**（bg=渐变、nameColor=#fff、24px、padding 16px）。

## 4. 测试结果（改后全量回归，8 套全绿）

| 套件 | 结果 |
| --- | --- |
| baseline.py（引擎基线） | 12 用例完全一致 |
| apitest.py（接口冒烟） | 47 通过 0 失败 |
| render-test.js（渲染单测） | 102 通过 0 失败 |
| page-check.js（接线+红线扫描） | 114 通过 0 失败 |
| phase6-test.js | 99 通过 0 失败 |
| e2e.py（家庭+本人全流程） | 总失败 0 |
| phase6-e2e.py | 45 通过 0 失败 |
| phase7-e2e.py | 44 通过 0 失败 |

4 处测试断言更新均因**有意**的结构变更（主卡无 result-foot、map 写法变化），
更新后的断言仍完整校验两个分支的元素顺序与分组全量渲染。

## 5. 真实浏览器验证（无头 Edge + CDP）

- **视口**：375 / 360 / 1280 三档
- **模式**：家庭协助（女儿→父亲）+ 本人模式，人称个性化均正确（「您父亲年龄72岁」/「您72岁」「独居的您」）
- **交互状态**：主卡默认态、证据链展开态（三段齐全、深色卡上对比度正常）、「其他可能相关」展开态
- **确认点**：主卡渐变+图标+徽章正常；主次按钮触达面积 ≥48px；证据链展开/收起正常；
  长名称单行省略生效（「老年人助餐配…」）；折叠区默认收起、文案为新版
- 产物：`.ui-shots/v6-migration/`（8 张整页 + 8 张特写）
- 工装坑（复用）：本机 Edge `--screenshot` 在窗口宽 ≥800 时静默失败（连静态页都失败），
  桌面截图须走 CDP；puppeteer-core 直接 launch 会被已有实例接管秒退（code 0），
  需手动 spawn 带 `--remote-debugging-port` 再 `puppeteer.connect`。

## 6. Git 状态

- 分支 `theme-cb`，HEAD 仍为 `f17bd4c`，**改动全部留在工作区未提交**
- 备份完整（含未提交改动 + .git），已逐字节校验
- 待用户实测确认后，按存档协议再 checkpoint + push；如需回档：备份目录可整体还原

## 7. 遗留与建议

1. `page-check.js` 无法替代人工红线判断——本次新增文案已自查（无资格断言、无金额、无编造来源）
2. skin-b 下主卡内的 `.evidence` 证据链展开体为白底自绘区，对比度已确认正常；后续若改证据链样式需同步检查三态皮肤
3. 「绿智共生」主题不可见问题（评审系统性弱点）属工作层面，不在结果页解决

## 8. 停止声明

按约定：**未 commit、未 push、未 merge**。等待用户实测与存档指令。

---

## 附：视觉回归修正（2026-10-10 深夜，用户验收反馈）

**问题**：主权益卡背景变绿。**原因**：第九阶段迁移时我在 style.css 中「有意」用品牌绿渐变
（#179370→#12805f→#0c4436）替代了 v6 定稿原型的青蓝——此替换未经用户确认。
v6 原型（设计工装 dirs.css `.a-lead-card`）实为 `var(--a-brand)` = **#1B6E8C 实色**（无渐变），
按钮文字用 `--a-brand-deep` = **#14556D**。

**最小修复**（仅 3 组规则，布局/字号/间距/交互零改动）：
1. `.result-card.is-lead` / `:active`：背景改 `#1B6E8C` 实色，投影基调 rgba(12,68,54,…) → rgba(20,85,109,…)
2. 皮肤适配层（skin-c/skin-b 高特异性选择器）：同步 `#1B6E8C`
3. `.lead-btn.is-primary` 文字色：var(--brand-deep) → `#14556D`

**三态实测（getComputedStyle）**：无皮肤 / skin-c / skin-b 主卡背景均为 rgb(27,110,140)=#1B6E8C；
名称白色 24px、主按钮文字 rgb(20,85,109)=#14556D；「政策来源」信任蓝块（--trust #f1f6fd）三态保留。
页面其余绿色语义（品牌变量、优先关注点、已核验徽章等）均未改动。

**回归**：8 套测试全绿（12/47/102/114/99/e2e 0败/45/44）。
**截图**：`.ui-shots/v6-migration/clip-before-family-375-*.png`（修复前绿）vs 同名无 before 后缀（修复后蓝）。
**Git**：HEAD 仍 f17bd4c，改动全部在工作区，未提交未推送。
