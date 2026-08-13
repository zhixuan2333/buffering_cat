# Buffering Cat

Buffering Cat is a tiny USB status light built around the WCH CH32V003. Eight
LEDs form a ring around a cat face and can be controlled from the browser, the
Rust CLI, or lightweight Codex/ChatGPT activity hooks.

The repository contains the complete KiCad design, firmware, host tools, and a
WebHID controller with browser-based firmware updates.

## Repository layout

- [`buffering_cat.kicad_sch`](buffering_cat.kicad_sch) and
  [`buffering_cat.kicad_pcb`](buffering_cat.kicad_pcb): current hardware v1.1
- [`firmware/`](firmware/README.md): CH32V003 application and one-time USB HID
  bootloader
- [`host/`](host/README.md): native Rust command-line controller
- [`webhid/`](webhid/README.md): Chrome/Edge controller and firmware updater
- [`integrations/`](integrations/README.md): token-free Codex/ChatGPT activity
  hooks

Generated fabrication files, KiCad backups, editor state, build products,
dependencies, and tool caches are intentionally excluded from Git.

## Hardware revisions

| Revision | LED matrix GPIO | USB GPIO | Notes |
| --- | --- | --- | --- |
| v1.0 | `PA1/PD4/PA2` × `PD0/PC7/PC0` | `PD3=D+`, `PD2=D-` | Original 3×3 matrix; A2/C2 share a node and can ghost |
| v1.1 | `PC0/PD4/PC1/PA1` × `PC2/PA2` | `PD3=D+`, `PD2=D-`, `PD0=DPU` | Current KiCad 4×2 matrix; PD0 drives R5 (1.5 kΩ) |

On v1.0, D1 is at the left and D2–D8 continue counter-clockwise. Starting with
v1.1, D1 is at the top and D2–D8 continue counter-clockwise. Select the matching
hardware revision when building or updating; a build for the wrong revision
will drive the wrong GPIOs.

## Firmware releases

GitHub Actions builds application images for both v1.0 and v1.1 plus the common
USB bootloader.

- A push to `main` that changes firmware creates a prerelease whose tag is the
  first eight characters of the Git commit hash. GitHub rejects tag names made
  of exactly 40 hexadecimal characters, so a full SHA cannot be used directly.
- **Run workflow → Firmware release** accepts a manual `vX.Y.Z` version and
  publishes it as the latest stable release.
- Every release includes both `.bin` files, the one-time bootloader,
  `firmware-manifest.json`, and `SHA256SUMS`.

The application embeds the release version, Git hash, hardware revision, and
HID protocol version. `buffering-cat status` and the web controller expose the
machine-readable hardware/hash fields.

## Firmware updates

Install `buffering-cat-usb-bootloader.bin` once with WCH-Link. After that, open
the WebHID site in current Chrome or Edge, select the hardware revision and
release, reboot the device to updater mode, and install directly in the
browser. A local `.bin` can be selected when testing an unreleased build.
On connection, the site automatically detects the hardware revision and
firmware commit. It also resolves and selects the matching `vX.Y.Z` GitHub
Release when one exists.

The Rust CLI remains available as a recovery/update path:

```sh
buffering-cat bootloader
buffering-cat flash-usb buffering-cat-v1.1-v1.2.3.bin
```

The web controller is a serverless static export intended for self-deployment
to Cloudflare Pages. Use `webhid` as the project root and `out` as the build
output directory; no OpenAI/ChatGPT hosting integration is included.

## Local checks

```sh
make -C firmware HARDWARE_REV=10
make -C firmware clean
make -C firmware HARDWARE_REV=11
cargo test --manifest-path host/Cargo.toml
npm --prefix webhid test
```

The firmware Makefile expects sibling `ch32fun` and `rv003usb` checkouts by
default; see [`firmware/README.md`](firmware/README.md) for path overrides.

## License

MIT. See [`LICENSE`](LICENSE).
