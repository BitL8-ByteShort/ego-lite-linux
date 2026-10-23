// Python uses the system Xlib directly so every offered format can be inspected
// before mutation. Keep this inline: the SDK is distributed as a single bundle.
export const LINUX_CLIPBOARD_HOST = String.raw`
import ctypes as C
import ctypes.util
import fcntl
import json
import os
import re
import select
import stat
import sys
import tempfile
import time

class ClipboardError(Exception):
    def __init__(self, message, code="EGO_CLIPBOARD_UNSAFE_FORMAT"):
        super().__init__(message)
        self.code = code

def emit(state, **fields):
    print(json.dumps(dict(state=state, **fields)), flush=True)

def lock_clipboard():
    root = os.environ.get("XDG_RUNTIME_DIR")
    if root:
        info = os.lstat(root)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ClipboardError("XDG_RUNTIME_DIR must be an owned private directory", "EGO_CLIPBOARD_UNAVAILABLE")
    else:
        root = tempfile.gettempdir()
    directory = os.path.join(root, "ego-browser-clipboard-" + str(os.getuid()))
    try:
        os.mkdir(directory, 0o700)
    except FileExistsError:
        pass
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory_fd)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ClipboardError("clipboard lock directory must be owned and private", "EGO_CLIPBOARD_UNAVAILABLE")
        # Display aliases such as :0 and :0.0 share one clipboard.
        name = "clipboard.lock"
        fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
        os.close(fd)
        raise ClipboardError("clipboard lock file must be an owned private regular file", "EGO_CLIPBOARD_UNAVAILABLE")
    deadline = time.monotonic() + 5
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                raise ClipboardError("another ego-browser process is using the clipboard", "EGO_CLIPBOARD_BUSY")
            time.sleep(0.02)

UL = C.c_ulong
D = C.c_void_p
class SelectionRequest(C.Structure):
    _fields_ = [("type", C.c_int), ("serial", UL), ("send_event", C.c_int), ("display", D),
                ("owner", UL), ("requestor", UL), ("selection", UL), ("target", UL), ("property", UL), ("time", UL)]
class SelectionNotify(C.Structure):
    _fields_ = [("type", C.c_int), ("serial", UL), ("send_event", C.c_int), ("display", D),
                ("requestor", UL), ("selection", UL), ("target", UL), ("property", UL), ("time", UL)]
class PropertyNotify(C.Structure):
    _fields_ = [("type", C.c_int), ("serial", UL), ("send_event", C.c_int), ("display", D),
                ("window", UL), ("atom", UL), ("time", UL), ("state", C.c_int)]
class Event(C.Union):
    _fields_ = [("type", C.c_int), ("request", SelectionRequest), ("selection", SelectionNotify),
                ("property", PropertyNotify), ("pad", C.c_long * 24)]

class XClipboard:
    def __init__(self):
        library = ctypes.util.find_library("X11")
        if not library:
            raise ClipboardError("Linux X11 paste requires libX11 (Debian/Ubuntu: libx11-6)", "EGO_CLIPBOARD_UNAVAILABLE")
        self.x = C.CDLL(library)
        signatures = {
            "XOpenDisplay": ([C.c_char_p], D), "XDefaultRootWindow": ([D], UL),
            "XCreateSimpleWindow": ([D, UL, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_uint, UL, UL], UL),
            "XInternAtom": ([D, C.c_char_p, C.c_int], UL), "XGetAtomName": ([D, UL], D),
            "XGetSelectionOwner": ([D, UL], UL), "XSetSelectionOwner": ([D, UL, UL, UL], C.c_int),
            "XConvertSelection": ([D, UL, UL, UL, UL, UL], C.c_int),
            "XGetWindowProperty": ([D, UL, UL, C.c_long, C.c_long, C.c_int, UL, C.POINTER(UL), C.POINTER(C.c_int), C.POINTER(UL), C.POINTER(UL), C.POINTER(D)], C.c_int),
            "XChangeProperty": ([D, UL, UL, UL, C.c_int, C.c_int, D, C.c_int], C.c_int),
            "XDeleteProperty": ([D, UL, UL], C.c_int), "XFree": ([D], C.c_int),
            "XPending": ([D], C.c_int), "XNextEvent": ([D, C.POINTER(Event)], C.c_int),
            "XSendEvent": ([D, UL, C.c_int, C.c_long, C.POINTER(Event)], C.c_int),
            "XMaxRequestSize": ([D], C.c_long), "XConnectionNumber": ([D], C.c_int), "XFlush": ([D], C.c_int),
            "XSync": ([D, C.c_int], C.c_int), "XSelectInput": ([D, UL, C.c_long], C.c_int),
            "XGrabServer": ([D], C.c_int), "XUngrabServer": ([D], C.c_int), "XCloseDisplay": ([D], C.c_int),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.x, name)
            function.argtypes, function.restype = args, result
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise ClipboardError("cannot open X11 DISPLAY; run paste in the browser's desktop session, or use keyboard.insertText()", "EGO_CLIPBOARD_UNAVAILABLE")
        # A requestor may close its window while we answer a selection request.
        self.error_handler = C.CFUNCTYPE(C.c_int, D, D)(lambda display, error: 0)
        self.x.XSetErrorHandler.argtypes = [C.c_void_p]
        self.x.XSetErrorHandler(self.error_handler)
        self.window = self.x.XCreateSimpleWindow(self.display, self.x.XDefaultRootWindow(self.display), 0, 0, 1, 1, 0, 0, 0)
        self.x.XSelectInput(self.display, self.window, 1 << 22)
        self.selection = self.atom("CLIPBOARD")
        self.property = self.atom("EGO_CLIPBOARD_DATA")
        self.timestamp_property = self.atom("EGO_CLIPBOARD_TIME")
        self.values = {}
        self.timestamp = 0
        self.epoch = 0
        self.max_bytes = (self.x.XMaxRequestSize(self.display) - 64) * 4
        fixes_library = ctypes.util.find_library("Xfixes")
        if not fixes_library:
            raise ClipboardError("safe X11 paste requires libXfixes (Debian/Ubuntu: libxfixes3)", "EGO_CLIPBOARD_UNAVAILABLE")
        self.fixes = C.CDLL(fixes_library)
        self.fixes.XFixesQueryExtension.argtypes = [D, C.POINTER(C.c_int), C.POINTER(C.c_int)]
        self.fixes.XFixesSelectSelectionInput.argtypes = [D, UL, UL, UL]
        base, error = C.c_int(), C.c_int()
        if not self.fixes.XFixesQueryExtension(self.display, C.byref(base), C.byref(error)):
            raise ClipboardError("X11 server needs XFixes for safe clipboard ownership tracking", "EGO_CLIPBOARD_UNAVAILABLE")
        self.fixes_event = base.value
        self.fixes.XFixesSelectSelectionInput(self.display, self.window, self.selection, 7)
        self.drain()

    def observe(self, event):
        if event.type == self.fixes_event:
            self.epoch += 1

    def drain(self):
        self.x.XSync(self.display, False)
        while self.x.XPending(self.display):
            event = Event()
            self.x.XNextEvent(self.display, C.byref(event))
            self.observe(event)
            self.answer(event)

    def atom(self, name):
        return self.x.XInternAtom(self.display, name.encode(), False)

    def name(self, atom):
        value = self.x.XGetAtomName(self.display, atom)
        if not value:
            raise ClipboardError("clipboard advertised an invalid native target")
        try:
            return C.string_at(value).decode("ascii")
        finally:
            self.x.XFree(value)

    def owner(self):
        return self.x.XGetSelectionOwner(self.display, self.selection)

    def put(self, window, property, value):
        native_type, format, data = value
        if format == 32:
            buffer = (UL * len(data))(*data)
        else:
            buffer = (C.c_ubyte * len(data)).from_buffer_copy(data)
        self.x.XChangeProperty(self.display, window, property, native_type, format, 0, C.cast(buffer, D), len(data))

    def get(self, property):
        native_type, format, count, remaining, value = UL(), C.c_int(), UL(), UL(), D()
        status = self.x.XGetWindowProperty(self.display, self.window, property, 0, 2 * 1024 * 1024, False, 0,
            C.byref(native_type), C.byref(format), C.byref(count), C.byref(remaining), C.byref(value))
        try:
            if status or remaining.value or native_type.value == self.atom("INCR"):
                raise ClipboardError("clipboard format needs an unsupported incremental/large transfer; use keyboard.insertText()")
            if format.value == 8:
                data = C.string_at(value, count.value)
            elif format.value == 32:
                data = list(C.cast(value, C.POINTER(UL))[:count.value])
            else:
                raise ClipboardError("clipboard format cannot be preserved safely; use keyboard.insertText()")
            return native_type.value, format.value, data
        finally:
            if value:
                self.x.XFree(value)
            self.x.XDeleteProperty(self.display, self.window, property)

    def next_event(self, deadline):
        while not self.x.XPending(self.display):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ClipboardError("clipboard owner did not answer; clipboard was not changed", "EGO_CLIPBOARD_UNAVAILABLE")
            select.select([self.x.XConnectionNumber(self.display)], [], [], remaining)
        event = Event()
        self.x.XNextEvent(self.display, C.byref(event))
        self.observe(event)
        return event

    def convert(self, target):
        self.x.XConvertSelection(self.display, self.selection, target, self.property, self.window, 0)
        self.x.XFlush(self.display)
        deadline = time.monotonic() + 3
        while True:
            event = self.next_event(deadline)
            if event.type == 31 and event.selection.requestor == self.window and event.selection.target == target:
                if not event.selection.property:
                    raise ClipboardError("clipboard owner refused a format; clipboard was not changed")
                return self.get(event.selection.property)

    def server_time(self):
        self.put(self.window, self.timestamp_property, (self.atom("INTEGER"), 8, b"1"))
        self.x.XFlush(self.display)
        deadline = time.monotonic() + 3
        while True:
            event = self.next_event(deadline)
            if event.type == 28 and event.property.atom == self.timestamp_property:
                return event.property.time
            self.answer(event)

    def snapshot(self):
        self.drain()
        owner, epoch = self.owner(), self.epoch
        if not owner:
            return owner, epoch, {}
        targets_type, targets_format, targets = self.convert(self.atom("TARGETS"))
        if targets_format != 32 or targets_type != self.atom("ATOM") or len(targets) > 256:
            raise ClipboardError("clipboard target list cannot be preserved safely")
        names = {target: self.name(target) for target in targets}
        values, total = {}, 0
        for target, name in names.items():
            if name in ("TARGETS", "TIMESTAMP", "MULTIPLE", "SAVE_TARGETS"):
                continue
            # Protocol/resource targets can mutate the owner or refer to X resources
            # that disappear on ownership loss. Never request or silently drop them.
            if name not in ("UTF8_STRING", "STRING", "TEXT", "COMPOUND_TEXT") and not re.fullmatch(r"[\w!#$&^.+-]+/[\w!#$&^.+-]+(?:;[\w= .+-]+)?", name):
                raise ClipboardError("unsupported native clipboard target " + name + "; use keyboard.insertText()")
            value = self.convert(target)
            if value[1] != 8:
                raise ClipboardError("clipboard contains a resource-backed format; use keyboard.insertText()")
            if len(value[2]) > self.max_bytes:
                raise ClipboardError("clipboard format exceeds the safe non-incremental transfer limit; use keyboard.insertText()")
            total += len(value[2])
            if total > 8 * 1024 * 1024:
                raise ClipboardError("clipboard exceeds the safe snapshot limit; use keyboard.insertText()")
            values[target] = value
        self.drain()
        if self.owner() != owner or self.epoch != epoch:
            raise ClipboardError("clipboard changed while it was being saved; retry after the user finishes copying", "EGO_CLIPBOARD_CHANGED")
        return owner, epoch, values

    def publish(self, values):
        if any(len(value[2]) > self.max_bytes for value in values.values()):
            raise ClipboardError("paste content exceeds the safe native transfer limit; use keyboard.insertText()")
        self.values = values
        self.timestamp = self.server_time()
        self.x.XSetSelectionOwner(self.display, self.selection, self.window, self.timestamp)
        self.x.XSync(self.display, False)
        if self.owner() != self.window:
            raise ClipboardError("could not acquire the X11 clipboard", "EGO_CLIPBOARD_UNAVAILABLE")

    def answer(self, event):
        if event.type != 30:
            return
        request = event.request
        property = request.property or request.target
        value = self.values.get(request.target)
        if request.target == self.atom("TARGETS"):
            value = (self.atom("ATOM"), 32, list(self.values) + [self.atom("TARGETS"), self.atom("TIMESTAMP")])
        elif request.target == self.atom("TIMESTAMP"):
            value = (self.atom("INTEGER"), 32, [self.timestamp])
        if value is not None and request.selection == self.selection and self.owner() == self.window:
            self.put(request.requestor, property, value)
        else:
            property = 0
        reply = Event()
        reply.selection = SelectionNotify(31, 0, True, self.display, request.requestor, request.selection, request.target, property, request.time)
        self.x.XSendEvent(self.display, request.requestor, False, 0, C.byref(reply))
        self.x.XFlush(self.display)

    def serve(self, until_stdin=False):
        while self.owner() == self.window:
            while self.x.XPending(self.display):
                event = Event()
                self.x.XNextEvent(self.display, C.byref(event))
                self.observe(event)
                self.answer(event)
            fds = [self.x.XConnectionNumber(self.display)] + ([0] if until_stdin else [])
            ready, _, _ = select.select(fds, [], [], 0.2)
            if until_stdin and 0 in ready:
                os.read(0, 1024)
                return
        # Even after a human replaces the clipboard, wait for finish to keep the
        # transaction lock across the paste action and report changed normally.
        if until_stdin:
            os.read(0, 1024)

    def restore(self, saved_owner, saved):
        timestamp = self.server_time()
        self.x.XGrabServer(self.display)
        try:
            if self.owner() != self.window:
                return "changed"
            if not saved_owner:
                self.x.XSetSelectionOwner(self.display, self.selection, 0, 0)
            else:
                self.values = saved
                self.timestamp = timestamp
                self.x.XSetSelectionOwner(self.display, self.selection, self.window, timestamp)
                # Retain ownership atomically; a new user selection belongs to
                # another window, even if its bytes equal our temporary value.
            self.x.XSync(self.display, False)
            return "restored"
        finally:
            self.x.XUngrabServer(self.display)
            self.x.XFlush(self.display)

def main():
    parsed = json.loads(sys.stdin.buffer.readline())
    content = dict(text=parsed) if isinstance(parsed, str) else parsed
    lock = lock_clipboard()
    clipboard = None
    try:
        clipboard = XClipboard()
        owner, epoch, saved = clipboard.snapshot()
        text = content["text"].encode("utf-8")
        values = {clipboard.atom(name): (clipboard.atom("UTF8_STRING") if name == "TEXT" else clipboard.atom(name), 8, text)
                  for name in ("UTF8_STRING", "TEXT", "text/plain", "text/plain;charset=utf-8")}
        try:
            latin1 = content["text"].encode("latin-1")
            values[clipboard.atom("STRING")] = (clipboard.atom("STRING"), 8, latin1)
        except UnicodeEncodeError:
            pass
        if "html" in content:
            for name in ("text/html", "text/html;charset=utf-8"):
                values[clipboard.atom(name)] = (clipboard.atom(name), 8, content["html"].encode("utf-8"))
        # Recheck the original version immediately before replacement. This
        # refuses unstable snapshots rather than restoring a mixed clipboard.
        clipboard.drain()
        if clipboard.owner() != owner or clipboard.epoch != epoch:
            raise ClipboardError("clipboard changed before paste; clipboard was not changed", "EGO_CLIPBOARD_CHANGED")
        clipboard.x.XGrabServer(clipboard.display)
        try:
            clipboard.drain()
            if clipboard.owner() != owner or clipboard.epoch != epoch:
                raise ClipboardError("clipboard changed before paste", "EGO_CLIPBOARD_CHANGED")
            # server_time cannot run while another owner must answer; its own
            # PropertyNotify round trip is safe while this connection holds grab.
            clipboard.publish(values)
        finally:
            clipboard.x.XUngrabServer(clipboard.display)
            clipboard.x.XFlush(clipboard.display)
        emit("ready")
        clipboard.serve(until_stdin=True)
        state = clipboard.restore(owner, saved)
        if state == "restored" and owner:
            # X11 clipboards are owner-served. A detached owner must survive the
            # transaction; it exits as soon as another application copies data.
            pid = os.fork()
            if pid == 0:
                fcntl.flock(lock, fcntl.LOCK_UN)
                os.close(lock)
                os.setsid()
                for fd in (0, 1, 2):
                    os.close(fd)
                try:
                    clipboard.serve()
                finally:
                    clipboard.x.XCloseDisplay(clipboard.display)
                os._exit(0)
            emit(state)
            os._exit(0)
        emit(state)
    finally:
        if clipboard:
            clipboard.x.XCloseDisplay(clipboard.display)
        os.close(lock)

try:
    main()
except Exception as error:
    emit("error", message=str(error), code=getattr(error, "code", "EGO_CLIPBOARD_UNAVAILABLE"))
    sys.exit(1)
`;
