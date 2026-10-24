#!/usr/bin/env python3
"""Activate an existing visible ego window in this user's dedicated Wine prefix."""
import ctypes as c
import json
import os
from pathlib import Path
import time


class WindowAttributes(c.Structure):
    _fields_ = [
        ("x", c.c_int), ("y", c.c_int), ("width", c.c_int), ("height", c.c_int),
        ("border_width", c.c_int), ("depth", c.c_int), ("visual", c.c_void_p),
        ("root", c.c_ulong), ("class_", c.c_int), ("bit_gravity", c.c_int),
        ("win_gravity", c.c_int), ("backing_store", c.c_int),
        ("backing_planes", c.c_ulong), ("backing_pixel", c.c_ulong),
        ("save_under", c.c_int), ("colormap", c.c_ulong),
        ("map_installed", c.c_int), ("map_state", c.c_int),
        ("all_event_masks", c.c_long), ("your_event_mask", c.c_long),
        ("do_not_propagate_mask", c.c_long), ("override_redirect", c.c_int),
        ("screen", c.c_void_p),
    ]


class MessageData(c.Union):
    _fields_ = [("b", c.c_char * 20), ("s", c.c_short * 10), ("l", c.c_long * 5)]


class ClientMessage(c.Structure):
    _fields_ = [
        ("type", c.c_int), ("serial", c.c_ulong), ("send_event", c.c_int),
        ("display", c.c_void_p), ("window", c.c_ulong),
        ("message_type", c.c_ulong), ("format", c.c_int), ("data", MessageData),
    ]


class Event(c.Union):
    _fields_ = [("xclient", ClientMessage), ("pad", c.c_long * 24)]


def main():
    prefix = os.environ.get("WINEPREFIX")
    if not prefix or not os.environ.get("DISPLAY"):
        return 1
    # The native guard identifies the actual ego UI by its qualified host type.
    # Backing windows share its WM_CLASS and often its title; never guess which
    # one to raise. Missing/hidden UI falls back to the official reopen path.
    try:
        record = Path.home() / ".local/state/ego-wine-window-guard/native-window.json"
        native_window = json.loads(record.read_text())["xid"]
        if not isinstance(native_window, int) or native_window <= 0:
            return 1
    except (OSError, ValueError, KeyError):
        return 1
    try:
        x11 = c.CDLL("libX11.so.6")
    except OSError:
        return 1

    def bind(name, result, *arguments):
        function = getattr(x11, name)
        function.restype = result
        function.argtypes = arguments
        return function

    open_display = bind("XOpenDisplay", c.c_void_p, c.c_char_p)
    close_display = bind("XCloseDisplay", c.c_int, c.c_void_p)
    root_window = bind("XDefaultRootWindow", c.c_ulong, c.c_void_p)
    atom = bind("XInternAtom", c.c_ulong, c.c_void_p, c.c_char_p, c.c_int)
    free = bind("XFree", c.c_int, c.c_void_p)
    get_property = bind(
        "XGetWindowProperty", c.c_int, c.c_void_p, c.c_ulong, c.c_ulong,
        c.c_long, c.c_long, c.c_int, c.c_ulong, c.POINTER(c.c_ulong),
        c.POINTER(c.c_int), c.POINTER(c.c_ulong), c.POINTER(c.c_ulong),
        c.POINTER(c.POINTER(c.c_ubyte)),
    )
    attributes = bind("XGetWindowAttributes", c.c_int, c.c_void_p, c.c_ulong, c.POINTER(WindowAttributes))
    send = bind("XSendEvent", c.c_int, c.c_void_p, c.c_ulong, c.c_int, c.c_long, c.POINTER(Event))
    flush = bind("XFlush", c.c_int, c.c_void_p)
    # A window may disappear between the stacking-list read and its inspection.
    error_callback_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)
    error_callback = error_callback_type(lambda _display, _error: 0)
    bind("XSetErrorHandler", c.c_void_p, error_callback_type)(error_callback)
    display = open_display(None)
    if not display:
        return 1

    def property_value(window, name):
        property_atom = atom(display, name.encode("ascii"), 1)
        if not property_atom:
            return []
        actual_type, count, remaining = c.c_ulong(), c.c_ulong(), c.c_ulong()
        actual_format = c.c_int()
        data = c.POINTER(c.c_ubyte)()
        status = get_property(display, window, property_atom, 0, 1024, 0, 0,
                              c.byref(actual_type), c.byref(actual_format),
                              c.byref(count), c.byref(remaining), c.byref(data))
        try:
            if status or not data:
                return []
            if actual_format.value == 8:
                return c.string_at(data, min(count.value, 4096))
            if actual_format.value == 32:
                return list(c.cast(data, c.POINTER(c.c_ulong))[:min(count.value, 1024)])
            return []
        finally:
            if data:
                free(data)

    def own_prefix(pid):
        try:
            process = Path("/proc") / str(pid)
            if process.stat().st_uid != os.getuid():
                return False
            with (process / "environ").open("rb") as environment:
                return os.fsencode(f"WINEPREFIX={prefix}") in environment.read(131072).split(b"\0")
        except (OSError, ValueError):
            return False

    try:
        root = root_window(display)
        windows = property_value(root, "_NET_CLIENT_LIST_STACKING")
        if not isinstance(windows, list):
            return 1
        for window in reversed(windows):
            if window != native_window:
                continue
            classes = property_value(window, "WM_CLASS")
            if not isinstance(classes, bytes) or b"ego.exe" not in classes.lower().split(b"\0"):
                continue
            state = WindowAttributes()
            if not attributes(display, window, c.byref(state)) or state.map_state != 2:
                continue
            pids = property_value(window, "_NET_WM_PID")
            if not isinstance(pids, list) or not pids or not own_prefix(pids[0]):
                continue
            if property_value(root, "_NET_ACTIVE_WINDOW") == [window]:
                return 0
            message = Event()
            message.xclient.type = 33  # ClientMessage
            message.xclient.send_event = 1
            message.xclient.display = display
            message.xclient.window = window
            message.xclient.message_type = atom(display, b"_NET_ACTIVE_WINDOW", 1)
            message.xclient.format = 32
            message.xclient.data.l[0] = 2  # pager/source indication
            message.xclient.data.l[1] = 0  # CurrentTime
            if not message.xclient.message_type or not send(display, root, 0, (1 << 20) | (1 << 19), c.byref(message)):
                return 1
            flush(display)
            for _ in range(25):
                if property_value(root, "_NET_ACTIVE_WINDOW") == [window]:
                    return 0
                time.sleep(0.02)
            return 1
        return 1
    finally:
        close_display(display)


if __name__ == "__main__":
    raise SystemExit(main())
