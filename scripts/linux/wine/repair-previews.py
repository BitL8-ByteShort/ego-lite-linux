#!/usr/bin/env python3
"""Repair the software thumbnail pointer in the verified official Windows build.

Only the exact supported chrome.dll is eligible. Preserve the original and
refuse to replace a loaded browser module. --restore reverses this repair.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import tempfile


VERSION = "0.6.0.22"
ORIGINAL_SHA256 = "2b05f316636d69c025fdc45d51ba64ae7a9cf7527a201fe4ab733f6fa7c7abfa"
REPAIRED_SHA256 = "9772d11447f75f934fc6c5707dd4829cceabbd6ac782becb855d0f168913a97f"
PATCHES = (
    # Read pixels from the mapping's owner, preserving its release callback.
    (0x33FFA6B, bytes.fromhex("4c8b4008"), bytes.fromhex("4d8b4508")),
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def browser_running(prefix):
    expected = b"WINEPREFIX=" + os.fsencode(prefix)
    for process in Path("/proc").glob("[0-9]*"):
        try:
            if process.stat().st_uid != os.getuid():
                continue
            if expected not in (process / "environ").read_bytes().split(b"\0"):
                continue
            executable = (process / "cmdline").read_bytes().split(b"\0")[0]
            if executable.lower().replace(b"\\", b"/").endswith(b"/ego.exe"):
                return True
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--restore", action="store_true")
    args = parser.parse_args()
    if os.geteuid() == 0 or not Path("/proc").is_dir():
        raise SystemExit("Run as the Linux desktop user, without sudo.")
    prefix = Path.home() / ".local/share/ego-wine"
    application = prefix / "drive_c/users" / pwd.getpwuid(os.getuid()).pw_name / "AppData/Local/Citro Labs/ego lite/Application"
    if prefix.is_symlink() or not (application / "ego.exe").is_file():
        raise SystemExit("Expected the official browser in the dedicated ego Wine prefix.")
    versions = [p for p in application.iterdir() if p.is_dir() and
                all(x.isdigit() for x in p.name.split(".")) and
                (p / "ego-browser.exe").is_file()]
    if not versions:
        raise SystemExit("No official version directory found.")
    latest = max(versions, key=lambda p: tuple(map(int, p.name.split("."))))
    if latest.name != VERSION:
        raise SystemExit("Preview repair needs qualification for installed version " + latest.name)
    target = latest / "chrome.dll"
    if target.is_symlink() or not target.resolve().is_relative_to(prefix.resolve()):
        raise SystemExit("Refusing a module outside the dedicated Wine prefix.")
    data = target.read_bytes()
    current = digest(data)
    if current not in (ORIGINAL_SHA256, REPAIRED_SHA256):
        raise SystemExit("Unrecognized chrome.dll; no bytes changed.")
    for index, (offset, before, after) in enumerate(PATCHES):
        applied = current == REPAIRED_SHA256
        expected = after if applied else before
        if data[offset:offset + len(expected)] != expected:
            raise SystemExit("Instruction validation failed; no bytes changed.")
    status = "repaired" if current == REPAIRED_SHA256 else "original"
    if args.check:
        print(json.dumps({"version": VERSION, "status": status, "sha256": current}))
        return
    desired = ORIGINAL_SHA256 if args.restore else REPAIRED_SHA256
    if current == desired:
        print(json.dumps({"version": VERSION, "status": status, "changed": False}))
        return
    if browser_running(prefix):
        raise SystemExit("Quit ego before repairing/restoring its thumbnail module.")
    backup_dir = Path.home() / ".local/state/ego-wine-preview-repair" / VERSION
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backup_dir / "chrome.dll.original"
    if backup.exists():
        if backup.is_symlink() or digest(backup.read_bytes()) != ORIGINAL_SHA256:
            raise SystemExit("Original backup failed validation; no bytes changed.")
    elif not args.restore:
        with backup.open("xb") as output:
            os.chmod(backup, 0o600)
            original = bytearray(data)
            for offset, before, _after in PATCHES:
                original[offset:offset + len(before)] = before
            if digest(original) != ORIGINAL_SHA256:
                raise SystemExit("Original reconstruction failed; no bytes changed.")
            output.write(original)
            output.flush()
            os.fsync(output.fileno())
    else:
        raise SystemExit("Verified original backup is missing; no bytes changed.")
    repaired = bytearray(data)
    for offset, before, after in PATCHES:
        replacement = before if args.restore else after
        repaired[offset:offset + len(replacement)] = replacement
    if digest(repaired) != desired:
        raise SystemExit("Output validation failed; no bytes changed.")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".preview-repair-", delete=False) as output:
            temporary = Path(output.name)
            output.write(repaired)
            output.flush()
            os.fsync(output.fileno())
        shutil.copystat(target, temporary)
        if browser_running(prefix) or digest(target.read_bytes()) != current:
            raise SystemExit("Browser/module changed during repair; no bytes changed.")
        os.replace(temporary, target)
        print(json.dumps({"version": VERSION, "status": "original" if args.restore else "repaired",
                          "changed": True, "sha256": desired, "backup": str(backup)}))
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


if __name__ == "__main__":
    main()
