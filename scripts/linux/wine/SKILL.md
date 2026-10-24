---
name: ego-browser
description: Use the installed official ego lite browser through its native agent CLI, wrapped by Wine on Linux, for browser tasks and human-agent task spaces.
---

# ego-browser on Linux through Wine

First run `ego-browser skill` and read its complete output, including the
`[ego-browser:skill] end of guide` marker. That is the guide bundled with the
installed official Windows browser. Follow its TaskSpace, Page, ownership, and
human-control rules.

Run scripts from the Linux shell using the installed wrapper:

```bash
ego-browser nodejs <<'JS'
const task = await taskSpace("browser task");
console.log({spaceId: task.spaceId});
const page = task.page("p1");
console.log(await page.snapshot());
// Once after creating the Space: raise the native UI on this Wine desktop.
const window = await page.cdp("Browser.getWindowForTarget", {});
if (["normal", "maximized"].includes(window.bounds.windowState)) {
  await page.cdp("Browser.setWindowBounds", {
    windowId: window.windowId, bounds: {windowState: "normal"},
  });
  if (window.bounds.windowState === "maximized") {
    await page.cdp("Browser.setWindowBounds", {
      windowId: window.windowId, bounds: {windowState: "maximized"},
    });
  }
}
JS
```

Wine can put an empty backing window in front when a new TaskSpace is created.
The native window calls above restore the real ego UI while preserving its
maximized state. Apply them once for a newly created Space, while you own it;
do not repeatedly change windows during a task or after a human takeover.
Use the native Spaces button to view the agent's live preview or select its
page. Agent Pages remain usable while the personal Space is displayed.

The wrapper forwards arguments and stdin to the official Windows CLI. The native
app supplies the SDK and browser bindings. Use the guide's Bash syntax; its
Windows runtime file-path rules still apply inside scripts. Inputs needed by a
script must be embedded in its JavaScript because the native app does not inherit
the calling shell's environment.

The browser launcher is `ego-lite-wine`. Browser startup requires the active
Linux graphical session's environment. Keep the browser's task-space ownership
and human stop controls intact. Read `ego-browser skill` again after an update.
