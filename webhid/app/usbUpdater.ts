const BOOTLOADER_REPORT = 0xaa;
const BOOTLOADER_STATUS_REPORT = 0xa8;
const FLASH_BASE = 0x08000000;
const FLASH_STATUS = 0x4002200c;
const FLASH_CONTROL = 0x40022010;
const FLASH_KEY = 0x40022004;
const FLASH_MODE_KEY = 0x40022024;
const FLASH_PAGE_PROGRAM = 0x00010000;
const FLASH_BUFFER_RESET = 0x00080000;
const FLASH_KEY1 = 0x45670123;
const FLASH_KEY2 = 0xcdef89ab;
const SECTOR_BYTES = 64;
const MAX_FIRMWARE_BYTES = 16 * 1024;

const HALT_WAIT = bytes("81 46 94 c1 fd 56 14 c1 82 80");
const WRITE_WORD = bytes(`
  23 a0 05 00 13 07 45 03 0c 43 50 43
  2e 96 21 07 14 43 94 c1 91 05 11 07
  e3 cc c5 fe 93 06 f0 ff 14 c1 82 80
  00 00 00 00 00 00 00 00 00 00 00 00
`);
const ERASE_BLOCKS = bytes(`
  13 07 85 03 0c 43 5c 43 83 12 87 00
  03 16 a7 00 2e 96 b7 06 02 00 d4 c3
  93 86 06 04 8c c7 d4 c3 98 43 05 8b
  75 ff 96 95 e3 ca c5 fe fd 56 14 c1
  01 00 82 80
`);
const WRITE_64 = bytes(`
  13 07 45 03 0c 43 13 86 05 04 5c 43
  8c c7 14 47 94 c1 b7 06 05 00 d4 c3
  94 41 91 05 11 07 e3 c8 c5 fe c1 66
  93 86 06 04 d4 c3 fd 56 14 c1 82 80
`);
const RUN_APPLICATION = bytes(`
  b7 f5 ff 1f 93 87 c5 77 03 a7 07 00 13 57 07 01
  83 96 07 00 93 c7 c6 77 63 16 f7 00 33 87 b6 00
  67 00 07 00 b7 27 02 40 93 87 87 02 37 07 67 45
  13 07 37 12 23 a0 e7 00 b7 27 02 40 93 87 87 02
  37 97 ef cd 13 07 b7 9a 23 a0 e7 00 b7 27 02 40
  93 87 c7 00 23 a0 07 00 b7 27 02 40 93 87 07 01
  13 07 00 08 23 a0 e7 00 b7 f7 00 e0 93 87 07 d1
  37 07 00 80 23 a0 e7 00
`);

export type UpdaterHidDevice = {
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendFeatureReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
};

function bytes(value: string): Uint8Array {
  return new Uint8Array(
    value.trim().split(/\s+/).filter(Boolean).map((part) => Number.parseInt(part, 16)),
  );
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer).setUint32(offset, value >>> 0, true);
}

function responsePayload(view: DataView): Uint8Array {
  const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return raw[0] === BOOTLOADER_STATUS_REPORT ? raw.slice(1) : raw;
}

class B003Bootloader {
  constructor(private readonly device: UpdaterHidDevice) {}

  private async commit(
    code: Uint8Array,
    words: number[] = [],
    data?: Uint8Array,
    waitForCompletion = true,
  ): Promise<void> {
    const report = new Uint8Array(128);
    report[0] = BOOTLOADER_REPORT;
    let cursor = 4;
    report.set(code, cursor);
    cursor += code.length;
    for (const word of words) {
      writeU32(report, cursor, word);
      cursor += 4;
    }
    if (data) {
      report.set(data, cursor);
      cursor += data.length;
    }
    if (cursor + 4 > report.length) {
      throw new Error("The firmware block is too large for the USB bootloader report.");
    }
    writeU32(report, report.length - 4, 0x1234abcd);

    // WebHID supplies the report ID separately; the bootloader descriptor adds it
    // back to the 127-byte payload on the wire.
    await this.device.sendFeatureReport(BOOTLOADER_REPORT, report.slice(1));
    if (!waitForCompletion) return;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const status = responsePayload(
          await this.device.receiveFeatureReport(BOOTLOADER_STATUS_REPORT),
        );
        if (status[0] === 0xff) return;
      } catch {
        // Flash erase/program operations can briefly NAK control transfers.
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The USB bootloader did not finish the flash operation.");
  }

  private writeWord(address: number, value: number): Promise<void> {
    const data = new Uint8Array(4);
    writeU32(data, 0, value);
    return this.commit(WRITE_WORD, [address, 4], data);
  }

  async flash(
    firmware: Uint8Array<ArrayBuffer>,
    onProgress: (percent: number) => void,
  ): Promise<void> {
    if (!firmware.length || firmware.length > MAX_FIRMWARE_BYTES) {
      throw new Error("Firmware must be a non-empty CH32V003 image up to 16 KiB.");
    }

    const paddedLength = Math.ceil(firmware.length / SECTOR_BYTES) * SECTOR_BYTES;
    const padded = new Uint8Array(paddedLength).fill(0xff);
    padded.set(firmware);

    await this.commit(HALT_WAIT);
    await this.writeWord(FLASH_KEY, FLASH_KEY1);
    await this.writeWord(FLASH_KEY, FLASH_KEY2);
    await this.writeWord(FLASH_MODE_KEY, FLASH_KEY1);
    await this.writeWord(FLASH_MODE_KEY, FLASH_KEY2);
    await this.commit(ERASE_BLOCKS, [
      FLASH_BASE,
      FLASH_STATUS,
      SECTOR_BYTES | (paddedLength << 16),
    ]);

    for (let offset = 0; offset < padded.length; offset += SECTOR_BYTES) {
      await this.writeWord(FLASH_CONTROL, FLASH_PAGE_PROGRAM);
      await this.writeWord(FLASH_CONTROL, FLASH_PAGE_PROGRAM | FLASH_BUFFER_RESET);
      await this.commit(
        WRITE_64,
        [FLASH_BASE + offset, FLASH_STATUS],
        padded.slice(offset, offset + SECTOR_BYTES),
      );
      onProgress(Math.round(((offset + SECTOR_BYTES) / padded.length) * 100));
    }

    await this.commit(RUN_APPLICATION, [], undefined, false);
  }
}

export async function flashFirmware(
  device: UpdaterHidDevice,
  firmware: Uint8Array<ArrayBuffer>,
  onProgress: (percent: number) => void,
): Promise<void> {
  if (!device.opened) await device.open();
  await new B003Bootloader(device).flash(firmware, onProgress);
}
