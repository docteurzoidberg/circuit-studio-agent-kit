# <Project name> — wiring

<!--
Wiring document of <project>, written with the wiring-plan skill. It is the single input of the next steps:
wiring-parts prepares the 3D parts listed under "Parts", then the document is resolved into wiring.json,
wiring-project builds the Circuit Studio project and wiring-video renders it. Only the "Parts" and "Connections" tables are required; every other section is
optional and free. Remove this comment if you like.
-->

<One or two sentences: what the device is and how it is powered.>

Sources used: <files this document was written from, e.g. firmware/config.yaml (pins), docs/spec.md (parts)>,
<and the owner, for what the files do not say>.

<Anything a reader needs to follow the tables: how a board is mounted, how terminals are numbered, which of
several equivalent terminals are used and why, power that arrives through a connector without a wire (a USB
cable). Mark assumptions as such.>

## Parts

| Name     | Part             | Pins       | Model                    | Note                            |
|----------|------------------|------------|--------------------------|---------------------------------|
| <Board>  | <part-id>        |            | `<path/to/model.step>`   | <exact reference, variant>      |
| <Sensor> | <part-id>        | VCC, DATA, GND |                      | <supply voltage, setting>       |
| <Module> | stand-in 20x15x3 | VIN, GND   |                          | <no 3D model yet>               |

*Name* is how the connections refer to the part; it is unique. *Part* identifies the kind of part (the same for
identical parts): a Circuit Studio part, a part to prepare from the *Model* file, or `stand-in W x H x T` (a
plain box in mm) when no model is available yet. *Pins* lists the pins used: required for a stand-in, optional
otherwise.

## Connections

| Wire  | From            | To            | Note           |
|-------|-----------------|---------------|----------------|
| red   | <Board> 5V      | <Module> VIN  | <what it does> |
| black | <Board> GND     | <Module> GND  |                |
| blue  | <Board> GPIO4   | <Sensor> DATA |                |

One row per wire, from the board or supply side to the part. Several destinations in one cell, separated by
commas, are several wires leaving the same terminal. Pins are written as the part names them (`GPIO4`, `VIN`)
or by terminal (`J1-22`); text in parentheses is a comment. Colours: black, red, orange, blue, purple, green,
brown, yellow, white. The order of this table is the order in which the video connects the wires.

<!--
## Layout

Optional, usually left out: Circuit Studio places the parts automatically and they can be rearranged in the
generated project. Only for a flat arrangement given by the user: top view of the parts laid on a table, in
millimetres from the main board's centre; rotation in degrees around the vertical axis.

| Name     | X   | Y   | Rotation |
|----------|-----|-----|----------|
| <Board>  | 0   | 0   | 0        |
-->

## Recommendations

- <Only if the owner chose to keep it: a suggestion that is not part of the build, e.g. a protection diode.
  Suggestions from the skill, to check by the owner.>

## Source notes

- <Where this document departs from the project's sources, and why (the owner said so, a newer source wins).>

## Checks

Sources agree:

- [x] <what the sources agree on>

Confirmed by the owner:

- [x] <what the owner confirmed>

To check on the real parts:

- [ ] <polarity, pin order, every assumption>

## Open points

<Draft only; removed once every point is answered or moved to Checks.>

1. <Question.> Suggestion: <your suggestion>.
