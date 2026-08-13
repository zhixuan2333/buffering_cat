# Rust HID controller

Build the native controller:

```sh
cargo build --release
```

Examples:

```sh
cargo run -- list
cargo run -- status
cargo run -- led 3
cargo run -- mask 0x55 --brightness 160
cargo run -- animate chase --interval 100
cargo run -- animate chase-trail --interval 100
cargo run -- animate breathe --interval 30 --brightness 180
cargo run -- animate bounce --mask 0x7e --interval 80
cargo run -- sequence --interval 60 --loops 4 0x01 0x02 0x04 0x08 0x10 0x20 0x40 0x80
cargo run -- off
```

`activity working`, `activity done`, and `activity acknowledge` are intended
for deterministic Codex/ChatGPT lifecycle hooks. They do not call a model or
poll the device; the selected animation continues in CH32V003 firmware.

Mask bit 0 controls D1 and bit 7 controls D8.

## Update firmware over USB

The USB bootloader must first be installed once through WCH-Link. Subsequent
updates use the same USB connector:

```sh
cargo run -- bootloader
cargo run -- flash-usb ../firmware/buffering_cat.bin
```

`flash-usb` invokes a `b003boot`-capable `minichlink` and accepts an override:

```sh
cargo run -- flash-usb ../firmware/buffering_cat.bin \
  --minichlink /path/to/minichlink
```

It accepts only non-empty images up to the CH32V003's 16 KiB user flash. The
USB updater enumerates as `1209:b003`; the normal LED controller is
`1209:d003`.
