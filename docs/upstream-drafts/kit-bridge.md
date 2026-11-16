# Bridge to a local automation client (D23): the page connects to a tool on the same machine

> **Not published yet.** Fork branch
> [`feat/kit-bridge`](https://github.com/docteurzoidberg/circuit-studio/tree/feat/kit-bridge) (commit `4072960`
> and a local `fixup!` `bb4fb5d`, on top of the automation API branch; 6 tests).
>
> **Before publishing:**
>
> 1. The automation API must be proposed first ([automation-api.md](automation-api.md)): this change only makes
>    sense on top of it. Rebase on whatever lands there.
> 2. Squash the `fixup!` commit, push the fork branch.
> 3. Check with the hosted site (https) what Chrome's and Firefox's local network access prompts look like, and
>    state it in the pull request (the end-to-end check below was on a build served from the same machine).
> 4. Fill in the issue and pull request numbers.
>
> **End-to-end check done on 2026-11-16**: fork build served by the kit on `127.0.0.1:5199`, page opened
> in Windows Chrome from WSL with the link the kit gives; the page connected, the Claudemètre project (8 parts, 16
> wires, 13 MB) was opened through the bridge, read back, and rendered to a 1280 × 720 PNG in 0.7 s.

## Issue

**Title:** Let a local tool drive the automation API without remote-controlling a browser

**Body:**

The automation API (#<api issue>) is called from inside the page. A tool outside the browser (a command line, an
editor plugin, an AI agent's tool server) therefore has to launch a browser and remote-control it to reach it:
Playwright or the DevTools protocol, a browser profile of its own (recent Chrome refuses remote debugging on the
default profile), a debugging port, and on Windows with WSL a launch through PowerShell to get that port at all.
That is a lot of machinery for "open this project, give it back to me when the user is done, render it".

Expected: the page can connect **to** the tool instead, when the visitor opens a link that asks for it, and run
the tool's requests through the same API. The visitor keeps their own browser and their own tab; the tool needs
no browser automation at all.

A change is proposed in the linked pull request (one module, 6 tests, a section of `docs/AUTOMATION_API.md`). It
builds on the automation API. Feel free to merge it, or to implement this your own way, whichever suits you.

### How it works

```text
local tool                                            Circuit Studio page
  listens on ws://127.0.0.1:<port>         <──────── connects (link opened by the visitor)
  {id, method, params}                     ────────> runs window.circuitStudio[method](...params)
  {id, result} / {id, error} / {id, progress} <───── answers
```

- **Opt-in, from the link.** It starts only when the URL fragment holds
  `#bridge=ws://127.0.0.1:<port>&token=<token>`. The fragment never reaches the web server; without it nothing
  changes, not even a request.
- **This machine only.** The page connects only to a loopback address (`127.0.0.1`, `localhost`, `[::1]`) over
  `ws:`: a link cannot make it talk to a remote server.
- **Token and origin.** The page's first message carries the token from the link; the tool closes any connection
  without the right token or from another origin. Other pages open in the browser cannot use the tool, and other
  tools cannot use the page.
- **Renders shown in the page.** A video rendered through the API shows Circuit Studio's own progress panel,
  whose **Cancel video** button stops it.
- **Nothing new to call.** The requests are the automation API's methods (`openProject`, `getProject`,
  `listParts`, `capabilities`, `renderImage`, `renderVideo`, `planRoutes`, plus `ready`); a `Blob` result comes
  back as base64; `renderVideo` streams its progress and can be cancelled.
- **Always visible.** While the bridge is on, a badge in the header (green when connected, grey while waiting,
  red when the link is refused), next to the project name, says
  which tool drives the page and from which address ("Driven by <tool> · 127.0.0.1:5199"), with a
  **Disconnect** button that cuts the link (and drops it from the address bar, so a reload does not reconnect).
- **Long-lived tabs.** The page reconnects every 2 s
  after a drop, so a tool that restarts finds the tab again, and stops when the tool says another tab took over
  or the link is outdated.

### Context: why I am looking at this

My kit ([circuit-studio-agent-kit](https://github.com/docteurzoidberg/circuit-studio-agent-kit)) builds a Circuit
Studio project from a maker's wiring document, lets them review it in Circuit Studio, and has Circuit Studio
render the wiring video. With the bridge, the review is: the kit opens the link in the maker's browser, loads the
project, and reads back what they moved in the editor; no file to open or save by hand, no browser driven behind
their back. The same link works from a CI job with a headless browser.

Questions where your preference matters:

1. the fragment parameter names (`bridge`, `token`) and the header badge (wording, look);
2. whether the hosted site should allow it at all (browsers ask the visitor once before a public site reaches
   `127.0.0.1`), or only builds served locally;
3. one connection per page (as now), or several.

## Pull request

**Title:** Add an opt-in bridge from the page to a local automation client

**Body:**

Fixes #<issue>. Builds on #<api pull request>.

With `#bridge=ws://127.0.0.1:<port>&token=<token>` in the URL fragment, the page connects to a tool on the same
machine and runs its requests through the automation API, so the tool needs no browser automation: the visitor
only opens a link.

Changes:

- `src/bridge.ts` (new): reads the fragment (loopback `ws:` addresses only), connects, introduces itself with
  `{type: "hello", token, protocol: "circuit-studio-bridge/1", api: 1}`, runs `{id, method, params}` requests on `window.circuitStudio`
  (an allow-list of its methods), answers `{id, result}` or `{id, error}`, sends `Blob` results as base64, streams
  `renderVideo` progress and handles `{cancel: id}`; reconnects every 2 s, except after close codes 4000 (another
  tab took over) and 4001 (token refused); shows the tool's name when it sends `{type: "welcome", client}`.
- `src/BridgeBadge.tsx` (new), `src/App.tsx`, `src/style.css`: the header badge (who drives the page, its address,
  **Disconnect**).
- `src/main.tsx`: starts the bridge after the automation API, only when the fragment asks for it.
- `docs/AUTOMATION_API.md`: a *Bridge* section (principle, link format, security, messages, reconnection,
  browsers).
- `tests/automation-bridge.test.ts`: 6 tests (fragment parsing and loopback-only rule, a request and its result,
  blobs as base64, errors and unknown methods, render progress and cancellation, hello with the token and
  reconnection).

Verification:

- `npx tsc -b` passes; the 6 new tests pass; `npx vitest run` shows the same unrelated failures as on `main`.
- End to end: a production build served on `127.0.0.1` by a small Node tool listening for the bridge; the page
  opened with the tool's link in Chrome connected, opened a 13 MB project through the bridge (8 parts, 16 wires),
  returned it with `getProject`, and rendered a 1280 × 720 PNG (0.7 s). Refused tokens (4001) and a second tab
  taking over (4000) are covered by the tests above and by the tool's own tests.

Reproduce locally (Node 22):

```bash
npm ci
npx tsc -b && npx vitest run tests/automation-bridge.test.ts
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
