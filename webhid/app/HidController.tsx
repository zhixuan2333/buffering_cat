"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flashFirmware } from "./usbUpdater";

const VID = 0x1209;
const PID = 0xd003;
const BOOTLOADER_PID = 0xb003;
const REPORT_ID = 0x01;
const PAYLOAD_BYTES = 15;

const CMD_SET_MASK = 0x01;
const CMD_SET_ANIMATION = 0x02;
const CMD_OFF = 0x03;
const BOOTLOADER_REPORT_ID = 0xfd;

type WebHidDevice = {
  opened: boolean;
  productName: string;
  vendorId: number;
  productId: number;
  open(): Promise<void>;
  close(): Promise<void>;
  sendFeatureReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
};

type WebHid = {
  requestDevice(options: {
    filters: Array<{ vendorId: number; productId: number }>;
  }): Promise<WebHidDevice[]>;
  getDevices(): Promise<WebHidDevice[]>;
  addEventListener(
    type: "disconnect",
    listener: (event: { device: WebHidDevice }) => void,
  ): void;
  removeEventListener(
    type: "disconnect",
    listener: (event: { device: WebHidDevice }) => void,
  ): void;
};

type GitHubAsset = {
  name: string;
  browser_download_url: string;
  digest?: string | null;
};

type GitHubRelease = {
  tag_name: string;
  name: string | null;
  target_commitish: string;
  prerelease: boolean;
  published_at: string;
  assets: GitHubAsset[];
};

type DetectedFirmware = {
  hardware: "v1.0" | "v1.1";
  hash: string;
};

const animationModes = [
  ["Chase", 1],
  ["Reverse", 2],
  ["Bounce", 3],
  ["Blink", 4],
  ["Fill", 5],
  ["Random", 6],
  ["Chase Trail", 7],
  ["Breathe", 8],
] as const;

const defaultSequence = "01 02 04 08 10 20 40 80 40 20 10 08 04 02";

function getHid(): WebHid | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { hid?: WebHid }).hid ?? null;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseSequence(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => {
      const normalized = token.toLowerCase().startsWith("0x")
        ? token.slice(2)
        : token;
      const parsed = Number.parseInt(normalized, 16);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) {
        throw new Error(`Invalid frame: ${token}`);
      }
      return parsed;
    });
}

export function HidController() {
  const [device, setDevice] = useState<WebHidDevice | null>(null);
  const [status, setStatus] = useState("Not connected");
  const [mask, setMask] = useState(0);
  const [visibleMask, setVisibleMask] = useState(0);
  const [brightness, setBrightness] = useState(255);
  const [animation, setAnimation] = useState(1);
  const [interval, setIntervalValue] = useState(120);
  const [sequence, setSequence] = useState(defaultSequence);
  const [sequenceRunning, setSequenceRunning] = useState(false);
  const [supported, setSupported] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState("Connect to detect firmware automatically");
  const [detectedFirmware, setDetectedFirmware] = useState<DetectedFirmware | null>(null);
  const [hardware, setHardware] = useState<"v1.0" | "v1.1">("v1.1");
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [releaseTagOverride, setReleaseTagOverride] = useState("");
  const [firmware, setFirmware] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [firmwareName, setFirmwareName] = useState("No firmware loaded");
  const [updateStatus, setUpdateStatus] = useState("Choose a release or local .bin file.");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updating, setUpdating] = useState(false);
  const stopSequence = useRef(false);

  const send = useCallback(
    async (payload: Uint8Array<ArrayBuffer>) => {
      if (!device?.opened) {
        throw new Error("Connect the device first.");
      }
      await device.sendFeatureReport(REPORT_ID, payload);
    },
    [device],
  );

  const readDeviceStatus = useCallback(async (target: WebHidDevice) => {
    if (!target.opened) return;
    const report = await target.receiveFeatureReport(REPORT_ID);
    const raw = new Uint8Array(report.buffer, report.byteOffset, report.byteLength);
    const data = raw.length >= 16 && raw[0] === REPORT_ID ? raw.slice(1) : raw;
    if (data.length < 10 || data[0] !== 0x81) {
      throw new Error("The device returned an unexpected status report.");
    }
    setMask(data[1]);
    setVisibleMask(data[2]);
    setAnimation(data[3]);
    setBrightness(data[4]);
    setIntervalValue(data[5] | (data[6] << 8));
    setStatus(`Connected · protocol ${data[8]} · USB address ${data[9]}`);
    if (data[8] >= 2 && data.length >= 15) {
      const revision = data[10];
      const detectedHardware = revision === 0x10 ? "v1.0" : revision === 0x11 ? "v1.1" : null;
      const hash = Array.from(data.slice(11, 15).reverse())
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (detectedHardware) {
        setHardware(detectedHardware);
        setDetectedFirmware({ hardware: detectedHardware, hash });
        setReleaseTagOverride("");
        setDeviceInfo(`Hardware ${detectedHardware} · firmware commit ${hash}`);
      } else {
        setDetectedFirmware(null);
        setDeviceInfo(`Unknown hardware 0x${revision.toString(16)} · firmware commit ${hash}`);
      }
    } else {
      setDetectedFirmware(null);
      setDeviceInfo(`Legacy firmware · protocol ${data[8]}`);
    }
  }, []);

  const readStatus = useCallback(async () => {
    if (device?.opened) await readDeviceStatus(device);
  }, [device, readDeviceStatus]);

  const openDevice = useCallback(async (candidate: WebHidDevice) => {
    if (!candidate.opened) await candidate.open();
    setDevice(candidate);
    setStatus(`Connected · ${candidate.productName}`);
    try {
      await readDeviceStatus(candidate);
    } catch (error) {
      setDeviceInfo(`Connected, but version detection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [readDeviceStatus]);

  const connect = useCallback(async () => {
    try {
      const hid = getHid();
      if (!hid) throw new Error("WebHID is not available in this browser.");
      const [selected] = await hid.requestDevice({
        filters: [{ vendorId: VID, productId: PID }],
      });
      if (!selected) return;
      await openDevice(selected);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [openDevice]);

  useEffect(() => {
    const hid = getHid();
    if (!hid) return;
    hid.getDevices().then((devices) => {
      setSupported(true);
      const known = devices.find(
        (candidate) => candidate.vendorId === VID && candidate.productId === PID,
      );
      if (known) openDevice(known).catch(() => undefined);
    });
    const handleDisconnect = (event: { device: WebHidDevice }) => {
      if (event.device.vendorId === VID && event.device.productId === PID) {
        setDevice(null);
        setStatus("Device disconnected");
      }
    };
    hid.addEventListener("disconnect", handleDisconnect);
    return () => hid.removeEventListener("disconnect", handleDisconnect);
  }, [openDevice]);

  useEffect(() => {
    fetch("https://api.github.com/repos/zhixuan2333/buffering_cat/releases?per_page=20", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        return response.json() as Promise<GitHubRelease[]>;
      })
      .then((available) => {
        const usable = available.filter((release) => !release.tag_name.endsWith("-draft"));
        setReleases(usable);
      })
      .catch(() => setUpdateStatus("Could not load releases. You can still choose a local .bin file."));
  }, []);

  const matchingReleases = detectedFirmware ? releases.filter((release) =>
    release.target_commitish.startsWith(detectedFirmware.hash) ||
    release.tag_name.startsWith(detectedFirmware.hash),
  ) : [];
  const detectedRelease = matchingReleases.find((release) => !release.prerelease) ?? matchingReleases[0];
  const releaseTag = releaseTagOverride || detectedRelease?.tag_name || releases[0]?.tag_name || "";
  const displayedDeviceInfo = detectedFirmware && detectedRelease
    ? `Hardware ${detectedFirmware.hardware} · firmware ${detectedRelease.tag_name} (${detectedFirmware.hash})`
    : deviceInfo;

  const applyMask = useCallback(
    async (nextMask: number) => {
      try {
        const payload = new Uint8Array(PAYLOAD_BYTES);
        payload[0] = CMD_SET_MASK;
        payload[1] = nextMask;
        payload[2] = brightness;
        await send(payload);
        setMask(nextMask);
        setVisibleMask(nextMask);
        setStatus(`Mask sent · 0x${nextMask.toString(16).padStart(2, "0")}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [brightness, send],
  );

  const startAnimation = useCallback(async () => {
    try {
      const payload = new Uint8Array(PAYLOAD_BYTES);
      payload[0] = CMD_SET_ANIMATION;
      payload[1] = animation;
      payload[2] = mask || 0xff;
      payload[3] = brightness;
      payload[4] = interval & 0xff;
      payload[5] = interval >> 8;
      await send(payload);
      setStatus("Animation running on device");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [animation, brightness, interval, mask, send]);

  const allOff = useCallback(async () => {
    try {
      const payload = new Uint8Array(PAYLOAD_BYTES);
      payload[0] = CMD_OFF;
      await send(payload);
      setMask(0);
      setVisibleMask(0);
      setStatus("All LEDs off");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [send]);

  const enterBootloader = useCallback(async () => {
    try {
      if (!device?.opened) throw new Error("Connect the device first.");
      await device.sendFeatureReport(
        BOOTLOADER_REPORT_ID,
        new Uint8Array([0x12, 0x34, 0xaa, 0xbb, 0xcc, 0xdd]),
      );
      setStatus("Rebooting into USB updater");
      setUpdateStatus("Updater mode requested. Continue with “Connect updater & install”.");
      setDevice(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [device]);

  const loadReleaseFirmware = useCallback(async () => {
    try {
      const release = releases.find((candidate) => candidate.tag_name === releaseTag);
      if (!release) throw new Error("Choose an available release first.");
      const expectedName = `buffering-cat-${hardware}-${release.tag_name}.bin`;
      const asset = release.assets.find((candidate) => candidate.name === expectedName);
      if (!asset) throw new Error(`${hardware} firmware is not attached to this release.`);
      setUpdateStatus(`Downloading ${asset.name}…`);
      const response = await fetch(asset.browser_download_url);
      if (!response.ok) throw new Error(`Firmware download failed (${response.status}).`);
      const image = new Uint8Array(await response.arrayBuffer());
      if (!image.length || image.length > 16 * 1024) {
        throw new Error("The release asset is not a valid CH32V003 firmware image.");
      }
      if (asset.digest?.startsWith("sha256:")) {
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", image)),
        ).map((value) => value.toString(16).padStart(2, "0")).join("");
        if (digest !== asset.digest.slice(7)) throw new Error("Firmware checksum mismatch.");
      }
      setFirmware(image);
      setFirmwareName(`${asset.name} · ${(image.length / 1024).toFixed(1)} KiB`);
      setUpdateStatus("Firmware ready. Reboot the connected cat into updater mode.");
      setUpdateProgress(0);
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : String(error));
    }
  }, [hardware, releaseTag, releases]);

  const chooseLocalFirmware = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const image = new Uint8Array(await file.arrayBuffer());
    if (!image.length || image.length > 16 * 1024) {
      setUpdateStatus("Firmware must be a non-empty .bin image up to 16 KiB.");
      return;
    }
    setFirmware(image);
    setFirmwareName(`${file.name} · ${(image.length / 1024).toFixed(1)} KiB`);
    setUpdateStatus("Local firmware ready. Confirm that it matches the selected hardware.");
    setUpdateProgress(0);
  }, []);

  const installFirmware = useCallback(async () => {
    try {
      if (!firmware) throw new Error("Load firmware before starting the update.");
      const hid = getHid();
      if (!hid) throw new Error("WebHID is not available in this browser.");
      setUpdating(true);
      setUpdateProgress(0);
      setUpdateStatus("Choose Buffering Cat USB Bootloader in the browser dialog.");
      const [bootloader] = await hid.requestDevice({
        filters: [{ vendorId: VID, productId: BOOTLOADER_PID }],
      });
      if (!bootloader) {
        setUpdateStatus("Updater selection was cancelled.");
        return;
      }
      setUpdateStatus("Installing firmware. Keep USB connected…");
      await flashFirmware(bootloader, firmware, setUpdateProgress);
      setUpdateStatus("Update complete. The device is restarting with the new firmware.");
      await bootloader.close().catch(() => undefined);
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdating(false);
    }
  }, [firmware]);

  const playSequence = useCallback(async () => {
    try {
      const frames = parseSequence(sequence);
      if (!frames.length) throw new Error("Add at least one frame.");
      stopSequence.current = false;
      setSequenceRunning(true);
      setStatus("Streaming frames from this browser");
      while (!stopSequence.current) {
        for (const frame of frames) {
          if (stopSequence.current) break;
          const payload = new Uint8Array(PAYLOAD_BYTES);
          payload[0] = CMD_SET_MASK;
          payload[1] = frame;
          payload[2] = brightness;
          await send(payload);
          setMask(frame);
          setVisibleMask(frame);
          await sleep(interval);
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSequenceRunning(false);
    }
  }, [brightness, interval, send, sequence]);

  const toggleLed = (index: number) => applyMask(mask ^ (1 << index));

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark">BC</div>
        <div className="brand-copy">
          <p className="eyebrow">CH32V003 · HID LAB</p>
          <h1>Buffering Cat</h1>
        </div>
        <button className="connect-button" onClick={connect} disabled={!supported}>
          <span className={device ? "status-dot connected" : "status-dot"} />
          {device ? "Connected" : "Connect USB"}
        </button>
      </header>

      <section className="hero-grid">
        <article className="device-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">LIVE OUTPUT</p>
              <h2>LED matrix</h2>
            </div>
            <button className="text-button" onClick={() => readStatus().catch(() => undefined)}>
              Sync status
            </button>
          </div>

          <div className={`cat-stage hardware-${hardware.replace(".", "-")}`} aria-label="Eight LED controls">
            <div className="cat-face" aria-hidden="true">
              <span className="ear left" />
              <span className="ear right" />
              <span className="eye left" />
              <span className="eye right" />
              <span className="mouth">ω</span>
              <span className="buffer-ring" />
            </div>
            <div className="led-grid">
              {Array.from({ length: 8 }, (_, index) => {
                const active = Boolean(visibleMask & (1 << index));
                const selected = Boolean(mask & (1 << index));
                return (
                  <button
                    key={index}
                    className={`led led-${index + 1}${active ? " active" : ""}${selected ? " selected" : ""}`}
                    onClick={() => toggleLed(index)}
                    aria-pressed={selected}
                    aria-label={`Toggle D${index + 1}`}
                  >
                    <span>D{index + 1}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="quick-actions">
            <button onClick={() => applyMask(0xff)}>All</button>
            <button onClick={() => applyMask(0x55)}>Odd</button>
            <button onClick={() => applyMask(0xaa)}>Even</button>
            <button className="danger" onClick={allOff}>Off</button>
          </div>
          <button className="text-button" onClick={enterBootloader}>
            Reboot to USB updater
          </button>
        </article>

        <aside className="control-stack">
          <article className="panel brightness-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">INTENSITY</p>
                <h2>Brightness</h2>
              </div>
              <output>{Math.round((brightness / 255) * 100)}%</output>
            </div>
            <input
              aria-label="Brightness"
              type="range"
              min="0"
              max="255"
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
              onPointerUp={() => applyMask(mask)}
              onKeyUp={() => applyMask(mask)}
            />
          </article>

          <article className="panel animation-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">ON-DEVICE</p>
                <h2>Animation</h2>
              </div>
              <span className="chip">No streaming</span>
            </div>
            <div className="mode-grid">
              {animationModes.map(([label, value]) => (
                <button
                  key={value}
                  className={animation === value ? "selected" : ""}
                  onClick={() => setAnimation(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="field-label" htmlFor="interval">Frame interval</label>
            <div className="number-field">
              <input
                id="interval"
                type="number"
                min="10"
                max="30000"
                value={interval}
                onChange={(event) => setIntervalValue(Number(event.target.value))}
              />
              <span>ms</span>
            </div>
            <button className="primary" onClick={startAnimation}>Run on device</button>
          </article>
        </aside>
      </section>

      <section className="sequence-panel panel">
        <div className="sequence-copy">
          <p className="eyebrow">BROWSER STREAM</p>
          <h2>Custom frame sequence</h2>
          <p>Enter hexadecimal masks. Each bit maps from D1 to D8.</p>
        </div>
        <textarea
          aria-label="Hexadecimal animation frames"
          value={sequence}
          onChange={(event) => setSequence(event.target.value)}
          spellCheck={false}
        />
        <button
          className={sequenceRunning ? "stop-button" : "primary"}
          onClick={() => {
            if (sequenceRunning) {
              stopSequence.current = true;
              setStatus("Browser sequence stopped");
            } else {
              playSequence();
            }
          }}
        >
          {sequenceRunning ? "Stop stream" : "Loop sequence"}
        </button>
      </section>

      <section className="updater-panel panel" aria-labelledby="updater-title">
        <div className="updater-copy">
          <p className="eyebrow">USB FIRMWARE UPDATE</p>
          <h2 id="updater-title">Update in the browser</h2>
          <p>{displayedDeviceInfo}</p>
          <p className="update-warning">
            The one-time USB bootloader must already be installed with WCH-Link.
            Do not disconnect USB while programming.
          </p>
        </div>

        <div className="updater-fields">
          <label>
            <span>Hardware revision</span>
            <select value={hardware} onChange={(event) => {
              setHardware(event.target.value as "v1.0" | "v1.1");
              setFirmware(null);
              setFirmwareName("No firmware loaded");
            }}>
              <option value="v1.0">v1.0</option>
              <option value="v1.1">v1.1 (current KiCad)</option>
            </select>
          </label>
          <label>
            <span>GitHub release</span>
            <select value={releaseTag} onChange={(event) => setReleaseTagOverride(event.target.value)}>
              {releases.length ? releases.map((release) => (
                <option key={release.tag_name} value={release.tag_name}>
                  {release.tag_name}{release.prerelease ? " · commit build" : ""}
                </option>
              )) : <option value="">No releases found</option>}
            </select>
          </label>
          <button className="secondary" onClick={loadReleaseFirmware} disabled={!releaseTag || updating}>
            Download selected firmware
          </button>
          <label className="file-button">
            <span>Or choose local .bin</span>
            <input
              type="file"
              accept=".bin,application/octet-stream"
              onChange={(event) => chooseLocalFirmware(event.target.files?.[0])}
              disabled={updating}
            />
          </label>
        </div>

        <div className="update-actions">
          <div className="firmware-file">{firmwareName}</div>
          <div className="update-button-row">
            <button className="secondary" onClick={enterBootloader} disabled={!device || updating}>
              1. Reboot to updater
            </button>
            <button className="primary" onClick={installFirmware} disabled={!firmware || updating}>
              {updating ? `Installing ${updateProgress}%` : "2. Connect updater & install"}
            </button>
          </div>
          <progress max="100" value={updateProgress}>{updateProgress}%</progress>
          <p className="update-status" aria-live="polite">{updateStatus}</p>
        </div>
      </section>

      <footer>
        <div className="connection-readout">
          <span className={device ? "status-dot connected" : "status-dot"} />
          <span>{supported ? status : "WebHID requires Chrome or Edge in a secure context"}</span>
        </div>
        <span className="usb-id">VID 1209 · PID D003 / B003 · Protocol 2</span>
      </footer>
    </main>
  );
}
