import importlib.util
import json
import os
from pathlib import Path
import pwd
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'start-window-guard.py'
spec = importlib.util.spec_from_file_location('window_guard', SOURCE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ProcessIdentityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.process = self.root / '123'
        self.process.mkdir()
        self.prefix = Path('/home/example/.local/share/ego-wine')
        self.helper = Path('/home/example/.local/lib/ego-wine/window-guard.exe')
        (self.process / 'environ').write_bytes(b'WINEPREFIX=' + os.fsencode(self.prefix) + b'\0')
        (self.process / 'cmdline').write_bytes(b'Z:\\home\\example\\.local\\lib\\ego-wine\\window-guard.exe\0')
        self.stat('S')

    def stat(self, status):
        fields = [status] + ['0'] * 18 + ['5678']
        (self.process / 'stat').write_text('123 (helper with spaces) ' + ' '.join(fields))

    def identity(self):
        with patch.object(guard, 'Path', lambda p: self.root if p == '/proc' else Path(p)):
            return guard.identity(123, self.prefix, self.helper)

    def test_windows_path_and_process_birth_are_recognized(self):
        self.assertEqual(self.identity(), '5678')

    def test_other_prefix_is_never_reused_or_signalled(self):
        (self.process / 'environ').write_bytes(b'WINEPREFIX=/somewhere/else\0')
        self.assertIsNone(self.identity())

    def test_partial_executable_match_is_rejected(self):
        (self.process / 'cmdline').write_bytes(os.fsencode(str(self.helper) + '.other') + b'\0')
        self.assertIsNone(self.identity())

    def test_zombie_or_missing_process_is_not_running(self):
        self.stat('Z')
        self.assertIsNone(self.identity())
        (self.process / 'stat').unlink()
        self.assertIsNone(self.identity())


@unittest.skipUnless(Path('/proc').is_dir() and os.geteuid() != 0, 'Linux desktop user required')
class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        name = pwd.getpwuid(os.getuid()).pw_name
        self.app = self.home / '.local/share/ego-wine/drive_c/users' / name / 'AppData/Local/Citro Labs/ego lite/Application'
        self.version = self.app / '0.6.0.22'
        self.version.mkdir(parents=True)
        (self.app / 'ego.exe').write_bytes(b'fixture executable')
        (self.version / 'ego-browser.exe').write_bytes(b'fixture CLI')
        (self.version / 'chrome.dll').write_bytes(b'unknown build')
        helper = self.home / '.local/lib/ego-wine/window-guard.exe'
        helper.parent.mkdir(parents=True)
        helper.write_bytes(b'fixture helper')

    def invoke(self):
        return patch.object(guard.Path, 'home', return_value=self.home)

    def test_unknown_build_never_starts_native_memory_inspection(self):
        with self.invoke(), patch.dict(os.environ, DISPLAY=':1'), patch('sys.argv', ['guard']), patch.object(guard.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(SystemExit, 'Unrecognized ego module'):
                guard.main()
            spawn.assert_not_called()

    def test_newer_version_never_uses_old_vtable_offsets(self):
        newer = self.app / '0.6.0.23'
        newer.mkdir()
        (newer / 'ego-browser.exe').write_bytes(b'fixture CLI')
        with self.invoke(), patch.dict(os.environ, DISPLAY=':1'), patch('sys.argv', ['guard']), patch.object(guard.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(SystemExit, 'needs qualification'):
                guard.main()
            spawn.assert_not_called()

    def test_stop_does_not_signal_recycled_pid(self):
        state = self.home / '.local/state/ego-wine-window-guard'
        state.mkdir(parents=True)
        (state / 'process.json').write_text(json.dumps({'pid': 123, 'birth': 'old'}))
        with self.invoke(), patch('sys.argv', ['guard', '--stop']), patch.object(guard, 'identity', return_value='new'), patch.object(guard.os, 'pidfd_open') as open_pid:
            guard.main()
            open_pid.assert_not_called()
            self.assertFalse((state / 'process.json').exists())


if __name__ == '__main__':
    unittest.main()
