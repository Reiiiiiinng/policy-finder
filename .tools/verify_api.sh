set -e
echo "--- 家庭模式（含来源透传） ---"
curl -s -m 10 -X POST http://127.0.0.1:8000/api/match -H "Content-Type: application/json" \
  -d '{"text":"我父亲72岁，一个人在广州生活，最近行动不方便","relation":"父亲","operator":"女儿"}' > .tools/r1.json
echo "--- 选非广州户籍 ---"
curl -s -m 10 -X POST http://127.0.0.1:8000/api/match -H "Content-Type: application/json" \
  -d '{"text":"我父亲72岁，一个人在广州生活，最近行动不方便","relation":"父亲","operator":"女儿","profile":{"hukou":false}}' > .tools/r2.json
echo "--- 本人模式 ---"
curl -s -m 10 -X POST http://127.0.0.1:8000/api/match -H "Content-Type: application/json" \
  -d '{"text":"我72岁，一个人在广州生活，最近行动不方便","mode":"self"}' > .tools/r3.json
