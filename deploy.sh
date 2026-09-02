#!/bin/zsh
# Publish the app and its backend together.
#
#   fairwayledger-1o6.pages.dev   the app  (dist/index.html)
#                                 the API  (dist/_worker.js -> D1)
#   petersulak10.github.io/...    the handover page that redirects here
set -e
cd "$(dirname "$0")"

echo "→ source to GitHub (main)"
git add -A && git commit -q -m "${1:-update}" || echo "  (nothing to commit)"
git push -q origin main

echo "→ app + backend to Cloudflare"
cp index.html server/dist/index.html
cp server/worker.js server/dist/_worker.js
(cd server && npx --prefix ../worker wrangler pages deploy | tail -2)

echo "→ refreshing the old address's copy (gh-pages)"
tmp=$(mktemp -d)
if git worktree add -q --detach "$tmp" origin/gh-pages 2>/dev/null; then
  cp index.html "$tmp/app.html"
  cp redirect/index.html "$tmp/index.html"
  (cd "$tmp" && git add -A && \
    git -c user.name="Peter Sulak" -c user.email="petinko@gmail.com" \
      commit -q -m "Refresh the redirect page and backup copy" 2>/dev/null || true
   git push -q origin HEAD:gh-pages 2>/dev/null || true)
  git worktree remove --force "$tmp" 2>/dev/null || rm -rf "$tmp"
fi

echo
echo "Live: https://fairwayledger-1o6.pages.dev/"
