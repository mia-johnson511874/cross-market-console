#!/bin/bash
# 一键部署脚本 - 跨市场策略控制台
# 用法: bash deploy.sh

set -e

echo "🚀 跨市场策略控制台 - 一键部署"
echo "================================"

# 检查 gh CLI
if ! command -v gh &> /dev/null; then
    echo "❌ 需要 GitHub CLI。正在安装..."
    winget install --id GitHub.cli --silent 2>/dev/null || {
        echo "请手动安装 GitHub CLI 并运行 gh auth login"
        echo "下载: https://cli.github.com/"
        exit 1
    }
fi

# 检查登录状态
if ! gh auth status &> /dev/null; then
    echo "🔐 请先登录 GitHub..."
    gh auth login
fi

# 1. 创建 GitHub 仓库并推送
echo ""
echo "📦 推送代码到 GitHub..."
cd "$(dirname "$0")"

if ! git remote get-url origin &> /dev/null; then
    gh repo create cross-market-console --public --source=. --push
else
    git add -A
    git commit -m "v2.0: 实时数据源 + Render 部署配置" || true
    git push -u origin main
fi

# 2. 部署后端到 Render
echo ""
echo "🔧 部署后端到 Render..."
echo "请打开 https://dashboard.render.com 并:"
echo "  1. 点击 New → Web Service"
echo "  2. 连接 cross-market-console 仓库"
echo "  3. Render 会读取 render.yaml 自动配置"
echo ""
echo "部署完成后，你会得到一个 URL，例如:"
echo "  https://cross-market-api.onrender.com"
echo ""
read -p "请输入你的 Render 后端 URL: " BACKEND_URL

# 3. 构建前端并部署到 Netlify
echo ""
echo "🏗️  构建前端..."
VITE_API_BASE="${BACKEND_URL}/api" npm run build

echo ""
echo "📤 部署到 Netlify..."
if command -v netlify &> /dev/null; then
    netlify deploy --prod --dir=dist
else
    npx netlify-cli deploy --prod --dir=dist
fi

echo ""
echo "✅ 部署完成！"
echo "   后端: ${BACKEND_URL}"
echo "   前端: 查看 Netlify 输出中的 URL"
