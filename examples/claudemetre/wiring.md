# Claudemètre — wiring

<!--
Showcase example of a wiring document as the `wiring-plan` skill writes it (template: skills/wiring-plan/
template.md). It describes the finished build; the project's own documents lag behind it. It is resolved into
wiring.json, the input of the next steps: `wiring-parts` prepares the 3D parts, and `wiring-video` builds the
Circuit Studio project (claudemetre.c3dproj) and renders the video. Only "Parts" and "Connections" are required.
-->

Wiring of the [Claudemètre](https://github.com/docteurzoidberg/claudemetre), a desk gauge that shows Claude
usage limits on two panel voltmeters, a 4-digit display and an LED indicator. Powered from 12 V through a fuse
and a Mini360 step-down converter that feeds the board's 5 V terminal.

Sources used: `esphome/claudemetre.yaml` (pins), `docs/en/specification.md` (parts),
`design/cablage/index.html` (previous wiring page), `design/references/*/README.md` (parts and 3D models), and
the owner for the finished build (12 V input, Mini360, ground terminals).

**Board and terminals.** The ESP32-S3-DevKitC-1 is plugged onto the MRD076A screw-terminal adapter, so every
wire lands on a screw terminal. Terminal *n* of the left block is header pin J1-*n*, of the right block J3-*n*;
pin 1 is at the antenna end. The 5 V terminal is J1-21 (written `5V0` on the previous wiring page). The ESP32's
USB port can still be used for flashing; it carries no wire in this document.

**Grounds.** Ground wires are spread over the adapter's GND terminals (J1-22, J3-1, J3-21, J3-22), one wire per
terminal except J1-22, where the Mini360 output and the strip share a ferrule.

**Logic levels.** No 5 V on a GPIO: the display is powered from 3.3 V because its module pulls CLK and DIO up to
its VCC. The LED strip runs from 5 V and takes the ESP32's 3.3 V data directly, without a level shifter.

## Parts

| Name          | Part             | Pins                 | Model                                                    | Note                                                         |
|---------------|------------------|----------------------|----------------------------------------------------------|--------------------------------------------------------------|
| Board         | mrd076a-esp32-s3 |                      | `design/references/mrd076a/MDR076A+ESP32-S3.STEP`        | ESP32-S3-DevKitC-1 N16R8 plugged on the MRD076A; one model   |
| Session gauge | so-45            |                      | `design/references/so45/so-45-voltmeter.step`            | full scale lowered to ~3 V by a 6.2 kΩ resistor inside       |
| Week gauge    | so-45            |                      | `design/references/so45/so-45-voltmeter.step`            | same as the session gauge                                    |
| Display       | tm1637           |                      | `design/references/tm1637/Display_4-Didi_LED_TM1637.stp` | 4-digit 0.56" module; the model is green with a colon, the real one yellow with dots |
| Strip         | stand-in 28x10x2 | +5V, DIN, GND        |                                                          | 4 × WS2812B, 144 LED/m, behind the CLAUDE legend; wires soldered |
| Buck          | stand-in 22x17x4 | IN+, IN-, OUT+, OUT- |                                                          | Mini360 step-down, 12 V to 5 V                               |
| Power socket  | lp16-2pole       |                      | `design/references/lp16/LP-16-2pole.step`                | 12 V input on the side plate (1 = +12 V)                     |
| Fuse          | fuse-holder      |                      | `design/references/fusible/fuse_holder.step`             | 5 × 20 panel fuse holder, protects the 12 V input            |

*Part* is a Circuit Studio part: a built-in `modelId`, a part prepared from the *Model* file by `wiring-parts`,
or `stand-in W x H x T` (a plain box in mm with the listed pins) when no model is available yet.

## Connections

| Wire   | From              | To                | Note                                      |
|--------|-------------------|-------------------|-------------------------------------------|
| red    | Power socket 1    | Fuse END          | +12 V                                     |
| red    | Fuse SIDE         | Buck IN+          | +12 V fused                               |
| black  | Power socket 2    | Buck IN-          | 0 V                                       |
| red    | Buck OUT+         | Board 5V          | +5 V into the board                       |
| black  | Buck OUT-         | Board J1-22 (GND) |                                           |
| blue   | Board GPIO4       | Session gauge +   | PWM 25 kHz, 1.2 mA max                    |
| purple | Board GPIO5       | Week gauge +      | PWM 25 kHz, 1.2 mA max                    |
| black  | Board J3-21 (GND) | Session gauge -   |                                           |
| black  | Board J3-22 (GND) | Week gauge -      |                                           |
| green  | Board GPIO6       | Display CLK       |                                           |
| brown  | Board GPIO7       | Display DIO       |                                           |
| orange | Board J1-1 (3V3)  | Display VCC       | 3.3 V, not 5 V                            |
| black  | Board J3-1 (GND)  | Display GND       |                                           |
| yellow | Board GPIO14      | Strip DIN         | 3.3 V data into the strip's input end     |
| red    | Board 5V          | Strip +5V         | ferrule shared with the Mini360 output    |
| black  | Board J1-22 (GND) | Strip GND         | ferrule shared with the Mini360 output    |

Pins are written as the part names them (`GPIO4`, `CLK`) or by terminal (`J1-22`); text in parentheses is a
comment. The order of this table is the order in which the video connects the wires: power path first, then
each function with its own ground.

## Layout

Placement hints for the video, top view of the parts laid flat, in millimetres from the board centre;
rotations in degrees around the vertical axis. Not the positions in the enclosure.

| Name          | X    | Y    | Rotation |
|---------------|------|------|----------|
| Board         | 0    | 0    | 0        |
| Session gauge | -40  | -105 | 0        |
| Week gauge    | 40   | -105 | 0        |
| Display       | 0    | 90   | 180      |
| Strip         | -80  | 95   | 0        |
| Buck          | -95  | -40  | 0        |
| Fuse          | -150 | -35  | 0        |
| Power socket  | -150 | -95  | 0        |

## Checks

Sources agree:

- [x] Every GPIO above matches `esphome/claudemetre.yaml` (GPIO4, GPIO5 gauges; GPIO6, GPIO7 display;
      GPIO14 LED strip).
- [x] The display is powered at 3.3 V, as required by its 3.3 V data lines.

Confirmed on the finished build: 12 V input through the fuse and the Mini360 to the 5 V terminal; display on 3V3.

To check on the real parts before relying on the video:

- [ ] SO-45 terminal polarity (+ / -) on each gauge.
- [ ] TM1637 module pin order (CLK, DIO, VCC, GND) on its silkscreen.
- [ ] LP-16 socket: pin 1 is +12 V.
