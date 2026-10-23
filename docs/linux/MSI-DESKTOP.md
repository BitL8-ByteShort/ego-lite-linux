# MSI installation and desktop checks — 2026-10-23

The tested x86_64 build is installed on the MSI and its Spaces controller is open in the desktop reached through RustDesk. Search Applications for **ego lite (Community Linux)**, or run:

```bash
~/.local/bin/ego-lite-msi
```

Use **Open personal browsing** for normal browsing and manual sign-in. This installation uses a fresh ego profile; it does not import the existing Chrome profile. Agents in that named profile share its sign-ins. The default user profile was left open with no agent tasks; qualification browsers were stopped.

There is an open desktop defect: an agent mouse click can bring its task window into the foreground. Window creation, navigation and filling a field preserved the foreground in the measured sequence; clicking changed it. The physical pointer remained unchanged in every step. Avoid running agent clicks alongside foreground work until this is repaired. The complete SDK suite does not test this desktop focus property.

## Installed payload and configuration

- Runtime: `6b1863f48b93697b31d66b703edb904553089fcb`, version `0.1.0-dev.0`, installed under `~/.local/lib/ego-lite-linux/`.
- The transferred archive's SHA-256 was verified on the MSI: `f007f64fb442f741ad1a7d81239e8416dfa556c1ea0832eff3f2a2a68a6f81de`.
- MSI GE63 Raider RGB 8RF, Ubuntu 24.04.5 LTS x86_64, Node 24.21.0.
- The system Chrome 155 was retained. Official Chrome for Testing 156.0.8078.47 was installed alongside it under `~/.local/share/ego-chromium/156.0.8078.47/`. Its normal testing-build banner remains visible.
- The pinned browser uses the existing root-owned system Chrome sandbox helper through `CHROME_DEVEL_SANDBOX`. Actual owned renderers had UID 1000, NoNewPrivs=1 and Seccomp=2; the browser used a private debugging pipe and no `--no-sandbox`. No root, AppArmor or global namespace changes were made.
- `~/.config/ego-lite-linux/msi-browser.env` selects that browser and helper. MSI wrapper commands are `ego-lite-msi` and `ego-browser-msi`; the Applications entry is `ego-lite-msi.desktop`. The original generated desktop entry was backed up in the configuration directory. Its normal filename is absent so the installer can recreate it during a future upgrade; remove any resulting duplicate Applications entry then.
- `.bashrc` and `.profile` source the browser environment so ordinary shell commands use the qualified browser. Both files were backed up before appending the marked block. Installed runtime and SDK files were not modified.
- The installed SDK and the suite's explicit `--sdk-path` bundle both hash to `d5825a11f17e37fe5ec39715cd63fa5fe85dbbab3aa837290437602bbb8eb0c6`.

## Results

| Check | Result |
|---|---|
| Installed full SDK suite on the usable RustDesk desktop | **81/81 passed; 1,346 assertions; 0 failures/skips; 229.8 s** |
| Native X11 clipboard and installer wrapper on that desktop | **8/8 passed, 0 skips**; saved original seven clipboard formats restored without logging their contents |
| Existing controller fixture | **20 assertions passed**, including reload, grants, hard pause, independent task, delegation and resume |
| Visible controller through RustDesk | Take control during a JavaScript dialog and held Fetch request revoked pending commands; independent B continued; Resume agent retained controlled keyboard input; Pause all stopped both tasks |
| Foreground and pointer | **Failed foreground preservation on agent click**; pointer preserved throughout |
| Actual physical X11 session | **71/81 passed, 10 failed, 0 skipped; 1,263 assertions**; not qualified |
| Native Wayland | Not run; no active native Wayland session |

RustDesk is connected to **GNOME/X11 on TigerVNC `VNC-0`, display `:1`**. It is a usable virtual desktop, not evidence of the physical laptop display. The actual Xorg session is display `:2`, internal `eDP-1` at 1920×1080. It contained a `gnome-session-failed` window whose process started October 5, before this installation, and had no active foreground window. Its full suite attempt failed ten cases; the passing virtual run does not replace that failure. No desktop session was restarted or logged out.

The visible controller checks used mouse clicks and keyboard text through the saved RustDesk connection. They were controlled fixtures, not a personal account login, MFA, full keyboard-navigation or screen-reader qualification. Raw evidence stays under ignored `work/linux/msi-desktop-20261023/` and `artifacts/linux/msi-desktop-20261023/` on the MSI and in this local checkout. The committed [receipt](evidence/2026-10-23-msi-desktop.json) contains both full case inventories and the failing focus measurement, without clipboard contents or personal desktop screenshots.

## Resume physical desktop qualification

Restore/log into the MSI's physical desktop first. Run these in a terminal in that visible desktop so DISPLAY/XAUTHORITY/backend refer to the current session:

```bash
cd ~/Projects/ego-lite-linux
. ~/.config/ego-lite-linux/msi-browser.env
export EGO_LINUX_PROFILE=desktop-qualification
export EGO_LINUX_AGENT_ID=msi-desktop-qualification
export EGO_LINUX_HEADLESS=0
export EGO_BROWSER_REAL_E2E_CLI="$HOME/.local/bin/ego-browser-msi"
unset EGO_BROWSER_REAL_E2E_ONLY
npm run e2e --prefix package/ego-browser
npm run test:control --prefix package/ego-linux-host
```

Repeat foreground/pointer, reveal/takeover/resume, clipboard and accessibility checks. The diagnostic focus probe is retained on the MSI at `work/linux/msi-desktop-20261023/desktop-focus-probe.py`; it must pass after fixing click activation. For native Wayland, use a genuine Wayland session and verify Chromium's Ozone backend in `chrome://gpu`; native clipboard paste remains explicitly unsupported before mutation. Personal sign-in/MFA remains for Chris to complete manually.
