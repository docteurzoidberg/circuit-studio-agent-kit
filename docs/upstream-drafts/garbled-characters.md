# Garbled characters in the app's texts and two docs (bugs 9 and 5)

> **Published 2026-11-17** as pull request [#8](https://github.com/arslansadiq87/circuit-studio/pull/8), the owner's first as a contributor. Fork branch [`fix/garbled-characters`](https://github.com/docteurzoidberg/circuit-studio/tree/fix/garbled-characters)
> (two commits, `18da839` and `7f2d86e`, on upstream `75f8212`), from [../small-features-plan.md](../small-features-plan.md).
> Bugs 9 and 5 in [../upstream-bugs.md](../upstream-bugs.md). Opened from the fork, without an issue first (the fix is
> self-evident); the dialogs were not checked in a browser, only in the built bundles.

## Pull request

**Title:** Fix garbled characters in the app's texts and two docs

**Body:**

Some UTF-8 text in the sources had been read as Windows-1252 and saved again, once or twice. The app shows it as is:

- Auto Video dialog: "1920 Ã— 1080", "MP4 / H.264 â€” supported", "Futuristic 3D HUD â€” Default";
- image export sizes: "1920 Ãƒâ€” 1080 Ã‚Â· Full HD";
- status messages: "Opening projectÃ¢â‚¬Â¦", "Loading 3D workspaceÃ¢â‚¬Â¦";
- the demo project's wire labels, in the editor and in its videos: "USB D- Â· GPIO19", "Power Supply Â· VBUS".

Changes:

- `src/App.tsx`, `src/AutoVideoControls.tsx`, `src/cinematic.ts`, `src/model.ts`: the 33 sequences restored to the
  characters they stood for (×, ·, —, →, … and the Δ of the pin position check). Only those characters change.
- `docs/TESTING.md` held two Latin-1 "×" bytes (invalid UTF-8); `docs/PIN_MAPPING.md` had "?" in place of "D-"
  (three times) and of "×".
- `tests/text-encoding.test.ts`: every text file of `src/` and `docs/` and the README must be valid UTF-8 without
  such sequences. On `main` it fails for the five files fixed here.

Verification:

- `npm run build` (`tsc -b` and `vite build`) passes; the built bundles no longer contain the sequences and hold
  the intended texts ("1920 × 1080 · Full HD").
- `npx vitest run`: the same 35 unrelated failures as on `main`; the new test passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
