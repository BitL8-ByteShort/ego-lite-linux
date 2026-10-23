#!/usr/bin/env bash
set -euo pipefail

ego_project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ego_project_root"
printf 'Project: %s\nOS: %s\nArchitecture: %s\n' "$ego_project_root" "$(uname -s)" "$(uname -m)"
git status --short --branch
git log -1 --format='HEAD: %h %s'
for ego_ref in upstream/dev upstream/pr-291 upstream/pr-202; do
  printf '%s: ' "$ego_ref"
  git rev-parse --verify "$ego_ref" || true
done
for ego_tool in node npm git codex google-chrome google-chrome-stable chromium chromium-browser Xvfb weston; do
  if command -v "$ego_tool" >/dev/null 2>&1; then
    printf '%s: %s\n' "$ego_tool" "$(command -v "$ego_tool")"
  fi
done
if command -v node >/dev/null 2>&1; then node --version; fi
if command -v npm >/dev/null 2>&1; then npm --version; fi
if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'This host can prepare and test the SDK. Live Linux browser acceptance requires a Linux execution environment.\n'
else
  if [[ -n "${DISPLAY:-}" ]]; then printf 'X11 display: available\n'; else printf 'X11 display: absent\n'; fi
  if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then printf 'Wayland display: available\n'; else printf 'Wayland display: absent\n'; fi
fi
printf 'This command is read-only; it does not launch a browser, access a profile, or run the implementation.\n'
