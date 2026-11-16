# Claudemètre — wiring

<!--
Example of a wiring document as the `wiring-plan` skill is meant to write it; it also serves as the template.
The skill resolves it into wiring.json (next to this file), the input of the next steps: `wiring-parts`
prepares the 3D parts, and `wiring-video` builds the Circuit Studio project (claudemetre.c3dproj) from it.
Only the "Parts" and "Connections" tables are required; every other section is optional.
-->

Wiring of the [Claudemètre](https://github.com/docteurzoidberg/claudemetre), a desk gauge that shows Claude
usage limits on two panel voltmeters, a 4-digit display and an LED indicator. Powered from 12 V through a fuse
and a Mini360 step-down converter.

Sources used: `esphome/claudemetre.yaml` (pins), `docs/cahier-des-charges.md` (parts),
`design/cablage/index.html` (previous wiring table), `design/references/` (3D models).

The ESP32-S3-DevKitC-1 is plugged onto the MRD076A screw-terminal adapter, so every wire lands on a screw
terminal. Terminal *n* of the left block is header pin J1-*n*, of the right block J3-*n*; pin 1 is at the
antenna end. Ground wires are spread over the adapter's GND terminals (J1-22, J3-1, J3-21, J3-22) to keep one
wire per terminal where possible.

## Parts

| Name          | Part             | Pins                 | Model                                                  | Note                                       |
|---------------|------------------|----------------------|--------------------------------------------------------|--------------------------------------------|
| Board         | mrd076a-esp32-s3 |                      | `design/references/mrd076a/MDR076A+ESP32-S3.STEP`      | ESP32-S3-DevKitC-1 N16R8 on the MRD076A    |
| Session gauge | so-45            |                      | `design/references/so45/so-45-voltmeter.step`          | full scale lowered to ~3 V (6.2 kΩ inside) |
| Week gauge    | so-45            |                      | `design/references/so45/so-45-voltmeter.step`          | same as the session gauge                  |
| Display       | tm1637           |                      | `design/references/tm1637/Display_4-Didi_LED_TM1637.stp` | 4-digit 0.56" module, powered at 3.3 V   |
| Strip         | stand-in 28x10x2 | +5V, DIN, GND        |                                                        | 4 × WS2812B, 144 LED/m; wires soldered     |
| D1            | stand-in 9x4x4   | A, K                 |                                                        | 1N400x, soldered at the strip's +5V input  |
| Buck          | stand-in 22x17x4 | IN+, IN-, OUT+, OUT- |                                                        | Mini360 step-down, 12 V to 5 V             |
| Power socket  | lp16-2pole       |                      | `design/references/lp16/LP-16-2pole.step`              | 12 V input on the side plate (1 = +12 V)   |
| Fuse          | fuse-holder      |                      | `design/references/fusible/fuse_holder.step`           | protects the 12 V input                    |

*Part* is a Circuit Studio part: a built-in `modelId`, a part prepared from the *Model* file by `wiring-parts`,
or `stand-in W x H x T` (a plain box in mm with the listed pins) when no model is available yet.

## Connections

| Wire   | From              | To                | Note                                |
|--------|-------------------|-------------------|-------------------------------------|
| orange | Power socket 1    | Fuse END          | +12 V                               |
| orange | Fuse SIDE         | Buck IN+          | +12 V fused                         |
| black  | Power socket 2    | Buck IN-          | 0 V                                 |
| red    | Buck OUT+         | Board 5V          | 5 V into the board (USB not used)   |
| black  | Buck OUT-         | Board J1-22 (GND) |                                     |
| blue   | Board GPIO4       | Session gauge +   | PWM 25 kHz, 1.2 mA max              |
| purple | Board GPIO5       | Week gauge +      | PWM 25 kHz, 1.2 mA max              |
| black  | Board J3-21 (GND) | Session gauge -   |                                     |
| black  | Board J3-22 (GND) | Week gauge -      |                                     |
| green  | Board GPIO6       | Display CLK       |                                     |
| brown  | Board GPIO7       | Display DIO       |                                     |
| orange | Board J1-1 (3V3)  | Display VCC       | 3.3 V, not 5 V                      |
| black  | Board J3-1 (GND)  | Display GND       |                                     |
| yellow | Board GPIO14      | Strip DIN         | 3.3 V data, no level shifter        |
| red    | Board 5V          | D1 A              | ferrule shared with the buck output |
| red    | D1 K              | Strip +5V         | diode soldered on the strip         |
| black  | Board J1-22 (GND) | Strip GND         | ferrule shared with the buck output |

Pins are written as the part names them (`GPIO4`, `CLK`) or by terminal (`J1-22`); text in parentheses is a
comment. The order of this table is the order in which the video connects the wires.

## Layout

Optional placement hints for the generated project, top view, in millimetres from the board centre; rotations
in degrees around the vertical axis. Parts not listed are placed automatically. The project generator checks
that every connection can be routed (no `routingBlocked` route) and moves parts that block one.

| Name          | X    | Y    | Rotation |
|---------------|------|------|----------|
| Board         | 0    | 0    | 0        |
| Session gauge | -40  | -105 | 0        |
| Week gauge    | 40   | -105 | 0        |
| Display       | 0    | 90   | 180      |
| Strip         | -80  | 95   | 0        |
| D1            | -100 | 62   | 0        |
| Buck          | -95  | -40  | 0        |
| Fuse          | -150 | -35  | 0        |
| Power socket  | -150 | -95  | 0        |

## Checks

What `wiring-plan` verified against the project's sources, and what remains to confirm on the real parts:

- [x] Every GPIO above matches `esphome/claudemetre.yaml` (GPIO4, GPIO5 gauges; GPIO6, GPIO7 display;
      GPIO14 LED strip).
- [x] The display is powered at 3.3 V, as required by its 3.3 V data lines.
- [ ] SO-45 terminal polarity (+ / -) on the real gauges.
- [ ] TM1637 module pin order (CLK, DIO, VCC, GND).
- [ ] LP-16 socket: pin 1 is +12 V.
