---
name: wiring-video
description: Render the wiring video of a validated Circuit Studio project (.circuitstudio/project.c3dproj) in the Circuit Studio page connected to the kit - choosing the video settings once per project (Circuit Studio's defaults, set in the page, or answered in the chat) and keeping them in .circuitstudio/video.json, rendering the MP4 into .circuitstudio/media/, then offering the extras once (a poster image). Fourth and last step of a wiring video, after wiring-plan, wiring-parts and wiring-project. Use when the user wants the video of their wiring made or made again, or wants its settings changed.
---

# wiring-video

Fourth step of a wiring video: `wiring-project` built the Circuit Studio project and the user validated it. This
skill renders the video in Circuit Studio itself, through the page connected to the kit (D23): Circuit Studio
plays the wiring wire by wire and encodes it in the browser, and the kit writes the file.

```text
1 check the inputs → 2 open the page → 3 settings (once) → 4 render → 5 extras (once) → 6 report
```

**What matters at this step**: a video that shows the wiring the way the user wants, and that comes out the same
the next time without asking again. Everything the user chooses here is kept in `.circuitstudio/video.json`
(D27): settings, outputs, later the automation. A missing section there means "not chosen yet"; a chosen one is
used without a question.

Talk to the user in their language. Everything written to files is in English.

**The command line.** `<kit>` below is the kit's command line. Until its package exists, it is
`node <kit folder>/tools/cli.ts` with Node 22. Run it from the project root: it finds the project's
`.circuitstudio/` folder from the current folder upwards.

| Command | What it does |
|---|---|
| `<kit> studio status` | Whether the kit's background process runs, whether a Circuit Studio page is connected, how the kit reaches Circuit Studio |
| `<kit> studio open [--no-browser] [--wait <s>]` | Opens the project in the connected page (starting the background process, and opening the link in the user's browser, when needed); answers with the link when no page connects in time |
| `<kit> studio sync` | Writes what the user changed in the page into the project file, and the video settings they stored there (Auto Video, **Store settings in project**) into `video.json` |
| `<kit> video` | What `video.json` holds: settings, outputs, automation ("not chosen yet" for a missing one) |
| `<kit> video choices` | Circuit Studio's video presets and the allowed values of its settings (asks the page) |
| `<kit> video settings [--defaults] [preset=<name>] [key=value]...` | Saves the settings into `video.json`, checked by the page (a refused value is an error naming the allowed ones), and shows them in the page; `--defaults` takes Circuit Studio's defaults |
| `<kit> video outputs poster=on\|off` | Saves what `render` writes besides the video |
| `<kit> video poster` | Writes the poster image now (a still of the camera view), named after the latest video, without rendering again |
| `<kit> render [--poster]` | Saves the user's edits, reloads the project in the page and renders the video there with `video.json`'s settings into `.circuitstudio/media/`; progress lines on stderr; the poster too when the outputs say so |
| `<kit> studio stop` | Ends the background process |

**The user only sees your messages when you stop.** Ask all your questions in one message.

## 1. Check the inputs

- `.circuitstudio/project.c3dproj` must exist and be the validated one. When it is missing, or when
  `<kit> wiring` says the document changed since `wiring.json` was resolved, the project is not ready: say so
  and offer `wiring-project` first.
- `<kit> studio status` tells how the kit reaches Circuit Studio:
  - **Connected**: it names a Circuit Studio ("studio is not running" only means no page is open yet). The kit
    renders in the user's page; the rest of this skill applies.
  - **Manual**: none is configured. Say once that without a Circuit Studio that has the kit's bridge on this
    machine (the kit's fork, until the author's version has it), the kit can neither load the project nor render:
    the user opens `.circuitstudio/project.c3dproj` in Circuit Studio and clicks **Auto Video** themselves. Then
    go to the report.

## 2. Open the page

When `wiring-project` hands over, the page is still connected with the validated project: nothing to do.
Otherwise ask whether to open the project in Circuit Studio (a tab in their browser, or the one already
connected) and run `<kit> studio open`; when it answers with a link instead, give the user that link (it only
works on this machine) and run `<kit> studio open` again once they have opened it.

## 3. Settings, once per project

`<kit> video` says whether the settings are chosen.

- **Chosen**: say which in one line and ask nothing. The user changes them whenever they want, the same ways as
  below.
- **Not chosen yet**: offer three ways, in one message:
  1. **Circuit Studio's defaults** (tutorial, 1920 × 1080, 30 fps, MP4, dark background):
     `<kit> video settings --defaults`.
  2. **In the page**: **Auto Video**, their choices, **Preview sequence** to see them, then
     **Store settings in project**. When they say it is done, `<kit> studio sync`: it names the settings it saved.
     This is the way for everything beyond the main settings (lights, floor, camera poses per shot).
  3. **Here, in the chat**: run `<kit> video choices`, ask the preset first (name each one in a few words), then
     only mode, resolution, frame rate, background and format, keeping the preset's value when they have no
     preference; save with `<kit> video settings preset="<name>" key=value...`. A refused value names the allowed
     ones: ask again rather than guess.

The settings are kept in `video.json`, so the same video comes out on any machine, whatever Circuit Studio's
defaults become; the next build copies them into the project, so the page's Auto Video dialog shows them.

## 4. Render

Run `<kit> render`. Before it, tell the user in one line: it takes a few minutes (about 2.5 minutes for a
1-minute video with simplified parts, more with detailed models); the page shows the progress and a
**Cancel video** button; they should leave the tab alone until it ends. A render fails when the page is
reloaded or closed meanwhile ("the Circuit Studio page was closed"): once the page is back, run it again.

Give its result lines: the settings and where they came from, the file, its size and length, the warnings.

## 5. Extras, once (D26)

The video comes first; the extras are offered after it, once, according to what the user wants the video for.
When `<kit> video` says the outputs are not chosen yet, ask whether they also want a **poster image** (a still
of the camera view, for a README or a page that cannot play a video). On yes, `<kit> video poster` writes it now
(no second render). Save the answer with `<kit> video outputs poster=on|off`: later renders make it or not
without asking. An animated WebP for a README is planned, not available yet: say so if they ask.

## 6. Report

In a few lines:

- the files in `.circuitstudio/media/` (video, poster) with their size;
- the settings used and that they are kept in `.circuitstudio/video.json`, with the ways to change them;
- **committing**: `video.json` is meant to be committed (small; it is what makes the next render, or a CI job's,
  give the same video). The videos in `media/` are large: check what git ignores
  (`git check-ignore -v .circuitstudio/media`; exit code 1 only means nothing is ignored) and offer to add
  `.circuitstudio/media/` to `.gitignore` if they publish the video elsewhere. Never decide it for them.
- **next time**: running this skill again renders with the same settings without a question; after a change of
  wiring, `wiring-project` first.

Then `<kit> studio stop`, unless the user wants to go on in the page.
