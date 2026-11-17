# Circuit Studio small features — plan

Status: plan, 2026-11-17. Small changes to Circuit Studio that are useful on their own, outside the kit's needs
(the larger changes are in [tool-changes-plan.md](tool-changes-plan.md)). Each one is first made and tried in the
fork; the owner decides afterwards whether it becomes an upstream issue and pull request. Proposed ones move to
[upstream-contributions.md](upstream-contributions.md).

## What counts as a small feature

- One area of the app, a few lines, easy for the maintainer to review in one sitting.
- Independent: branched from `upstream/main`, not from our other fork branches (`feat/automation-api`,
  `feat/kit-bridge`), so it can be merged alone and in any order.
- Backward compatible: existing projects and saved video settings open and render as before.
- Follows the [conventions for every PR](tool-changes-plan.md#conventions-for-every-pr).

## Workflow

1. Branch `feat/<name>` (or `fix/<name>`) in `circuit-studio/fork`, from `upstream/main`.
2. The change and its Vitest tests; run our tests and the ones of the area. Circuit Studio's `main` has about 35
   failing tests unrelated to ours: compare with `main`, a change must not add any.
3. Try it at home: the Claudemètre showcase and Circuit Studio's demo project, in the owner's browser; note the
   measurements here.
4. The owner decides: proposed upstream (issue, then pull request; texts in `upstream-drafts/`), kept in the fork,
   or dropped. Record the decision in the table.

## Candidates

| Feature | Size | Depends on | State |
|---|---|---|---|
| [720p video resolution](#720p-video-resolution) | 3 places + a test | — | Planned |
| [Garbled characters in the video dialogs](#garbled-characters-in-the-video-dialogs) (bugs 9 and 5) | text only, 4 files and 2 docs | — | Proposed 2026-11-17 as pull request [#8](https://github.com/arslansadiq87/circuit-studio/pull/8) (fork branch `fix/garbled-characters`, [texts](upstream-drafts/garbled-characters.md)) |
| [Export for a destination (Discord)](#export-for-a-destination-discord) | larger | 720p, measurements | Idea, decided after the 720p measurements |

## 720p video resolution

**Why.** The Auto Video dialog offers 1920, 2560 and 3840 px wide only. A lighter video is often enough (chat,
forum, a quick preview) and renders faster; it is also the base of a Discord-friendly export (below).

**Change** (upstream `75f8212`):

| Where | Today | Change |
|---|---|---|
| `src/AutoVideoControls.tsx`, *Video resolution* list | `[1920,2560,3840]` | add `1280` (shown as 1280 × 720) |
| `src/cinematic.ts`, `validSettings()` | a width outside `[1920,2560,3840]` is silently replaced by 1920 | accept `1280`, so a project or script asking for 720p gets it |
| `src/videoExport.ts`, encoder bitrate (twice: `videoCapabilities` and the `CanvasSource`) | 12 Mbit/s below 4K, 40 Mbit/s in 4K | proportional to the pixel count from the 1080p value: about 5.3 Mbit/s in 720p, 12 in 1080p, 21 in 1440p, 40 in 4K (unchanged); otherwise 720p saves little size |

Already fine: the overlay (labels, HUD) is laid out for 1920 px and scaled by `canvas.width / 1920`; the file name
follows the height (`…_Wiring_720p30.mp4`); 1280 × 9/16 = 720, even as H.264 requires.

**Tests.** `validSettings` keeps 1280 and still replaces an unknown width by 1920; the bitrate for each listed width
(one small exported function, so it is testable).

**Check at home.** Render the Claudemètre (about 57 s) and the demo (about 22 s) in 720p and 1080p with the same
settings: file size, render time, legibility of the pin labels scaled to 2/3 (the one real risk). For reference,
1080p gave 14.5 MB for the Claudemètre's 57.5 s (an effective 2 Mbit/s, far below the 12 Mbit/s target: the
scene moves little), so 720p should land well below 10 MB.

**Measured.** —

## Garbled characters in the video dialogs

**Why.** Bug 9 of [upstream-bugs.md](upstream-bugs.md): the sources hold UTF-8 text decoded as Windows-1252, shown
as is in the app (×, ·, —, → become `Ã—`, `Â·`, `â€”`, `â†’`, sometimes twice: `Ãƒâ€”`). Still there in `75f8212`:
`src/App.tsx` (image export sizes and other texts), `src/AutoVideoControls.tsx` (the Auto Video dialog, on the same
line as the resolution list among others), `src/cinematic.ts`, and `src/model.ts`, where the demo project's wire
labels ("USB D- Â· GPIO19", "Power Supply Â· VBUS"…) end up in its videos.

**Change.** Replace the sequences by the intended characters (×, ·, —); a test that `src/` holds none of them.
A separate pull request from 720p (one change per PR), though it touches the same line: the second one rebased on
the first.

**Check at home.** The dialogs show ×, ·, — and → in the browser; the demo's wire labels in a rendered video.

## Export for a destination (Discord)

**Why.** Sharing a wiring video on Discord: the file must stay under the upload limit and play inline. Discord's
limits in November 2026: 20 MB per file on a free account (since August 14, 2026, before: 10 MB), 50 MB with Nitro
Basic, 500 MB with Nitro ([Dexerto](https://www.dexerto.com/entertainment/discord-raises-free-upload-limit-to-20mb-after-lowering-it-two-years-ago-3398251/),
[Discord's attachments FAQ](https://support.discord.com/hc/da/articles/25444343291031-Vedh%C3%A6ftede-filer-FAQ)).
MP4 / H.264 is the format every client plays inline.

**Idea.** Circuit Studio's presets (*Default Tutorial*, *Fast Wiring Demonstration*, …) set the content only (pace,
mode, HUD) and replace every setting when chosen, so a "Discord" preset in that list would reset the style. Two
shapes discussed on 2026-11-17:

- **A — one more preset** ("Discord Share": fast pace, 720p, size target): smallest change, but mixes content and
  output, and resets the style.
- **B — a second list "Export for"** (custom, Discord 20 MB, Discord 50 MB) that sets the output only (width, frame
  rate, format, size target) and keeps the content preset. Cleaner; the preferred one.

Both need a **size target**: the bitrate computed from the target size and the duration (known before encoding,
from the sequence), with a margin; a floor (about 1 Mbit/s in 720p) under which the export lowers the resolution or
asks to shorten the video; after encoding, a check of the size, since the browser encoder treats the bitrate as a
target, not a cap (a second pass with a lower bitrate if needed). To check first: what `mediabunny` offers (constant
bitrate, `fastStart` for the MP4).

**Kit side.** `video settings` already takes the page's presets (`preset=<name>`): A comes for free; B needs a
setting key (`export=discord`). Without waiting for upstream, the kit could also re-encode with ffmpeg to a size,
as it makes the WebP.

**Decision.** After the 720p measurements: if a 720p video of a usual project already fits in 20 MB, the size target
is only a guarantee for long videos and may not be worth a pull request.
