# Wiring — reference project (study copy)

Study copy of the reference project's wiring, completed for the feasibility study: power input chain, ground
distribution over the terminal board's GND terminals, and the diode on the LED strip. Not the project's own
document; source of truth for the spike renders only.

The ESP32-S3-DevKitC-1 is plugged onto the MRD076A terminal adapter: every wire lands on a screw terminal.
Terminal *n* of the left block is header pin J1-*n*, of the right block J3-*n*; pin 1 is at the antenna end.

## Parts

| Name          | Part                 | Pins                    | Note                                          |
|---------------|----------------------|-------------------------|-----------------------------------------------|
| Board         | mrd076a-esp32-s3     |                         | ESP32-S3-DevKitC-1 N16R8 on the MRD076A        |
| Session gauge | so-45                |                         | full scale lowered to ~3 V (6.2 kΩ inside)     |
| Week gauge    | so-45                |                         | same as the session gauge                     |
| Display       | tm1637               |                         | 4-digit 0.56" module, powered at 3.3 V        |
| Strip         | stand-in 28x10x2     | +5V, DIN, GND           | 4 × WS2812B, 144 LED/m; wires soldered        |
| D1            | stand-in 9x4x4       | A, K                    | 1N400x, soldered at the strip's +5V input     |
| Buck          | stand-in 22x17x4     | IN+, IN-, OUT+, OUT-    | Mini360 step-down, 12 V to 5 V                |
| Power socket  | lp16-2pole           |                         | 12 V input on the side plate (1 = +12 V)      |
| Fuse          | fuse-holder          |                         | protects the 12 V input                       |

## Connections

| Wire   | From                 | To                     | Note                                  |
|--------|----------------------|------------------------|---------------------------------------|
| orange | Power socket 1       | Fuse END               | +12 V                                 |
| orange | Fuse SIDE            | Buck IN+               | +12 V fused                           |
| black  | Power socket 2       | Buck IN-               | 0 V                                   |
| red    | Buck OUT+            | Board 5V               | 5 V into the board (USB not used)     |
| black  | Buck OUT-            | Board J1-22 (GND)      |                                       |
| blue   | Board GPIO4          | Session gauge +        | PWM 25 kHz, 1.2 mA max                |
| purple | Board GPIO5          | Week gauge +           | PWM 25 kHz, 1.2 mA max                |
| black  | Board J3-21 (GND)    | Session gauge -        |                                       |
| black  | Board J3-22 (GND)    | Week gauge -           |                                       |
| green  | Board GPIO6          | Display CLK            |                                       |
| brown  | Board GPIO7          | Display DIO            |                                       |
| orange | Board J1-1 (3V3)     | Display VCC            | 3.3 V, not 5 V                        |
| black  | Board J3-1 (GND)     | Display GND            |                                       |
| yellow | Board GPIO14         | Strip DIN              | 3.3 V data, no level shifter          |
| red    | Board 5V             | D1 A                   | ferrule shared with the buck output   |
| red    | D1 K                 | Strip +5V              | diode soldered on the strip           |
| black  | Board J1-22 (GND)    | Strip GND              | ferrule shared with the buck output   |
