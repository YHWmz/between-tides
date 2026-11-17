#!/bin/zsh
# 双击启动《潮汐之间》演示：起本地服务器并用 Chrome 打开。
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
[ -d node_modules ] || npm install
( sleep 2; open -a "Google Chrome" "http://127.0.0.1:5173/" ) &
exec npm run dev -- --strictPort
