#!/usr/bin/env python3
"""Start one native window guard for this user's qualified ego Wine build."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import signal
import subprocess
import time

VERSION = "0.6.0.22"
QUALIFIED = {
    "2b05f316636d69c025fdc45d51ba64ae7a9cf7527a201fe4ab733f6fa7c7abfa",
    "9772d11447f75f934fc6c5707dd4829cceabbd6ac782becb855d0f168913a97f",
}


def identity(pid, prefix, helper):
    """Identify the helper by UID, prefix, complete executable argument and birth."""
    try:
        process = Path("/proc") / str(pid)
        if process.stat().st_uid != os.getuid():
            return None
        if b"WINEPREFIX=" + os.fsencode(prefix) not in (process / "environ").read_bytes().split(b"\0"):
            return None
        arguments = (process / "cmdline").read_bytes().split(b"\0")
        allowed = {str(helper).lower(), ("z:" + str(helper)).lower()}
        if not any(os.fsdecode(a).replace("\\", "/").lower() in allowed for a in arguments):
            return None
        fields = (process / "stat").read_text().rsplit(")", 1)[1].split()
        if fields[0] == "Z":
            return None
        return fields[19]
    except (OSError, ValueError, IndexError):
        return None


def fingerprint(path):
    stat = path.stat()
    return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()
    if os.geteuid() == 0 or not Path("/proc").is_dir():
        raise SystemExit("Run as the Linux desktop user, without sudo.")
    home = Path.home()
    prefix = home / ".local/share/ego-wine"
    helper = home / ".local/lib/ego-wine/window-guard.exe"
    wine = home / ".local/opt/ego-wine-runtime/opt/wine-devel/bin/wine"
    if prefix.is_symlink() or not prefix.is_dir():
        raise SystemExit("Expected the dedicated ego Wine prefix.")
    state_dir = home / ".local/state/ego-wine-window-guard"
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    record = state_dir / "process.json"
    with (state_dir / "start.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            prior = json.loads(record.read_text())
        except (OSError, ValueError):
            prior = {}
        pid = prior.get("pid")
        stamp = identity(pid, prefix, helper) if isinstance(pid, int) else None
        running = stamp is not None and stamp == prior.get("birth")
        if args.stop:
            if running:
                try:
                    pidfd = os.pidfd_open(pid)
                    try:
                        if identity(pid, prefix, helper) == stamp:
                            signal.pidfd_send_signal(pidfd, signal.SIGTERM)
                    finally:
                        os.close(pidfd)
                except ProcessLookupError:
                    pass
                deadline = time.monotonic() + 2
                while identity(pid, prefix, helper) == stamp and time.monotonic() < deadline:
                    time.sleep(0.05)
                if identity(pid, prefix, helper) == stamp:
                    raise SystemExit("The previous native window guard has not stopped.")
            record.unlink(missing_ok=True)
            (state_dir / "native-window.json").unlink(missing_ok=True)
            return
        username = pwd.getpwuid(os.getuid()).pw_name
        application = prefix / "drive_c/users" / username / "AppData/Local/Citro Labs/ego lite/Application"
        versions = [p for p in application.iterdir() if p.is_dir() and
                    all(x.isdigit() for x in p.name.split(".")) and
                    (p / "ego-browser.exe").is_file()]
        latest = max(versions, key=lambda p: tuple(map(int, p.name.split(".")))) if versions else None
        if latest is None or latest.name != VERSION:
            raise SystemExit("Native window guard needs qualification for the installed ego version.")
        module = latest / "chrome.dll"
        for path in (module, application / "ego.exe"):
            if path.is_symlink() or not path.resolve().is_relative_to(prefix.resolve()):
                raise SystemExit("Refusing a browser outside the dedicated prefix.")
        files = {"module": fingerprint(module), "helper": fingerprint(helper)}
        if running and prior.get("files") == files:
            return
        if not os.environ.get("DISPLAY"):
            raise SystemExit("The native ego window guard requires the active X11 display.")
        if running:
            raise SystemExit("Stop the previous window guard before replacing its qualified files.")
        if hashlib.sha256(module.read_bytes()).hexdigest() not in QUALIFIED:
            raise SystemExit("Unrecognized ego module; native window guard was not started.")
        c_application = f"C:/users/{username}/AppData/Local/Citro Labs/ego lite/Application"
        arguments = [c_application + "/ego.exe", "Z:" + str(application / "ego.exe"),
                     c_application + f"/{VERSION}/chrome.dll", "Z:" + str(module),
                     "Z:" + str(state_dir / "native-window.json")]
        env = dict(os.environ, WINEPREFIX=str(prefix), WINEARCH="wow64", WINEDEBUG="-all",
                   WINEDLLOVERRIDES="wofutil=d;mscoree,mshtml=d")
        with (state_dir / "guard.log").open("ab") as log:
            (state_dir / "native-window.json").unlink(missing_ok=True)
            process = subprocess.Popen([str(wine), str(helper), *arguments], env=env,
                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        # Popen has completed exec; Linux Wine preserves this PID while loading
        # the PE helper. The native named mutex is a second singleton guard.
        birth = identity(process.pid, prefix, helper)
        if birth is None:
            raise SystemExit("Native window guard exited during startup; inspect " + str(state_dir / "guard.log"))
        temporary = record.with_suffix(".tmp")
        temporary.write_text(json.dumps({"pid": process.pid, "birth": birth, "files": files}))
        os.replace(temporary, record)


if __name__ == "__main__":
    main()
