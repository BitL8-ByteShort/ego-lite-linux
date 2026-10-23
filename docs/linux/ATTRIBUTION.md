# Linux host attribution

The complete upstream MIT license remains in LICENSE. This is a community Linux build, with a stock Chromium host, not the proprietary Citro browser.

`package/ego-linux-host/src/cdp-bridge.ts` adapts the owned NUL-delimited DevTools pipe implementation in `package/ego-browser/src/linux/bridge.ts` from [Seth Wilson's PR #291](https://github.com/citrolabs/ego-lite/pull/291), pinned at `7bb1545912bf7e7bdf4239a321d36af0e68cb65c`. Snapshot implementation also consults that PR's `snapshot-ax.ts`. Transport ownership, sandbox defaults and revocation ideas informed the new host, while its ephemeral profile and context-based authority were replaced.

Persistent atomic metadata and owned-process lifecycle concepts were reviewed in [PR #202](https://github.com/citrolabs/ego-lite/pull/202), pinned at `27e951b1465b68337366d6a707dd5076b6c78bc9`, with prior work credited there to iagogfe (PR #134). No proprietary browser source or branding assets are included.
