# Prompt for GPT Dot

Use the actual ego lite browser installed on my MSI Linux laptop for browser tasks.

The MSI is `wong@100.115.38.105`. If you're running on the MSI, run commands there directly. If you're running on my Mac, use SSH to that MSI. The browser must run on the MSI, where I can see and control it through RustDesk.

The installed commands are:

- `/home/wong/.local/bin/ego-browser` for the official browser's native agent CLI.
- `/home/wong/.local/bin/ego-lite-wine` to open or focus the official browser.

These wrappers run the official Windows ego app and its bundled CLI through Wine. Use this installation. Don't substitute Chrome, Playwright, an in-app browser, or this repository's older community Linux host. Don't reinstall anything or change the launch configuration to start a browsing task.

Before using it, run `/home/wong/.local/bin/ego-browser skill` on the MSI and read the entire guide through `[ego-browser:skill] end of guide`. If the output is truncated, save it and read the rest. Follow that installed guide rather than guessing the API. For a cold launch over SSH, set `DISPLAY=:1` and `XAUTHORITY=/home/wong/.Xauthority` on the MSI command. Use the existing desktop session.

Run JavaScript with `ego-browser nodejs` and a quoted Bash heredoc. Create one TaskSpace for my whole goal, print its `spaceId`, and reuse that ID in later commands. Start with its existing `p1` Page. Reuse Pages as you navigate; don't create another Space to recover from an error. Each command starts a fresh JavaScript process, so recreate handles using the saved ID and Page labels.

Read `/home/wong/.agents/skills/ego-browser/SKILL.md` too. The installed integration handles Wine's backing-window problem automatically. Don't add restore/maximize calls, custom launch flags, or a window workaround to your scripts. I can select the agent's page through the native Spaces button and see its live preview.

Take a snapshot before acting. Refresh refs after navigation or page changes, and verify the result of each meaningful action. Use only the documented ego APIs and `help()` for exact signatures. Scripts execute inside the app's Windows Node runtime, so use absolute Windows paths such as `C:/users/wong/Desktop/result.png` for files inside scripts. Shell environment variables aren't automatically available there.

Respect ego's ownership and human controls. If I take control or stop the agent, stop acting. When I need to interact, call `task.handOff()` and wait for me. Resume only when I ask, using the guide's takeover rules. At the actual end of the goal, call `task.finish({keep:[...]})` exactly once, keeping only the result Pages I need.

Start by reading the installed guide, then use the real browser to carry out my next request. Tell me what you verified and leave the result visible for me.
