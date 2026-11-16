# 政策找人 V3.3

V3.3 包含 AI 政策发现、家庭情况输入、政策推荐与集中核对，以及家庭少跑腿计划。计划包括条件核实、材料与办理渠道、咨询与记录、提交和补件进度、暂停恢复、家庭成员与历史。整改范围和政策目录待核事项见[整改总报告](REMEDIATION-DELIVERY/V33-REMEDIATION-REPORT.md)。

## 本地启动

需要 Python 3.12。前端是静态 HTML、CSS 和 JavaScript，后端使用 Python 标准库。以下 PowerShell 命令从仓库根目录运行。隔离预览以合成成员、替身 AI 与搜索响应启动，无需密钥。

~~~powershell
$env:PF_V33_INSTANCE = 'local-demo'
$env:PF_V33_PORT = '28761'
python -B -X utf8 -c "import os, sys; sys.path.insert(0, 'backend'); import followup_db; followup_db.initialize('data/private-migration/v33-' + os.environ['PF_V33_INSTANCE'] + '/acceptance.db')"
python -B -X utf8 -u tests/preview_trip.py
~~~

打开浏览器访问 [本地预览](http://127.0.0.1:28761/)。用 Ctrl+C 停止服务。使用同一实例名可复用该隔离数据库。SQLite 迁移在 [followup_db.py](backend/followup_db.py) 的 MIGRATIONS 中。首次验证和迁移练习请使用新建的合成库。

如需通过现有 DeepSeek 客户端验证，请使用待测终端的进程环境配置 DEEPSEEK_API_KEY，再用 python -B -X utf8 -u preview.py 启动其独立实例。客户端默认使用官方 HTTPS 地址和 deepseek-flash。搜索模式默认为模拟，真实搜索有独立的启用和凭据配置。

## 测试

~~~powershell
python -B -X utf8 -m unittest discover -s tests
python -B -X utf8 -m unittest discover -s backend -p test_deepseek_client.py
python -B -X utf8 tests/check_v33_draft.py
~~~

Edge 回归需要 Node.js 22+ 和 Microsoft Edge。在一个终端按上文启动合成预览，再在另一个终端运行：

~~~powershell
$env:PF_TRIP_INSTANCE = 'local-demo'
$env:PF_TRIP_PORT = '28761'
$env:PF_AUDIT_PHASE = 'remediation'
node tests/edge_remediation.mjs
~~~

Edge 若安装在非默认位置，可通过 PF_EDGE_EXECUTABLE 指定可执行文件。以同一实例重启预览后，将 PF_AUDIT_PHASE 设置为 restore 并重跑，用于验证计划恢复。运行数据和截图写入 Git 已忽略的目录。

政策 JSON 随原 V3.3 交付保留。佛山区街渠道与部分养老待遇待补齐官方依据；办理结果由用户记录。详见[逐项状态](REMEDIATION-DELIVERY/V33-ISSUE-STATUS.md)。
