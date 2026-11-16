# V3.3 逐项状态

SIMULATED 表示 Edge 实际操作使用替身模型或合成办理内容。D02 评价的是真实隔离 SQLite 和实际进程重启，数据来源仍为合成案例。

| 项 | 实现 / 验收 | 修改与证据 |
|---|---|---|
| D01 | 数据去向已归因，历史路由细节 BLOCKED | 历史 SQLite 只读 UUID 对照及本轮前后摘要。未还原、删除历史记录。 |
| D02 | PASS | preview.py、followup_db.py、services.html。实际关闭并重启，Edge 我的恢复、API 等值和 SQLite 直读。 |
| C01 | SIMULATED | followup-page.js。条件入口携带计划、成员、政策、事项、地区和条件。 |
| C02 | SIMULATED | followup-page.js。任务实时条件，已确认户籍不再进入问题。 |
| C03 | SIMULATED | followup-page.js。直接返回条件条目，保存答复后返回渠道页。以原条目/区域作为滚动锚点。 |
| C04 | 部分实现 / BLOCKED | followup-page.js。区分发布机关和受理方式，已核对省级原文，佛山旧版原文、窗口和直达入口待核实。 |
| C05 | SIMULATED | followup-page.js。内容预览与复制同源，Edge 点击取得成功反馈。 |
| C06 | SIMULATED | followup_api.py、followup-page.js。轻量已联系、答复转记和条件/材料不变。 |
| W01 | SIMULATED | followup-page.js。保存待提交并核对 submission 为空。 |
| W02 | SIMULATED | followup_api.py、followup-page.js。首提日期、渠道和补交事件分别存储与展示。 |
| W03 | SIMULATED / 部分实现 | followup_api.py、followup-page.js。反馈保持办理中，结果标为用户记录。独立官方结果凭证接入未实现。 |
| W04 | SIMULATED | followup_api.py、followup-page.js。再次确认与原因，旧终态写入更正事件。 |
| W05 | SIMULATED | followup_db.py、followup_api.py、followup-page.js。整计划暂停、恢复，任务状态独立。 |
| W06 | SIMULATED | followup_api.py、followup-page.js。同成员地区的已核实在用目录，未通过原因关键词排序；保护不确定条件，显示暂无匹配。 |
| A01 | BLOCKED | 完成初步官方核查。现行养老条例备案和批准已确认，具体可申请待遇缺适用与办理证据。原目录未写。 |
| A02 | DeepSeek PASS，真实搜索 BLOCKED | deepseek_client.py、隔离 preview 和原客户端探针。搜索未启用，模型探针和正式 Edge 分开存证。 |
| A03 | PASS（隔离 SQLite / Edge） | followup_db.py、household_analysis.py、household-analysis.js。实际重开 Edge 显示未提交草稿。跨成员取值与并行冲突另见后台测试情况。 |

[完整回归](V33-REGRESSION-REPORT.md)

草稿表支持同成员多份活动草稿，版本冲突不会覆盖他处编辑。当前 UI 默认恢复最近一份，未提供完整的草稿历史列表。
