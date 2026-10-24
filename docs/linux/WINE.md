# Official ego lite through Wine

This route runs the official Windows ego lite application and its bundled
`ego-browser.exe` on the MSI Linux desktop. The repository supplies two Linux
launch wrappers and an agent entry skill. Browser binaries and Wine DLLs are not
included or modified by the integration installer.

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

It installs `~/.local/bin/ego-lite-wine`, `~/.local/bin/ego-browser`, an
**ego lite (Wine)** desktop entry, and `~/.agents/skills/ego-browser/SKILL.md`.
Existing replacements, including an old `ego-browser` symlink and the complete
old skill directory, are moved into the printed backup directory under
`~/.local/state/ego-wine-launchers/`. Their relative paths are preserved.
The script does not change shell startup files; `~/.local/bin` must be on PATH.
Python 3 and the desktop's libX11 are used by the small window activation helper.
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

Space preview thumbnails remain blank in this Wine/software-rendering setup.
Disabling Windows native occlusion did not repair them and is not retained.
This is a known visual limitation; pixel parity with the Mac has not been met.
The profile and saved site data persisted, but the forced-restart test did not
restore the prior managed tab automatically; navigation back to the fixture
confirmed its saved state.

The MSI's previous community launcher and Windows desktop shortcut were moved
to the integration backup. The desktop shortcut named **ego lite (Wine)** uses
the official browser. Full vendor updates, video acceleration, and third-party
login flows have not been qualified.

The final launcher was tested from the MSI desktop after a clean native Quit.
Cold launch opened one browser window; opening the shortcut again reactivated
the same X11 window ID without adding a window. Cold startup took roughly a
minute on this remote desktop.
