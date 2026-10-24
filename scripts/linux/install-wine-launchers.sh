#!/usr/bin/env bash
set -euo pipefail

# Integrate an existing official Windows installation and contain its unsupported
# updater service inside the dedicated prefix. No browser download or launch.
ego_source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/wine" && pwd)
ego_prefix="${HOME:?HOME must be set}/.local/share/ego-wine"
ego_wine="$HOME/.local/opt/ego-wine-runtime/opt/wine-devel/bin/wine"
ego_application="$ego_prefix/drive_c/users/$(id -un)/AppData/Local/Citro Labs/ego lite/Application"

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 || $EUID == 0 ]]; then
  printf '%s\n' 'Run this installer as the desktop user on x86_64 Linux.' >&2
  exit 1
fi
if [[ ! -x $ego_wine || ! -f $ego_application/ego.exe ]]; then
  printf '%s\n' 'Install the official Windows ego app and Wine runtime in the documented paths first.' >&2
  exit 1
fi
for ego_tool in pgrep flock sort install mktemp python3; do
  command -v "$ego_tool" >/dev/null || { printf 'Required command missing: %s\n' "$ego_tool" >&2; exit 1; }
done
shopt -s nullglob
ego_cli_files=("$ego_application"/*/ego-browser.exe)
if (( ${#ego_cli_files[@]} == 0 )); then
  printf '%s\n' 'The official installation does not contain ego-browser.exe.' >&2
  exit 1
fi
bash -n "$ego_source_dir/ego-browser" "$ego_source_dir/ego-lite-wine"
ego_guard_build=$(mktemp -d)
trap 'rm -rf -- "$ego_guard_build"' EXIT
bash "$ego_source_dir/build-window-guard.sh" "$ego_guard_build/window-guard.exe"
python3 "$ego_source_dir/repair-previews.py"
python3 "$ego_source_dir/configure-updater.py"
python3 "$ego_source_dir/start-window-guard.py" --stop

# Preserve symlinks themselves, including the previous community CLI, rather
# than following them or editing any repository they point into.
ego_backup_parent="$HOME/.local/state/ego-wine-launchers"
mkdir -p "$ego_backup_parent"
ego_backup_dir=$(mktemp -d "$ego_backup_parent/backup-$(date +%Y%m%d-%H%M%S)-XXXXXX")
for ego_relative_path in \
  .local/bin/ego-browser \
  .local/bin/ego-lite-wine \
  .local/lib/ego-wine/activate-window.py \
  .local/lib/ego-wine/configure-updater.py \
  .local/lib/ego-wine/repair-previews.py \
  .local/lib/ego-wine/start-window-guard.py \
  .local/lib/ego-wine/window-guard.exe \
  .local/share/applications/ego-lite-wine.desktop \
  .agents/skills/ego-browser; do
  ego_existing_path="$HOME/$ego_relative_path"
  if [[ -e $ego_existing_path || -L $ego_existing_path ]]; then
    mkdir -p "$(dirname -- "$ego_backup_dir/$ego_relative_path")"
    mv -- "$ego_existing_path" "$ego_backup_dir/$ego_relative_path"
  fi
done

mkdir -p "$HOME/.local/bin" "$HOME/.local/lib/ego-wine" "$HOME/.local/share/applications" "$HOME/.agents/skills/ego-browser"
install -m 755 "$ego_source_dir/ego-browser" "$HOME/.local/bin/ego-browser"
install -m 755 "$ego_source_dir/ego-lite-wine" "$HOME/.local/bin/ego-lite-wine"
install -m 644 "$ego_source_dir/activate-window.py" "$HOME/.local/lib/ego-wine/activate-window.py"
install -m 755 "$ego_source_dir/configure-updater.py" "$HOME/.local/lib/ego-wine/configure-updater.py"
install -m 755 "$ego_source_dir/repair-previews.py" "$HOME/.local/lib/ego-wine/repair-previews.py"
install -m 755 "$ego_source_dir/start-window-guard.py" "$HOME/.local/lib/ego-wine/start-window-guard.py"
install -m 755 "$ego_guard_build/window-guard.exe" "$HOME/.local/lib/ego-wine/window-guard.exe"
install -m 644 "$ego_source_dir/SKILL.md" "$HOME/.agents/skills/ego-browser/SKILL.md"

# HOME is an ordinary Linux desktop-user home (for the MSI: /home/wong).
{
  printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=ego lite (Wine)' 'Comment=Official ego lite browser'
  printf 'Exec="%s/.local/bin/ego-lite-wine" %%U\n' "$HOME"
  printf 'TryExec=%s/.local/bin/ego-lite-wine\n' "$HOME"
  printf '%s\n' 'Icon=web-browser' 'Terminal=false' 'Categories=Network;WebBrowser;' 'StartupNotify=true'
} > "$HOME/.local/share/applications/ego-lite-wine.desktop"
chmod 644 "$HOME/.local/share/applications/ego-lite-wine.desktop"

if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$HOME/.local/share/applications"
fi
if [[ -n ${DISPLAY-} ]]; then
  python3 "$HOME/.local/lib/ego-wine/start-window-guard.py"
fi
printf 'Installed ego lite (Wine), ego-browser, and the native CLI entry skill.\nBackup: %s\n' "$ego_backup_dir"
printf '%s\n' 'Use ego-browser skill from a shell with ~/.local/bin on PATH; open ego lite (Wine) from the desktop application menu.'
printf '%s\n' 'After an official offline upgrade, rerun ~/.local/lib/ego-wine/configure-updater.py to keep the unsupported updater service disabled.'
