# Buffering Cat USB HID firmware

This CH32V003F4P6 firmware exposes the eight LEDs as a vendor-defined USB HID
feature report. It supports individual LED masks, brightness, on-device
animations, status reads, and PC-streamed frame sequences.

## USB implementation and hardware revisions

CH32V003 does not contain a hardware USB peripheral, so the firmware uses
[rv003usb](https://github.com/cnlohr/rv003usb), a low-speed software USB stack,
instead of the TinyUSB device core. The HID report descriptor follows the same
standard HID descriptor format and works with hidapi and WebHID.

Both revisions route `D+` to `PD3` and `D-` to `PD2` through U2
(USBLC6-2SC6). Hardware v1.0 needs a **1.5 kOhm pull-up from D- to 3.3 V** added
if it is not already fitted. The current v1.1 KiCad design routes `PD0` through
R5 (1.5 kOhm) to D-, so firmware drives `PD0` high only while USB is attached.

## Build

The Makefile expects sibling checkouts by default:

```sh
make HARDWARE_REV=10 # PCB v1.0
make clean
make HARDWARE_REV=11 # PCB v1.1 (default)
make flash
```

Override their locations when needed:

```sh
make HARDWARE_REV=11 \
  FIRMWARE_VERSION=v1.2.3 GIT_HASH=0123abcd \
  CH32FUN=/path/to/ch32fun/ch32fun RV003USB=/path/to/rv003usb
```

The build produces `buffering_cat.bin`. USB identity is `1209:d003`, product
`Buffering Cat LED`, report ID 1. `FIRMWARE_VERSION`, the first eight hex digits
of `GIT_HASH`, the hardware revision, and protocol version are embedded in each
release build.

## USB firmware updates

Build the one-time USB HID bootloader separately:

```sh
make bootloader
```

This produces `usb_bootloader/buffering_cat_bootloader.bin` for the CH32V003
1,920-byte bootloader region. Install it once with WCH-Link and enable the
CH32V003 bootloader option. After that, the application can reboot into the
`1209:b003` HID updater using feature report `fd 12 34 aa bb cc dd`; normal
user-code updates no longer require WCH-Link.

The bootloader uses the same `PD3=D+`, `PD2=D-`, and fixed 1.5 kOhm D- pull-up
as the application. It stays available for about five seconds after power-up,
then starts the application when no updater connects.

With an rv003usb-compatible `minichlink` and WCH-Link, the one-time install is:

```sh
minichlink -a -w usb_bootloader/buffering_cat_bootloader.bin bootloader -B
minichlink -w +a55aef10 option
```

The second command enables the bootloader while retaining the reset pin. Back
up the bootloader and option regions before changing an already-configured
device. Do not use `flash-usb` for the bootloader image itself; it intentionally
updates only regular user flash.

## HID feature report v1

The report is 16 bytes with native hidapi (`byte 0` is report ID 1). WebHID
passes the report ID separately and sends the remaining 15-byte payload.

| Payload byte | Meaning |
| --- | --- |
| 0 | command |
| 1 | LED mask or animation ID |
| 2 | brightness or animation mask |
| 3 | animation brightness |
| 4..5 | animation interval in ms, little-endian |

Commands are `01 set-mask`, `02 set-animation`, `03 off`, and `04 ping`.
Animation IDs are `0 static`, `1 chase`, `2 reverse`, `3 bounce`, `4 blink`,
`5 fill`, `6 random`, `7 chase-trail`, and `8 breathe`. Chase-trail lights the head at the
selected brightness and its two preceding LEDs at about 63% and 25%. Mask bit
0 controls D1; bit 7 controls D8. Intervals are clamped to 10–30000 ms.

On hardware v1.0, D1 is at the left and D2 through D8 continue
counter-clockwise. Starting with v1.1, D1 is at the top and D2 through D8
continue counter-clockwise.

Status (`81`) returns base mask, visible mask, animation ID, brightness,
interval, animation position, protocol version, USB address, hardware revision,
and a 32-bit Git hash prefix. Protocol 2 adds the final five metadata bytes.

## Hardware v1.0 LED-matrix limitation

The schematic joins the A2 row to the C2 column. Firmware puts unused cathode
columns in high impedance to greatly reduce R3-fed ghost current into D7/D8,
but the remaining two-LED series path cannot be eliminated in firmware.
Hardware v1.1 replaces this with a clean four-anode by two-cathode matrix.
