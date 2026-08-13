# ChatGPT and Codex activity LEDs

The lifecycle hook follows the public Codex Micro status semantics:

- `SessionStart` / Idle: dim steady light
- `UserPromptSubmit` / Thinking: `chase-trail`
- `Stop` / Complete: `breathe`
- `PermissionRequest` / Requires input: slow `bounce`
- structured tool error / Error: rapid `blink`
- `SessionEnd` / No assigned chat: off

The most recently active session owns the single LED device. Late events from
another background chat are ignored, which keeps parallel chats from producing
out-of-order animation changes.

The hook does not ask a model to call a tool. CH32V003 runs each animation by
itself after one HID report, so animation time consumes no tokens.

Build both binaries, then install the user-level hook:

```sh
make -C firmware
cargo build --release --manifest-path host/Cargo.toml
cp integrations/codex-hooks.json ~/.codex/hooks.json
```

Restart ChatGPT/Codex and review the new hook once with `/hooks`. User-level
hooks are shared by ChatGPT desktop's Codex tasks and Codex CLI sessions.

To acknowledge or turn the LEDs off without starting another turn:

```sh
host/target/release/buffering-cat activity off
```

Codex Micro's proprietary USB/Bluetooth wire protocol is not publicly
documented. This integration mirrors its documented chat-state behavior through
Codex lifecycle hooks; it does not impersonate the official keyboard hardware.
