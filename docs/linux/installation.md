# Install the community Linux host

This additive host uses stock Chrome/Chromium and the upstream ego SDK. It requires Node.js 22 or later as `node` on `PATH`, separately installed Chrome/Chromium with its sandbox working, and `/usr/bin/flock` from the `util-linux` package for exclusive daemon startup. Chromium 156 is the tested browser baseline; the installer rejects older majors. A newer major can pass the version preflight but remains unqualified until its real browser tests pass. The initial target is Ubuntu 24.04+ / Debian-family x86_64. An ARM64 archive is best effort until separately qualified. No root installation, default-browser change, or personal-profile import is performed.

Build the SDK and host, then create the relocatable archive from the repository root:

```bash
npm run build --prefix package/ego-browser
npm run build --prefix package/ego-linux-host
node package/ego-linux-host/scripts/package.mjs
```

The result is `artifacts/linux/ego-lite-linux-0.1.0-dev.0-linux-x64.tar.gz`, its `.sha256` checksum, and a versioned `.manifest.json` containing each payload file's SHA-256, host version and source commit. Packaging copies the runtime, matching guides, entry skill, learnings, desktop assets and MIT license. It includes no Node dependencies or source-tree symlinks. Node and the browser remain external requirements.

Verify the archive checksum, extract it anywhere, and run its installer:

```bash
cd /path/to/downloads
sha256sum --check ego-lite-linux-0.1.0-dev.0-linux-x64.tar.gz.sha256
tar -xzf ego-lite-linux-0.1.0-dev.0-linux-x64.tar.gz
cd ego-lite-linux-0.1.0-dev.0-linux-x64
node host/scripts/install.mjs --prefix "$HOME/.local"
"$HOME/.local/bin/ego-browser" doctor --json
"$HOME/.local/bin/ego-lite"
```

The default prefix is `~/.local`. Any explicit prefix, including paths with spaces, is supported. Add its `bin` directory to `PATH` for ordinary use. If a custom prefix is not in your desktop environment's application search path, launch its `bin/ego-lite` directly. The installer writes the desktop entry to `<prefix>/share/applications/ego-lite-linux.desktop`; `--no-desktop` omits it. The desktop entry has the community Linux name and an absolute executable path.

You may also supply an archive or extracted payload explicitly to an installer from this checkout or another matching payload:

```bash
node package/ego-linux-host/scripts/install.mjs \
  --artifact /path/to/ego-lite-linux-0.1.0-dev.0-linux-x64.tar.gz \
  --prefix "/path/to/user prefix"
```

Installation verifies the complete payload inventory and hashes, rejects links and unsafe archive paths, checks Node on `PATH`, and refuses unrelated command/desktop/installation conflicts. On Linux, it requires a successful Chrome/Chromium `--version` probe and `/usr/bin/flock --version` identifying util-linux before changing an installed version. Set `EGO_LINUX_CHROME_PATH` to an absolute executable path for a custom browser; an invalid explicit selection fails without falling back to another browser. Successful installation prints the actual prerequisite versions and installed doctor configuration summary. These checks do not establish working Chromium sandbox startup; run the real browser qualification for that evidence. It stages the versioned payload under `<prefix>/lib/ego-lite-linux/<version>` before switching owned launchers. A failed switch restores the previous links and desktop entry. Repeating the same installation is safe; a different payload must use a different version. Older owned versions remain available until uninstall. Move or delete the checkout and extracted archive after installation; neither is needed to run the installed commands.

Profile and sign-in data are stored separately under `$XDG_DATA_HOME/ego-lite-linux` (default `~/.local/share/ego-lite-linux`), with configuration under `$XDG_CONFIG_HOME/ego-lite-linux`. They remain in place during upgrades and uninstall. Shared-profile tasks use the same website sessions; use named profiles for separate accounts.

Run the installed uninstaller after stopping the owned browser:

```bash
"$HOME/.local/bin/ego-browser" stop
node "$HOME/.local/lib/ego-lite-linux/current/host/scripts/uninstall.mjs" \
  --prefix "$HOME/.local"
```

Uninstall removes only owned launchers, an unchanged owned desktop entry, and verified version directories. Replaced commands, modified payloads and unrelated files are retained and reported. It always retains profiles and sign-ins. Deleting personal browsing data is a separate explicit action.

Installer contracts are portable fixtures; actual installed-browser qualification requires Linux:

```bash
node --test package/ego-linux-host/scripts/install.test.mjs
npm run test:install --prefix package/ego-linux-host
```

`test:install` first runs the installer contracts, then packages the actual build, moves its archive, installs into a prefix with spaces, removes the moved archive, and runs the real SDK in an unrelated working directory. It checks navigation, snapshots, click input, a second CLI round and an explicit installed `--sdk-path`. It then stops the owned browser and daemon, switches to a temporary next-version payload, restarts, and verifies persistent cookies, localStorage and IndexedDB before uninstalling. The default uses the same compiled code across that version switch; its receipt reports `sameCodeUpgrade: true` and `codeUpgradeQualified: false`.

For an actual code-change upgrade, set `EGO_LINUX_TEST_ARTIFACT` to the selected current archive and `EGO_LINUX_TEST_PREVIOUS_ARTIFACT` to an older archive containing different compiled host code. The test rejects an explicit previous artifact with an identical runtime digest. It installs that prior payload first, then upgrades to a temporary next version containing the exact current runtime and SDK. The selected archives and source package versions remain unchanged. Its sanitized receipt under ignored `artifacts/linux/install-receipt.json` records both runtime hashes, archive hashes, generation change, preserved stores and `codeUpgradeQualified`. It fails when Linux or a working sandboxed browser is unavailable; a portable fixture pass does not qualify a browser or desktop.
