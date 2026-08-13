use std::error::Error;
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::thread;
use std::time::Duration;

use clap::{Parser, Subcommand, ValueEnum};
use hidapi::{HidApi, HidDevice};

const VID: u16 = 0x1209;
const PID: u16 = 0xd003;
const REPORT_ID: u8 = 0x01;
const REPORT_BYTES: usize = 16;

const CMD_SET_MASK: u8 = 0x01;
const CMD_SET_ANIMATION: u8 = 0x02;
const CMD_OFF: u8 = 0x03;
const BOOTLOADER_REPORT_ID: u8 = 0xfd;
const BUILD_VERSION: &str = match option_env!("BUFFERING_CAT_BUILD_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

#[derive(Parser)]
#[command(
    name = "buffering-cat",
    version = BUILD_VERSION,
    about = "Control the Buffering Cat CH32V003 LEDs over USB HID"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List matching HID devices.
    List,
    /// Read the current mask, animation, and brightness.
    Status,
    /// Turn every LED off.
    Off,
    /// Turn on one LED (1 through 8).
    Led {
        led: u8,
        #[arg(short, long, default_value_t = 255)]
        brightness: u8,
    },
    /// Set an 8-bit LED mask, for example 0x55 or 11110000.
    Mask {
        #[arg(value_parser = parse_mask)]
        mask: u8,
        #[arg(short, long, default_value_t = 255)]
        brightness: u8,
    },
    /// Run an animation in the device firmware.
    Animate {
        #[arg(value_enum)]
        mode: Animation,
        #[arg(short, long, value_parser = parse_mask, default_value = "0xff")]
        mask: u8,
        #[arg(short, long, default_value_t = 120)]
        interval: u16,
        #[arg(short, long, default_value_t = 255)]
        brightness: u8,
    },
    /// Show Codex/ChatGPT activity without model-driven polling.
    Activity {
        #[arg(value_enum)]
        state: ActivityState,
    },
    /// Host-side compatibility loop for firmware older than animation ID 8.
    #[command(hide = true)]
    BreatheFallback { state_file: PathBuf, token: String },
    /// Stream an arbitrary mask sequence from the PC.
    Sequence {
        #[arg(required = true, value_parser = parse_mask)]
        frames: Vec<u8>,
        #[arg(short, long, default_value_t = 100)]
        interval: u64,
        #[arg(short, long, default_value_t = 1)]
        loops: u32,
        #[arg(short, long, default_value_t = 255)]
        brightness: u8,
    },
    /// Reboot the application into the USB HID bootloader.
    Bootloader,
    /// Write a .bin firmware image through the USB HID bootloader.
    FlashUsb {
        /// User-code .bin image to write at flash address 0x08000000.
        firmware: PathBuf,
        /// Path or command name for a b003boot-capable minichlink.
        #[arg(long, default_value = "minichlink")]
        minichlink: String,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum Animation {
    Static,
    Chase,
    Reverse,
    Bounce,
    Blink,
    Fill,
    Random,
    ChaseTrail,
    Breathe,
}

impl Animation {
    fn protocol_value(self) -> u8 {
        match self {
            Self::Static => 0,
            Self::Chase => 1,
            Self::Reverse => 2,
            Self::Bounce => 3,
            Self::Blink => 4,
            Self::Fill => 5,
            Self::Random => 6,
            Self::ChaseTrail => 7,
            Self::Breathe => 8,
        }
    }
}

#[derive(Clone, Copy, ValueEnum)]
enum ActivityState {
    /// Codex Micro Idle: dim steady light.
    Idle,
    /// Codex Micro Thinking: chase with a fading tail.
    #[value(alias = "working")]
    Thinking,
    /// Codex Micro Complete: softly breathe until acknowledged.
    #[value(alias = "done")]
    Complete,
    /// Codex Micro Requires input: slow bounce.
    RequiresInput,
    /// Codex Micro Error: rapid blink.
    Error,
    /// Codex Micro No assigned chat, app/session closed, or acknowledged.
    #[value(alias = "acknowledge")]
    Off,
}

fn parse_mask(value: &str) -> Result<u8, String> {
    let compact = value.replace('_', "");
    if let Some(hex) = compact
        .strip_prefix("0x")
        .or_else(|| compact.strip_prefix("0X"))
    {
        u8::from_str_radix(hex, 16).map_err(|_| format!("invalid 8-bit hex mask: {value}"))
    } else if let Some(binary) = compact
        .strip_prefix("0b")
        .or_else(|| compact.strip_prefix("0B"))
    {
        u8::from_str_radix(binary, 2).map_err(|_| format!("invalid 8-bit binary mask: {value}"))
    } else if compact.len() == 8 && compact.bytes().all(|byte| matches!(byte, b'0' | b'1')) {
        u8::from_str_radix(&compact, 2).map_err(|_| format!("invalid 8-bit binary mask: {value}"))
    } else {
        compact
            .parse::<u8>()
            .map_err(|_| format!("invalid mask (use 0xff, 0b10101010, or 0-255): {value}"))
    }
}

fn open_device(api: &HidApi) -> Result<HidDevice, Box<dyn Error>> {
    api.open(VID, PID).map_err(|error| {
        format!(
            "Buffering Cat HID {:04x}:{:04x} not found: {error}. \
             Check USB wiring and the required 1.5 kOhm D- pull-up.",
            VID, PID
        )
        .into()
    })
}

fn send_report(device: &HidDevice, report: &[u8; REPORT_BYTES]) -> Result<(), Box<dyn Error>> {
    device.send_feature_report(report)?;
    Ok(())
}

fn set_mask(device: &HidDevice, mask: u8, brightness: u8) -> Result<(), Box<dyn Error>> {
    let mut report = [0u8; REPORT_BYTES];
    report[0] = REPORT_ID;
    report[1] = CMD_SET_MASK;
    report[2] = mask;
    report[3] = brightness;
    send_report(device, &report)
}

fn set_animation(
    device: &HidDevice,
    mode: Animation,
    mask: u8,
    brightness: u8,
    interval: u16,
) -> Result<(), Box<dyn Error>> {
    let mut report = [0u8; REPORT_BYTES];
    report[0] = REPORT_ID;
    report[1] = CMD_SET_ANIMATION;
    report[2] = mode.protocol_value();
    report[3] = mask;
    report[4] = brightness;
    report[5..7].copy_from_slice(&interval.clamp(10, 30_000).to_le_bytes());
    send_report(device, &report)
}

fn turn_off(device: &HidDevice) -> Result<(), Box<dyn Error>> {
    let mut report = [0u8; REPORT_BYTES];
    report[0] = REPORT_ID;
    report[1] = CMD_OFF;
    send_report(device, &report)
}

fn reboot_to_bootloader(device: &HidDevice) -> Result<(), Box<dyn Error>> {
    let report = [BOOTLOADER_REPORT_ID, 0x12, 0x34, 0xaa, 0xbb, 0xcc, 0xdd];
    device.send_feature_report(&report)?;
    Ok(())
}

fn flash_usb(firmware: &PathBuf, minichlink: &str) -> Result<(), Box<dyn Error>> {
    let metadata = std::fs::metadata(firmware)
        .map_err(|error| format!("cannot read {}: {error}", firmware.display()))?;
    if metadata.len() == 0 || metadata.len() > 16 * 1024 {
        return Err(format!(
            "{} must be a non-empty CH32V003 user-code image no larger than 16 KiB",
            firmware.display()
        )
        .into());
    }

    let status = ProcessCommand::new(minichlink)
        .args(["-C", "b003boot", "-c", "0x1209b003", "-w"])
        .arg(firmware)
        .args(["flash", "-b"])
        .status()
        .map_err(|error| format!("failed to start {minichlink}: {error}"))?;
    if !status.success() {
        return Err(format!(
            "USB update failed ({status}). Install the one-time bootloader first and reconnect USB."
        )
        .into());
    }
    Ok(())
}

fn print_status(device: &HidDevice) -> Result<(), Box<dyn Error>> {
    let mut report = [0u8; REPORT_BYTES];
    report[0] = REPORT_ID;
    let length = device.get_feature_report(&mut report)?;
    if length < 11 || report[0] != REPORT_ID || report[1] != 0x81 {
        return Err(format!("unexpected status report ({length} bytes): {report:02x?}").into());
    }

    let interval = u16::from_le_bytes([report[6], report[7]]);
    println!("mask:       0x{:02x}", report[2]);
    println!("visible:    0x{:02x}", report[3]);
    println!("animation:  {}", report[4]);
    println!("brightness: {}", report[5]);
    println!("interval:   {interval} ms");
    println!("position:   {}", report[8] + 1);
    println!("protocol:   {}", report[9]);
    println!("usb addr:   {}", report[10]);
    if report[9] >= 2 && length >= 16 {
        let hardware = report[11];
        let git_hash = u32::from_le_bytes([report[12], report[13], report[14], report[15]]);
        println!("hardware:   v{}.{}", hardware >> 4, hardware & 0x0f);
        println!("firmware:   {git_hash:08x}");
    }
    Ok(())
}

fn list_devices(api: &HidApi) {
    let mut found = false;
    for info in api
        .device_list()
        .filter(|info| info.vendor_id() == VID && info.product_id() == PID)
    {
        found = true;
        println!(
            "{:04x}:{:04x}  product={}  serial={}  path={}",
            info.vendor_id(),
            info.product_id(),
            info.product_string().unwrap_or("?"),
            info.serial_number().unwrap_or("?"),
            info.path().to_string_lossy()
        );
    }
    if !found {
        println!("No {:04x}:{:04x} HID device found.", VID, PID);
    }
}

fn breathe_fallback(
    device: &HidDevice,
    state_file: &PathBuf,
    token: &str,
) -> Result<(), Box<dyn Error>> {
    let mut phase = 0u8;
    loop {
        let current = std::fs::read_to_string(state_file).unwrap_or_default();
        if current.trim() != token {
            return Ok(());
        }

        let ramp = if phase < 32 { phase } else { 63 - phase } as u16;
        let scale = 8u16 + (247u16 * ramp * ramp + 480) / 961;
        let level = ((180u16 * scale + 127) / 255) as u8;
        set_mask(device, 0xff, level)?;
        phase = (phase + 1) & 63;
        thread::sleep(Duration::from_millis(30));
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let cli = Cli::parse();
    let api = HidApi::new()?;

    if matches!(cli.command, Command::List) {
        list_devices(&api);
        return Ok(());
    }

    if let Command::FlashUsb {
        firmware,
        minichlink,
    } = &cli.command
    {
        flash_usb(firmware, minichlink)?;
        println!("Firmware written through USB HID.");
        return Ok(());
    }

    let device = open_device(&api)?;
    match cli.command {
        Command::List => unreachable!(),
        Command::Status => print_status(&device)?,
        Command::Off => {
            turn_off(&device)?;
            println!("All LEDs off.");
        }
        Command::Led { led, brightness } => {
            if !(1..=8).contains(&led) {
                return Err("LED must be in the range 1..=8".into());
            }
            set_mask(&device, 1 << (led - 1), brightness)?;
            println!("D{led} on at brightness {brightness}.");
        }
        Command::Mask { mask, brightness } => {
            set_mask(&device, mask, brightness)?;
            println!("Mask set to 0x{mask:02x} at brightness {brightness}.");
        }
        Command::Animate {
            mode,
            mask,
            interval,
            brightness,
        } => {
            set_animation(&device, mode, mask, brightness, interval)?;
            println!("Device animation started.");
        }
        Command::Activity { state } => match state {
            ActivityState::Idle => {
                set_mask(&device, 0xff, 24)?;
            }
            ActivityState::Thinking => {
                set_animation(&device, Animation::ChaseTrail, 0xff, 200, 80)?;
            }
            ActivityState::Complete => {
                set_animation(&device, Animation::Breathe, 0xff, 180, 30)?;
            }
            ActivityState::RequiresInput => {
                set_animation(&device, Animation::Bounce, 0xff, 150, 140)?;
            }
            ActivityState::Error => {
                set_animation(&device, Animation::Blink, 0xff, 220, 120)?;
            }
            ActivityState::Off => {
                turn_off(&device)?;
            }
        },
        Command::BreatheFallback { state_file, token } => {
            breathe_fallback(&device, &state_file, &token)?;
        }
        Command::Sequence {
            frames,
            interval,
            loops,
            brightness,
        } => {
            for _ in 0..loops {
                for &frame in &frames {
                    set_mask(&device, frame, brightness)?;
                    thread::sleep(Duration::from_millis(interval));
                }
            }
            println!("Sequence complete.");
        }
        Command::Bootloader => {
            reboot_to_bootloader(&device)?;
            println!("Rebooting into USB HID bootloader (1209:b003).");
        }
        Command::FlashUsb { .. } => unreachable!(),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_mask;

    #[test]
    fn parses_supported_mask_formats() {
        assert_eq!(parse_mask("0x55").unwrap(), 0x55);
        assert_eq!(parse_mask("0b1010_1010").unwrap(), 0xaa);
        assert_eq!(parse_mask("11110000").unwrap(), 0xf0);
        assert_eq!(parse_mask("255").unwrap(), 0xff);
    }
}
