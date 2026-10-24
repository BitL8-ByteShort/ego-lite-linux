#!/usr/bin/env python3
"""Disable the unsupported Windows updater service only in ego's Wine prefix.

The official browser and updater binaries remain intact. --check performs no
Wine commands or mutations. Re-run after an official offline browser upgrade.
"""
import argparse
import ast
import datetime
import json
import os
import pathlib
import pwd
import re
import shlex
import signal
import subprocess
import time


def registry_sections(path):
    sections, current = {}, None
    for line in path.read_text(errors="replace").splitlines():
        if line.startswith("[") and "]" in line:
            current = line[1:line.index("]")].replace("\\\\", "\\")
            sections[current] = {}
        elif current and line.startswith('"') and "=" in line:
            name, value = line.split("=", 1)
            try:
                name = ast.literal_eval(name)
                if value.startswith("dword:"):
                    value = int(value[6:], 16)
                else:
                    value = ast.literal_eval(re.sub(r"^str\(\d+\):", "", value))
                sections[current][name] = value
            except (ValueError, SyntaxError):
                continue
    return sections


def live_registry_sections(output):
    """Parse only the service/COM values needed from reg.exe query output."""
    sections, current = {}, None
    for line in output.splitlines():
        if line.startswith("HKEY_LOCAL_MACHINE\\"):
            current = line.strip()
            sections[current] = {}
            continue
        match = re.match(r"^\s+(ImagePath|Start|LocalService)\s+REG_(\w+)\s+(.*)$", line)
        if current and match:
            name, kind, value = match.groups()
            if kind == "DWORD":
                value = int(value.strip(), 0)
            sections[current][name] = value
    return sections


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="read-only persisted configuration and process check")
    args = parser.parse_args()
    if os.geteuid() == 0 or not pathlib.Path("/proc").is_dir():
        raise SystemExit("Run as the Linux desktop user, without sudo.")
    home = pathlib.Path.home()
    prefix = home / ".local/share/ego-wine"
    wine = home / ".local/opt/ego-wine-runtime/opt/wine-devel/bin/wine"
    if prefix.is_symlink() or not (prefix / "system.reg").is_file():
        raise SystemExit("Expected the dedicated ~/.local/share/ego-wine prefix.")
    username = pwd.getpwuid(os.getuid()).pw_name
    application = prefix / "drive_c/users" / username / "AppData/Local/Citro Labs/ego lite/Application/ego.exe"
    if not application.is_file() or not application.resolve().is_relative_to(prefix.resolve()):
        raise SystemExit("The official ego browser is absent from the dedicated prefix.")
    env = dict(os.environ, WINEPREFIX=str(prefix), WINEARCH="wow64", WINEDEBUG="-all",
               WINEDLLOVERRIDES="wofutil=d;mscoree,mshtml=d")

    def run(*command, allow_failure=False):
        completed = subprocess.run([str(wine), *command], env=env, capture_output=True, text=True, timeout=30)
        if completed.returncode and not allow_failure:
            raise RuntimeError("Wine updater configuration command failed: " + command[0])
        return completed.stdout

    if args.check:
        sections = registry_sections(prefix / "system.reg")
    else:
        if not wine.is_file():
            raise SystemExit("The dedicated Wine runtime is missing.")
        # Wine can delay flushing system.reg after an offline upgrade. Discover
        # newly versioned services and their COM registrations from live state.
        services_output = run("reg.exe", "query", "HKLM\\SYSTEM\\CurrentControlSet\\Services", "/s")
        appids_output = run("reg.exe", "query", "HKLM\\Software\\Classes\\AppID", "/s")
        sections = live_registry_sections(services_output + "\n" + appids_output)

    def vendor_executable(image_path):
        # Accept only Citro's versioned updater installation, never another
        # service whose name happens to contain 'ego' or an arbitrary command.
        match = re.match(r'^"?(C:\\(?:Program Files \(x86\)|users\\[^\\]+\\AppData\\Local)\\Citro Labs\\EgoUpdater\\[0-9]+(?:\.[0-9]+)+\\updater\.exe)"?(?:\s|$)', image_path, re.I)
        if not match:
            return None
        windows = pathlib.PureWindowsPath(match.group(1))
        local = prefix / "drive_c" / pathlib.Path(*windows.parts[1:])
        if not local.is_file() or not local.resolve().is_relative_to(prefix.resolve()):
            return None
        return str(windows)

    services = []
    for key, values in sections.items():
        match = re.fullmatch(r"(?:System\\ControlSet001|HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet)\\Services\\([^\\]+)", key, re.I)
        image_path = values.get("ImagePath", "")
        executable = vendor_executable(image_path) if isinstance(image_path, str) else None
        if match and executable:
            services.append({"name": match.group(1), "imagePath": image_path,
                             "executable": executable, "start": values.get("Start")})
    names = {s["name"].lower() for s in services}
    com_ids = set()
    for key, values in sections.items():
        if str(values.get("LocalService", "")).lower() in names:
            match = re.search(r"\\AppID\\(\{[0-9a-f-]+\})$", key, re.I)
            if match:
                com_ids.add(match.group(1).lower())

    def matching_process(proc):
        expected = b"WINEPREFIX=" + os.fsencode(prefix)
        try:
            if expected not in (proc / "environ").read_bytes().split(b"\0"):
                return None
            cmd = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
            is_updater = bool(vendor_executable(cmd))
            com = re.search(r"/PROCESSID:(\{[0-9a-f-]+\})", cmd, re.I)
            is_com = "dllhost.exe" in cmd.lower() and com and com.group(1).lower() in com_ids
            if is_updater or is_com:
                return (proc / "stat").read_text().rsplit(")", 1)[1].split()[19]
        except (OSError, ValueError, IndexError):
            pass
        return None

    def matching_processes():
        result = {}
        for proc in pathlib.Path("/proc").iterdir():
            if not proc.name.isdigit():
                continue
            stamp = matching_process(proc)
            if stamp is not None:
                result[int(proc.name)] = stamp
        return result

    if args.check:
        print(json.dumps({"mode": "check", "prefix": str(prefix), "services": services,
                          "registrySource": "persisted system.reg",
                          "associatedComIds": sorted(com_ids), "updaterProcesses": sorted(matching_processes())}, indent=2))
        return
    if not services:
        raise SystemExit("No matching official updater service found in the live Wine registry; configuration was not certified.")

    changes = []
    for service in services:
        key = "HKLM\\SYSTEM\\CurrentControlSet\\Services\\" + service["name"]
        image = run("reg.exe", "query", key, "/v", "ImagePath")
        match = re.search(r"ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)", image)
        if not match or vendor_executable(match.group(1).strip()) != service["executable"]:
            raise RuntimeError("Service image changed during validation; no changes made to that service.")
        value = run("reg.exe", "query", key, "/v", "Start")
        match = re.search(r"Start\s+REG_DWORD\s+(0x[0-9a-f]+|[0-9]+)", value, re.I)
        if not match:
            raise RuntimeError("Cannot read the updater service start mode.")
        service["start"] = int(match.group(1), 0)
        if service["start"] != 4:
            changes.append(service)
    backup = None
    if changes:
        backup_dir = home / ".local/state/ego-wine-updater"
        backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        backup = backup_dir / ("before-" + stamp + ".json")
        with backup.open("x") as stream:
            os.chmod(backup, 0o600)
            json.dump({"prefix": str(prefix), "services": changes}, stream, indent=2)
    for service in changes:
        run("sc.exe", "config", service["name"], "start=", "disabled")
    for service in services:
        key = "HKLM\\SYSTEM\\CurrentControlSet\\Services\\" + service["name"]
        value = run("reg.exe", "query", key, "/v", "Start")
        if not re.search(r"Start\s+REG_DWORD\s+(?:0x0*4|4)\b", value, re.I):
            raise RuntimeError("Updater service was not disabled: " + service["name"])
        run("sc.exe", "stop", service["name"], allow_failure=True)

    stopped = set()
    # Re-check prefix, executable and process creation time before each signal.
    # SIGKILL is a bounded fallback for Wine processes ignoring SIGTERM.
    for sig in (signal.SIGTERM, signal.SIGKILL):
        candidates = matching_processes()
        for pid, stamp in candidates.items():
            pidfd = None
            try:
                # A pidfd keeps the signal attached to this process even if its
                # PID is recycled between the identity check and the signal.
                pidfd = os.pidfd_open(pid)
                if matching_process(pathlib.Path("/proc") / str(pid)) != stamp:
                    continue
                signal.pidfd_send_signal(pidfd, sig)
                stopped.add(pid)
            except ProcessLookupError:
                pass
            finally:
                if pidfd is not None:
                    os.close(pidfd)
        time.sleep(0.5)
    remaining = sorted(matching_processes())
    print(json.dumps({"mode": "configured", "servicesDisabled": [s["name"] for s in services],
                      "registrySource": "live Wine registry",
                      "changed": len(changes), "backup": str(backup) if backup else None,
                      "stoppedProcesses": sorted(stopped), "remainingProcesses": remaining}, indent=2))
    print("Manual updates: close ego and obtain the official Windows offline mini_installer_uncompressed.exe with its manifest SHA256 verified. Browser/updater binaries were preserved. Run:")
    print(shlex.join(["env", "WINEPREFIX=" + str(prefix), "WINEARCH=wow64", "WINEDEBUG=-all",
                      "WINEDLLOVERRIDES=wofutil=d;mscoree,mshtml=d", str(wine),
                      "/path/to/mini_installer_uncompressed.exe", "--verbose-logging",
                      "--do-not-launch-chrome", "--ego-lite"]))
    print(shlex.join(["python3", str(home / ".local/lib/ego-wine/configure-updater.py")]))
    if remaining:
        raise SystemExit("Updater processes remain; configuration needs attention.")


if __name__ == "__main__":
    main()
