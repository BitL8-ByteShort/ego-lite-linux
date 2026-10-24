# Official ego lite through Wine

This route runs the official Windows ego lite application and its bundled
`ego-browser.exe` on the MSI Linux desktop. The repository supplies two Linux
launch wrappers and an agent entry skill. Vendor binaries are not redistributed. The integration applies a verified,
reversible four-byte repair to the official browser’s software thumbnail path;
Wine DLLs remain stock.

## Existing installation required

The MSI setup uses Ubuntu 24.04 x86_64, WineHQ Wine 11.20, a dedicated `wow64`
prefix, and official ego lite 0.6.0.22. Expected paths under the desktop user's
home are:

```text
.local/opt/ego-wine-runtime/opt/wine-devel/bin/wine
.local/share/ego-wine/drive_c/users/<username>/AppData/Local/Citro Labs/ego lite/Application/ego.exe
.local/share/ego-wine/drive_c/users/<username>/AppData/Local/Citro Labs/ego lite/Application/<version>/ego-browser.exe
```

The official Windows bootstrapper is available from the
[ego lite download page](https://lite.ego.app/download). On the MSI, the
bootstrap updater stalled, so the vendor's full x64 payload from its official
update manifest was installed with its own `mini_installer_uncompressed.exe`.
Version 0.6.0.22 payload SHA-256:
`46013f21ca2349cc10845027cc5cdeda0b1fd726404f817be463739a5f03438d`.

## Install the Linux integration

After the official application is installed, run from this checkout as the
desktop user:

```bash
bash scripts/linux/install-wine-launchers.sh
```

The local integration-only artifact is
`dist/linux/ego-wine-integration-0.6.0.22-r1.tar.gz`, with its adjacent SHA-256
file and file manifest. It contains these wrappers, repair helpers and guides;
it requires the existing official MSI installation. After checking the
checksum, extract it and run
`bash ego-wine-integration-0.6.0.22-r1/scripts/linux/install-wine-launchers.sh`.

It installs `~/.local/bin/ego-lite-wine`, `~/.local/bin/ego-browser`, an
**ego lite (Wine)** desktop entry, and `~/.agents/skills/ego-browser/SKILL.md`.
Existing replacements, including an old `ego-browser` symlink and the complete
old skill directory, are moved into the printed backup directory under
`~/.local/state/ego-wine-launchers/`. Their relative paths are preserved.
The script does not change shell startup files; `~/.local/bin` must be on PATH.
Python 3 and the desktop's libX11 are used by the small window activation helper.
Quit ego before the first installation so its preview module can be repaired.
Reinstalling the integration after that repair is idempotent.
Opening the desktop launcher with no URL focuses the topmost visible ego window
belonging to this user and this Wine prefix. URL arguments are passed directly
to the official browser. The helper lives under `~/.local/lib/ego-wine/`.

The browser wrapper inherits the active display/session and uses:

```text
WINEARCH=wow64
WINEDLLOVERRIDES=wofutil=d;mscoree,mshtml=d
--disable-gpu
--disable-features=OptimizationGuideModelExecution
--optimization-guide-performance-class=8
```

These flags select software graphics and skip the optional on-device model
performance benchmark that failed under Wine. Stock Wine DLLs are used.
The native CLI receives its original arguments and stdin. For `nodejs`, the
wrapper first ensures this browser is running with those flags. Concurrent CLI
startup is locked; existing browser detection matches the executable, desktop
user, and dedicated prefix.

## Agent use and validation

Run `ego-browser skill` and follow the complete guide printed by the official
CLI. Linux heredocs work through the wrapper; paths inside the app's Node runtime
follow the Windows guide. The app retains its native TaskSpace, Page, and human
control model.

Installation alone does not certify a desktop run. Verify actual native CLI
snapshot, fill, click, prompt handling, persistence across a browser restart,
Spaces switching, and repeated desktop launches before calling the setup ready.
Cold-start failures are logged in
`~/.local/share/ego-wine/ego-browser-launch.log`. The wrappers select the highest
numeric installed CLI version, so rerun the live checks after a browser update.

## MSI verification — 2026-10-23

The official 0.6.0.22 browser passed semantic snapshots, typing, clicks, JavaScript
prompts, page reload persistence, and separate native CLI invocations. Additional
live checks passed HTTPS navigation, screenshots, storage persistence after
browser restart, and agent-to-user control handoff. The real Spaces interface
creates and switches spaces.

The software preview repair displays real page thumbnails in the native Spaces
switcher. Live changes to the test page appeared in its card, and both restored
and maximized window sizes passed visual checks. The repair uses the final
software-rendering flags above; the experimental Vulkan/DXVK configurations
were removed.
The profile and saved site data persisted, but the forced-restart test did not
restore the prior managed tab automatically; navigation back to the fixture
confirmed its saved state.

The MSI's previous community launcher and Windows desktop shortcut were moved
to the integration backup. The desktop shortcut named **ego lite (Wine)** uses
the official browser. Full vendor updates, video acceleration, and third-party
login flows have not been qualified.

The final launcher was tested from the MSI desktop after a clean native Quit.
Cold launch opened one browser window; opening the shortcut again reactivated
the same X11 window ID without adding a window. The original roughly one-minute startup was traced to the Windows updater
service repeatedly spawning processes. At its peak, 81 updater processes used
about 10.7 CPU cores. The dedicated-prefix service is now disabled, and a fully
stopped Wine session displayed the browser within about nine seconds.

Cold native-agent readiness measured 6.7–7.0 seconds after containing the
updater; the final cold launch plus all six agent checks completed in 8.738
seconds. Wine can still place an empty backing window in front when a new
TaskSpace opens. This is separate from the repaired thumbnails. The installed
entry skill includes a verified native-CDP restore/maximize step, applied once
at Space creation, that raises the real Spaces interface. The native switcher
then selects the agent page and displays its live preview. This is a qualified
workaround, not a claim that Wine window behavior matches macOS in every case.


## Repairs and updates

`configure-updater.py` reads the live Wine registry when applying changes, so
new service versions are found before Wine flushes its registry files. Its
read-only `--check` reports persisted state without starting Wine. It discovers
only vendor updater services whose executable
is inside this dedicated prefix. It preserves prior start modes before changing
them, disables the unsupported service, and stops only its matching updater and
COM processes. This avoids repeated background activation under Wine. Browser
updates must use the official offline installer; the helper prints the command.
Rerun the helper after an update because service names include the version.

`repair-previews.py` supports only the exact official 0.6.0.22 module. The native
software capture callback moves the shared-memory mapping into its release
context, then incorrectly reads the cleared pointer from the moved-from object.
At RVA `0x340046b` (file offset `0x33ffa6b`), the repair changes
`mov r8,[rax+8]` to `mov r8,[r13+8]`. This reads pixels from their actual owner
while preserving the original release callback and lifetime. Capture traces
showed successful frames, and read-only memory inspection showed the resulting
empty image model before this repair. The actual native cards displayed page
content immediately after it.

The script validates the complete module hash, instruction bytes, version and
installation path. It refuses to modify a running browser or an unknown build,
backs up the original, and replaces the module atomically. It changes no sandbox
or agent ownership controls. The local repair changes the module's vendor
signature; the vendor's original signed file remains in the backup.

| Module | SHA-256 |
| --- | --- |
| Original | `2b05f316636d69c025fdc45d51ba64ae7a9cf7527a201fe4ab733f6fa7c7abfa` |
| Repaired | `9772d11447f75f934fc6c5707dd4829cceabbd6ac782becb855d0f168913a97f` |

Inspect or reverse the repair as the MSI desktop user:

```bash
python3 ~/.local/lib/ego-wine/repair-previews.py --check
# Quit ego first to restore the verified original:
python3 ~/.local/lib/ego-wine/repair-previews.py --restore
```

The backup is under `~/.local/state/ego-wine-preview-repair/0.6.0.22/`.
A browser update requires new hash and code qualification before this repair
can be applied. Do not copy these four bytes into a different build.

See [the GPT Dot prompt](GPT-DOT-PROMPT.md) for the actual MSI agent workflow.
