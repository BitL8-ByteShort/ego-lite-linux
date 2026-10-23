#!/usr/bin/env bash
set -euo pipefail

ego_project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ego_prompt_file="$ego_project_root/docs/linux/SOL-ONE-SHOT.md"
test -s "$ego_prompt_file"

if [[ "${1:-}" == "--check" ]]; then
  printf 'Project: %s\nModel: gpt-6.1-sol\nReasoning: xhigh\nPrompt: %s\n' "$ego_project_root" "$ego_prompt_file"
  command -v codex >/dev/null || { printf 'Codex CLI is not on PATH. Use the desktop instructions in LINUX-START-HERE.md.\n' >&2; exit 1; }
  exit 0
fi
if (( $# )); then
  printf 'Usage: %s [--check]\n' "$0" >&2
  exit 2
fi
command -v codex >/dev/null || { printf 'Codex CLI is not on PATH. Use the desktop instructions in LINUX-START-HERE.md.\n' >&2; exit 1; }
ego_initial_prompt="$(cat -- "$ego_prompt_file")"
exec codex -C "$ego_project_root" -m gpt-6.1-sol -c 'model_reasoning_effort="xhigh"' "$ego_initial_prompt"
