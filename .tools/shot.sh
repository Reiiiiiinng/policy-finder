#!/bin/bash
# 页面截图：node 不依赖浏览器 daemon，直接调本机 Edge 无头模式。
# 用法： bash .tools/shot.sh <相对路径> <输出名> [宽] [高] [额外URL参数]
set -u
ROOT="D:/Codex/policy-finder/政策找人"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
PAGE="${1:-index.html}"
NAME="${2:-shot}"
W="${3:-430}"
H="${4:-932}"
OUT="$ROOT/.ui-shots/v2/$NAME.png"
PROFILE="C:/Temp/edge_$NAME"

mkdir -p "$ROOT/.ui-shots/v2"
rm -f "$OUT"

powershell.exe -NoProfile -Command "
  \$edge = '$EDGE'
  Start-Process -FilePath \$edge -ArgumentList @(
    '--headless=new','--disable-gpu','--no-sandbox',
    '--user-data-dir=$PROFILE',
    '--screenshot=$OUT',
    '--window-size=$W,$H',
    '--virtual-time-budget=7000',
    'http://127.0.0.1:8000/$PAGE'
  ) -Wait -NoNewWindow
" > /dev/null 2>&1

if [ -f "$OUT" ]; then
  echo "OK $NAME  $(stat -c%s "$OUT") bytes"
else
  echo "MISSING $NAME"
fi