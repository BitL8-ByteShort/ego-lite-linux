/* Window compatibility for the hash-qualified official ego 0.6.0.22 build.
 * No injection, SDK replacement, input synthesis, or ownership changes.
 * REA identified the main Untitled host separately from backing Browser hosts.
 */
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>
#include <wctype.h>

#define HANDLER_VTABLE 0x10177c78
#define MAIN_DELEGATE 0x10201888
#define BACKING_DELEGATE 0x10201ee8

static HANDLE browser;
static DWORD browser_pid;
static uintptr_t module_base;
static HWND main_window;
static UINT_PTR timer;
static const wchar_t *window_record;
static uintptr_t recorded_xid;

static int same_path(const wchar_t *a, const wchar_t *b) {
    while (*a && *b) {
        wchar_t ca = *a++, cb = *b++;
        if (ca == L'/') ca = L'\\';
        if (cb == L'/') cb = L'\\';
        if (towlower(ca) != towlower(cb)) return 0;
    }
    return !*a && !*b;
}

static int read_pointer(uintptr_t address, uintptr_t *value) {
    SIZE_T read = 0;
    return address && ReadProcessMemory(browser, (void *)address, value,
                                       sizeof(*value), &read) && read == sizeof(*value);
}

static int window_role(HWND window) {
    DWORD pid = 0;
    wchar_t name[64];
    uintptr_t handler, vtable, delegate;
    GetWindowThreadProcessId(window, &pid);
    if (pid != browser_pid || GetWindow(window, GW_OWNER) ||
        GetAncestor(window, GA_ROOT) != window ||
        !GetClassNameW(window, name, 64) || wcscmp(name, L"Chrome_WidgetWin_1")) return 0;
    handler = (uintptr_t)GetWindowLongPtrW(window, GWLP_USERDATA);
    if (!read_pointer(handler, &vtable) || vtable != module_base + HANDLER_VTABLE ||
        !read_pointer(handler + 0x70, &delegate) || !read_pointer(delegate, &vtable)) return 0;
    if (vtable == module_base + MAIN_DELEGATE) return 1;
    if (vtable == module_base + BACKING_DELEGATE) return 2;
    return 0;
}

static BOOL CALLBACK find_main(HWND window, LPARAM unused) {
    (void)unused;
    if (window_role(window) == 1) {
        main_window = window;
        return FALSE;
    }
    return TRUE;
}

static BOOL CALLBACK hide_backing_window(HWND window, LPARAM unused) {
    (void)unused;
    if (!IsWindowVisible(window) || window_role(window) != 2) return TRUE;
    /* These are offscreen browser surfaces displayed by the native ego host,
     * not independent user windows. Wine maps them as ordinary top-level
     * windows. Keep their HWNDs hidden without touching the real Widget,
     * browser state, agent ownership, focus, bounds or capture transport.
     */
    ShowWindow(window, SW_HIDE);
    if (!IsWindowVisible(window)) {
        printf("hidden backing=%p main=%p\n", (void *)window, (void *)main_window);
        fflush(stdout);
    }
    return TRUE;
}

static void scan(void) {
    main_window = NULL;
    EnumWindows(find_main, 0);
    if (!main_window) return;
    uintptr_t xid = (uintptr_t)GetPropA(main_window, "__wine_x11_whole_window");
    if (xid && xid != recorded_xid) {
        FILE *record = _wfopen(window_record, L"w");
        if (record) {
            fprintf(record, "{\"xid\":%llu}\n", (unsigned long long)xid);
            fclose(record); recorded_xid = xid;
        }
    }
    EnumWindows(hide_backing_window, 0);
}

static void CALLBACK timer_proc(HWND window, UINT message, UINT_PTR id, DWORD time) {
    (void)window; (void)message; (void)id; (void)time;
    scan();
}

static int find_browser(wchar_t **paths) {
    HANDLE processes = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    PROCESSENTRY32W entry = {.dwSize = sizeof(entry)};
    if (processes == INVALID_HANDLE_VALUE) return 0;
    if (Process32FirstW(processes, &entry)) do {
        if (_wcsicmp(entry.szExeFile, L"ego.exe")) continue;
        HANDLE process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | SYNCHRONIZE,
                                     FALSE, entry.th32ProcessID);
        wchar_t path[32768];
        DWORD length = 32768;
        if (!process) continue;
        if (!QueryFullProcessImageNameW(process, 0, path, &length) ||
            (!same_path(path, paths[1]) && !same_path(path, paths[2]))) {
            CloseHandle(process); continue;
        }
        HANDLE modules = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, entry.th32ProcessID);
        MODULEENTRY32W module = {.dwSize = sizeof(module)};
        uintptr_t base = 0;
        if (modules != INVALID_HANDLE_VALUE) {
            if (Module32FirstW(modules, &module)) do {
                if (!_wcsicmp(module.szModule, L"chrome.dll") &&
                    (same_path(module.szExePath, paths[3]) || same_path(module.szExePath, paths[4]))) {
                    base = (uintptr_t)module.modBaseAddr; break;
                }
            } while (Module32NextW(modules, &module));
            CloseHandle(modules);
        }
        if (base) {
            browser = process; browser_pid = entry.th32ProcessID; module_base = base;
            main_window = NULL;
            EnumWindows(find_main, 0);
            if (main_window) { CloseHandle(processes); return 1; }
        }
        CloseHandle(process);
    } while (Process32NextW(processes, &entry));
    CloseHandle(processes); return 0;
}

int wmain(int argc, wchar_t **argv) {
    if (argc != 6) return 2;
    window_record = argv[5];
    HANDLE singleton = CreateMutexW(NULL, FALSE, L"Local\\EgoWineWindowGuard-0.6.0.22");
    if (!singleton) return 3;
    if (GetLastError() == ERROR_ALREADY_EXISTS) { CloseHandle(singleton); return 0; }
    ULONGLONG deadline = GetTickCount64() + 30000;
    while (!find_browser(argv)) {
        if (GetTickCount64() >= deadline) { CloseHandle(singleton); return 4; }
        Sleep(100);
    }
    MSG message;
    PeekMessageW(&message, NULL, 0, 0, PM_NOREMOVE);
    /* Wine does not consistently emit object-show events for Chromium's new
     * HWNDs. A small native timer also covers reused and late-created windows.
     * No title parsing, external UI driver, browser requests or focus changes.
     */
    timer = SetTimer(NULL, 0, 100, timer_proc);
    if (!timer) { CloseHandle(browser); CloseHandle(singleton); return 5; }
    printf("watching browser_pid=%lu\n", (unsigned long)browser_pid);
    fflush(stdout);
    scan();
    for (;;) {
        DWORD result = MsgWaitForMultipleObjects(1, &browser, FALSE, INFINITE, QS_ALLINPUT);
        if (result == WAIT_OBJECT_0 || result == WAIT_FAILED) break;
        while (PeekMessageW(&message, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message); DispatchMessageW(&message);
        }
    }
    if (timer) KillTimer(NULL, timer);
    CloseHandle(browser); CloseHandle(singleton);
    DeleteFileW(window_record);
    puts("browser exited; guard stopped");
    return 0;
}
