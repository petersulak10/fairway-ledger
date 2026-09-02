#!/bin/zsh
# Publish the app to Cloudflare Pages (the live address) and keep the
# GitHub side in step: main holds the source, gh-pages holds the handover
# page that redirects the old address plus a copy of the app for backups.
set -e
cd "$(dirname "$0")"
mkdir -p .pages-dist && cp index.html .pages-dist/

echo "→ source to GitHub (main)"
git add -A && git commit -q -m "${1:-update}" || echo "  (nothing to commit)"
git push -q origin main

echo "→ app to Cloudflare Pages"
npx --prefix worker wrangler pages deploy .pages-dist \
  --project-name fairwayledger --branch main --commit-dirty=true | tail -2

echo "→ refreshing the old address's backup copy (gh-pages)"
tmp=$(mktemp -d)
git worktree add -q --detach "$tmp" origin/gh-pages 2>/dev/null || {
  echo "  (gh-pages worktree unavailable, skipping)"; rm -rf "$tmp"; }
if [ -d "$tmp/.git" ] || [ -f "$tmp/index.html" ]; then
  cp index.html "$tmp/app.html"
  cp redirect/index.html "$tmp/index.html"
  (cd "$tmp" && git add -A && \
    git -c user.name="Peter Sulak" -c user.email="petinko@gmail.com" \
      commit -q -m "Refresh the redirect page and backup copy" || true
   git push -q origin HEAD:gh-pages || true)
  git worktree remove --force "$tmp" 2>/dev/null || rm -rf "$tmp"
fi

echo
echo "Live:  https://fairwayledger-1o6.pages.dev/"
echo "Old:   https://petersulak10.github.io/fairway-ledger/  (redirects here)"
