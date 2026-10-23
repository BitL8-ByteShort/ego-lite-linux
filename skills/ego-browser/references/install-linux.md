# Install or upgrade the Linux community build

This fork supplies a Linux host around the upstream ego SDK and sandboxed
Chrome/Chromium. It is a community build; the proprietary native ego lite
application is not included. Start with Ubuntu 24.04+ or a compatible
Debian-family desktop, Node.js 22+, and sandbox-capable Chrome/Chromium. ARM64
and other distributions remain best-effort until tested.

## Install a verified artifact

Use a versioned artifact and SHA-256 manifest supplied by this fork. Verify its
checksum (substitute the supplied VERSION and ARCH), extract it to a directory
you own, then run the included installer:

```bash
sha256sum -c ego-lite-linux-VERSION-linux-ARCH.tar.gz.sha256
node /absolute/path/to/extracted/host/scripts/install.mjs \
  --artifact /absolute/path/to/extracted --prefix "$HOME/.local"
```

Add `$HOME/.local/bin` to PATH if needed, then check:

```bash
ego-browser doctor --json
ego-browser skill
ego-lite
```

`skill` should end with `[ego-browser:skill] end of guide` and label its first
line `(linux)`. It does not need a running browser. Follow actionable doctor
errors before launching automation. Do not disable Chromium's sandbox, attach
to a personal debugging port, or copy a live browser profile to fix setup.

The Spaces controller manages named profiles, personal browsing, task tabs and
human control. Sign in through the owned browser yourself; MFA stays a human
step. Normal restarts and upgrades preserve sign-ins. Tasks in one profile
share cookies, accounts and website storage. Create separate named profiles for
separate accounts; task ownership separates tabs and commands.

## Agent workflow

Run `ego-browser skill` and follow its Linux identity instructions. Generate and
record a non-secret random `EGO_LINUX_AGENT_ID` once per user goal. Keep the exact
same value for every invocation and round; export it again in each new shell.
Concurrent agents use different identities. Never rotate identities or create
replacement tasks to bypass another agent's ownership or a human pause.

The controller's Take control and Pause all revoke agent control. Only the
human's Resume agent clears a hard pause. `takeOverTaskSpace()` can resume a
normal delegated handoff after confirmation, but cannot bypass a hard pause.

## Native clipboard

X11 native paste needs Python 3, libX11 and libXfixes (`python3`, `libx11-6` and `libxfixes3` on
Debian/Ubuntu). It saves supported byte formats including text/HTML, serializes
cooperating processes and restores only if it still owns the clipboard. It
refuses unsupported targets, unreadable data and incremental large transfers
before changing the clipboard. Restored X11 data needs a small selection owner
process until another application replaces it.

Native Wayland preservation is unavailable. Paste fails before mutation,
including with XWayland in a Wayland session. Use `page.keyboard.insertText()`
for plain text; native rich paste requires X11. Do not report an unavailable
native paste as successful.

## Upgrade or remove

Stop the owned browser before replacing a running installation:

```bash
ego-browser stop
```

Install the newer verified artifact with the same prefix. Profiles persist.
The artifact's uninstall command removes binaries and desktop integration;
profile data stays unless the user separately and explicitly requests deletion.
Do not delete cookies/storage as an upgrade or ownership workaround.

After installation or upgrade, run doctor, read skill, then return to the
original task. Qualify X11 and Wayland on the intended desktop separately;
container or Xvfb results cover only that environment.
