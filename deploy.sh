#!/bin/zsh
# Publish the app to both addresses.
set -e
cd "$(dirname "$0")"
mkdir -p .pages-dist && cp index.html .pages-dist/

echo "→ GitHub Pages"
git add -A && git commit -q -m "${1:-update}" || echo "  (nothing to commit)"
git push -q origin main

echo "→ Cloudflare Pages"
npx --prefix worker wrangler pages deploy .pages-dist \
  --project-name fairwayledger --branch main --commit-dirty=true | tail -2

echo
echo "https://fairwayledger-1o6.pages.dev/"
echo "https://petersulak10.github.io/fairway-ledger/"
