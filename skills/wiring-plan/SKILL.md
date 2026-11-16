---
name: wiring-plan
description: Write or complete the Markdown wiring document of an electronics project (parts, connections, layout hints) from the project's own sources (firmware configuration, schematic, specs, an existing wiring page) or by interviewing the user, then review it with the user until they validate it. First step of a wiring video. Use when the user wants a wiring document, a wiring diagram or a 3D wiring video, or wants to update an existing wiring document after the hardware changed.
---

# wiring-plan

Writing the wiring document is the **first step** in a project: nothing else is needed before it (no 3D parts,
no Circuit Studio). The document is free-form Markdown written for humans and becomes the source of truth for
the next steps (`wiring-parts` prepares the 3D parts, then the document is resolved into `wiring.json` and
rendered). Template: [template.md](template.md). Resolution into `wiring.json` comes later, after the parts:
[resolve.md](resolve.md) (draft).

Write the document in English unless the user asks otherwise. Talk to the user in their language.

```text
1 target → 2 survey → 3 extract → 4 cross-check → (5 interview) → 6 draft → 7 review loop → validated
```

## 1. Agree on the target

- If the project already has a **Markdown** wiring document (`wiring.md`, or a Markdown file with a parts table
  and a connections table), work on it: complete and correct it, never rewrite what the user wrote without
  saying so.
- A wiring page in another form (HTML, PDF, image, spreadsheet) is a **source** (step 2), not the document to
  complete, even when it is the main one.
- Otherwise **always ask where to write the document**. Survey the project first (step 2, listing only) so the
  proposal fits its structure (its documentation folder, for example), then ask and wait for the answer.
  Write nothing in the project before that.

## 2. Survey the sources

Look through the project, without building or running anything, and list what can describe the wiring:

| Kind | Examples |
|---|---|
| Firmware and configuration | ESPHome YAML (`esphome:` key; follow `packages:` and `!include`), Arduino `.ino`, PlatformIO (`platformio.ini` + `src/`), MicroPython `main.py`/`boot.py`, Zephyr overlays, pin header files |
| Schematic | KiCad `.kicad_sch` (use the KiCad tools available on the machine, e.g. Konnect, or read the file), a netlist, Fritzing, EasyEDA exports, schematic images or PDFs |
| Documentation | README, specification, bill of materials, an existing wiring page (Markdown, HTML, PDF, image), assembly notes |
| 3D models | STEP / STP / IGES / STL / GLB files and the folders that hold them, with the README or source notes next to them |

Choose what to read:

- Firmware and configuration first: they are the most reliable source for signal pins.
- When documents exist in several languages, read one (prefer English) and only check the others for gaps.
- Read the notes next to each 3D model: they often give the reference, the pin names and the mounting.
- Note how current each source is: a date, a "to rework" or "obsolete" mention, or a newer document that
  contradicts it. Prefer the newer source, and say so.
- Skip build scripts, generated files and binary models (only their path and name matter here).

Tell the user in a few lines what you found and what you will read, and go on reading without waiting. If
nothing in the project describes the parts or their pins (a README that only states the purpose counts as
nothing), go to the interview (step 5) and put its first questions in the same message as the location
question (step 1).

## 3. Extract

From the sources, collect:

- **Parts**: every physical item a wire lands on — boards, modules, sensors, displays, connectors, sockets,
  switches, power parts (converters, fuse holders), and in-line components (a diode, a resistor in series).
  For each: exact reference and variant, supply voltage, the 3D model file if the project has one, and how it is
  mounted. Not parts: changes inside a part that no external wire reaches (a resistor soldered inside a meter):
  write them in the part's note.
- **One part per model**: a board plugged onto an adapter and modelled together in one file is one part; the
  wires land on the adapter's terminals.
- **Connections**: each wire goes from one pin to another. Signals come from the firmware (GPIO → function →
  part pin) and the schematic nets; power and ground distribution from the schematic, the spec or the wiring
  page. Firmware rarely says where power and ground wires go: take them from the other sources or ask.
- **Power through a connector without a wire** (a USB cable into the board's port, a barrel jack fed by a wall
  adapter): describe it in the text, not in the connections table; it draws no wire in the video.
- **Pin names as the parts name them**: the firmware name for a microcontroller pin (`GPIO4`), the silkscreen or
  datasheet name for a module (`CLK`, `VCC`), the terminal name for connectors (`J1-22`, `1`, `+`). When the
  wire physically lands on a terminal that has another name (an adapter's screw terminal), write the terminal
  and keep the function in parentheses: `J1-22 (GND)`, and explain the numbering in the text above the tables.
  When the terminals have no known names, number them after the header of the plugged board they carry, and
  say it is an assumption. When several pins of a part share one name (three `GND` pins on a board), tell them
  apart by their header position, `J3-1 (GND)`, marked as an assumption if it comes from general knowledge.
  Write pin names in ASCII (`-`, not `−`).

## 4. Cross-check, and never guess

- Compare the sources with each other: a GPIO in the docs that differs from the firmware, a part in the spec
  missing from the schematic, a supply voltage that does not match a module's logic level. **Report every
  inconsistency** and ask which source is right; do not choose silently.
- **Possible design problems** (a logic level that may not drive a module, a missing flyback diode on a switched
  motor, a supply that may be too weak, an unprotected input): never assume one is real and never change the
  wiring for it. Flag them briefly in the review (step 7): how many you noticed and on which parts, that these
  are only suggestions, that you may be wrong, and that the user should check them on their own build. Then ask
  whether they want the details. Give the details only if asked; keep a declined or unverified suggestion out of
  the tables, and record it under "Recommendations" only if the user wants to keep it.
- General knowledge that is not in the project (a datasheet, a board's standard pinout, a module's usual size)
  may be used, always marked as an assumption in the document.
- When several terminals are equivalent (several GND, 3V3 or 5V pins) and the sources do not say which one is
  used, suggest one: the nearest to the part, one wire per terminal where possible. If the sources put several
  wires on one terminal, keep it and say so.
- What you cannot find, ask. Group the questions (a few at a time, most blocking first) rather than one long
  questionnaire.
- **Before the first draft, wait only for answers that change the document's structure**: the location
  (step 1), which build to document when the sources describe several (current or planned, with or without an
  option), and conflicts that change the parts list or the power path. Every other question becomes an open
  point in the draft (step 6), with your suggestion.
- When the user leaves a choice to you ("your call", "I don't know"), make it, write it as an assumption in the
  text and add an unticked line to Checks.

## 5. Interview (no sources, or gaps)

Ask part by part: what the part is (reference, link), how it is powered, which of its pins are used and where
each goes. Then confirm the power path (supply, protection, converters) and the grounds. Do not ask about 3D
models: parts without one become stand-ins (step 6) and `wiring-parts` deals with them. Keep each round short; once the parts and
their main connections are known, write the draft and continue in the review (step 7).

## 6. Write the draft

Follow [template.md](template.md):

- Title, one or two sentences on the device and its power, the **sources used**, and the notes a reader needs
  (mounting, terminal numbering, which equivalent terminal is used and why, power through a connector).
- **Parts**: *Name* unique and readable (`Session gauge`, `D1`); *Part* a short kebab-case identifier of the
  kind of part (`so-45`, `tm1637`), the same for identical parts, or `stand-in W x H x T` when there is no
  model in the project (approximate size in mm, from a datasheet or a typical size); *Pins* the pins used,
  required for a stand-in, useful for any part whose pin names you chose; *Model* the model file path in the
  project; *Note* the reference, any difference between the 3D model and the real part (colour, header side),
  and "common part, a 3D model probably exists" for a widespread board or module, so `wiring-parts` looks for it.
- **Connections**: one row per wire. A row may list several destinations, separated by commas: that is several
  wires leaving the same terminal. *From* is the upstream side (supply, board, a relay contact), *To* the load
  or the part it reads; a return wire goes from the load back to the supply. Order: the video connects the
  wires in table order, so power path first (input, protection, converter, distribution), then each function in
  turn with its own ground; a power circuit switched by a relay goes with the function it powers. Wire colours, by name only: black, red, orange,
  blue, purple, green, brown, yellow, white. Use those of the sources or the real build; otherwise propose them
  (red for positive supplies, black for ground, distinct colours for signals) and say they are a proposal.
- **Layout**: leave it out by default. Circuit Studio then places the parts automatically, and the user can
  rearrange them in the generated project and render again. Write it only when the user gives a flat
  arrangement for the video (top view, parts laid on a table), never by projecting positions in an enclosure.
- **Source notes**: where the document departs from the project's sources and why (the user said so, a newer
  source wins), so a reader comparing them is not misled.
- **Recommendations**: only the suggestions the user chose to keep without building them (step 4).
- **Checks**, in three groups: what the sources agree on (ticked), what the user confirmed (ticked), and what
  remains to check on the real parts (unticked: polarity, a module's pin order, which socket pin carries the
  supply, every assumption). Leave out a group that would be empty.
- Remove the template's comments from the document.
- **Open points**: questions not answered yet, each with your suggestion, at the end of the draft. The section
  is removed once every point is answered or moved to Checks.

## 7. Review with the user until validated

The document is not finished when it is written: the user validates it. Loop:

1. **Show a short summary**, not the whole file: path of the document; number of parts and connections; the
   assumptions you made; the open points, each with your suggestion; and, if you noticed any, one line on
   possible design problems with the offer to detail them (step 4). Ask the user, in one message, to answer
   the open points or correct anything (by plain prompt, or by editing the file), **or to say "ok" to accept
   your suggestions as they are and validate the document**.
2. **Apply the answers and corrections** to the document. If the user edited the file, read it again first and
   keep their changes. Move answered points out of the open points (into the text, the tables, the source notes
   or the Checks). A confirmed assumption loses its "assumption" mark and moves to "Confirmed by the owner".
   Then show what changed in a few lines and, in the same message, ask for "ok" to validate (back to 1 if open
   points remain).
3. **Stop only on an explicit validation**: an "ok" or "validated" to the summary, or answers that accept every
   suggestion as it is and change nothing (apply them, show what changed, and consider the document validated).
   When the answers change the document (a declined suggestion, a correction), the user has not seen the
   result yet: show it and ask for "ok".
   Never treat silence or a new topic as validation. Open points may remain if the user accepts them; they stay
   unticked in Checks.

When validated, say so and propose the next step, `wiring-parts`, listing the parts it has to handle: the
stand-ins that need a 3D model, and the parts whose model file must be converted for Circuit Studio.
