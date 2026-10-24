#!/usr/bin/env bash
set -euo pipefail
ego_guard_source=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ego_guard_output=${1:?Pass the output executable path}
ego_guard_cc=$(command -v x86_64-w64-mingw32-gcc || command -v x86_64-w64-mingw32-gcc-posix || true)
if [[ -z $ego_guard_cc && -x "$HOME/.local/opt/ego-mingw/usr/bin/x86_64-w64-mingw32-gcc-posix" ]]; then
  ego_guard_cc="$HOME/.local/opt/ego-mingw/usr/bin/x86_64-w64-mingw32-gcc-posix"
fi
if [[ -z $ego_guard_cc ]]; then
  printf '%s\n' 'Building the native window guard requires the x86_64 MinGW C compiler.' >&2
  exit 1
fi
"$ego_guard_cc" -O2 -Wall -Wextra -Werror -municode -Wl,--subsystem,windows \
  -static-libgcc -o "$ego_guard_output" "$ego_guard_source/window-guard.c" -luser32 -lpsapi
