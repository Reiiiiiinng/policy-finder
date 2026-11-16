# V3.3 变更清单

## 基线

提交前检查发现工作区无 Git 元数据，无法取得分支、HEAD、未提交状态。首次写入前记录文件 SHA-256，保留原有内容。以下为业务源文件逐路径差异，详见 基线与变更摘要（本地证据）。

| 文件 | 变化 |
|---|---|
| [backend/deepseek_client.py](../backend/deepseek_client.py) | 受限的响应模型证据 |
| [backend/followup_api.py](../backend/followup_api.py) | 咨询轻量状态、回执、结果与计划暂停、替代权益 |
| [backend/followup_db.py](../backend/followup_db.py) | 固定连接与 v6 schema |
| [backend/household_analysis.py](../backend/household_analysis.py) | 按作用域保存、读取和清理草稿 |
| [frontend/assets/followup-page.js](../frontend/assets/followup-page.js) | 咨询及返回、办理状态和事件页 |
| [frontend/assets/household-analysis.js](../frontend/assets/household-analysis.js) | 草稿提示及恢复 |
| [frontend/services.html](../frontend/services.html) | 成员参数于异步加载前保留 |
| [preview.py](../preview.py) | 数据库绑定、运行锁、预检与运行身份 |

## 数据结构及新文件

- schema v6 增加 plans.paused_at、plans.pause_reason 和 household_drafts。阶段与事件继续使用已有任务 JSON 和 case_events。两份新测试库均按 v6 初始化，历史 v5 数据库未执行迁移。
- 新增本交付目录八份报告及 evidence 下的 Edge 脚本、截图、探针、校验、日志和两份写入前备份。数据写入限于新实例 remediation-20261114-a 和 remediation-20261114-live，下次启动仍需使用同一绝对路径。
- 原政策目录 JSON 的 SHA-256 未变化。历史差异两库本轮前后哈希一致。

## 本地复验

PowerShell 中把工作目录切到 V3.3 隔离目录，设置本次进程的 PF_V33_PORT 为 28749、PF_V33_INSTANCE 为 remediation-20261114-a，然后用既有 bundled Python 执行 tests/preview_trip.py。该入口使用测试替身。原客户端入口用独立库 remediation-20261114-live、端口 28753 及 preview.py。程序退出后新库保留。已有服务时先检查端口和要使用的实例。新实例首次启动前使用 followup_db.initialize() 显式预备一个全新的独立库。
