import { describe, expect, it, vi } from 'vitest';

class TestFileReader {
  result: ArrayBuffer | string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private finish(result: ArrayBuffer | string): void {
    this.result = result;
    this.onload?.({ target: this } as unknown as Event);
  }

  private fail(error: Error): void {
    this.error = error;
    this.onerror?.({ target: this } as unknown as Event);
  }

  readAsArrayBuffer(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) => this.finish(buffer))
      .catch((error) => this.fail(error));
  }

  readAsText(blob: Blob): void {
    void blob
      .text()
      .then((text) => this.finish(text))
      .catch((error) => this.fail(error));
  }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const u16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const u32 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];

const makeZip = (files: Record<string, string | Uint8Array>): Blob => {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data);
    const localHeader = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...data
    ]);
    const centralHeader = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes
    ]);
    local.push(localHeader);
    central.push(centralHeader);
    offset += localHeader.length;
  }

  const centralSize = central.reduce((total, item) => total + item.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(central.length),
    ...u16(central.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0)
  ]);

  return new Blob([...local, ...central, end], { type: 'application/zip' });
};

class ScriptFastbootDevice {
  readonly events: string[] = [];
  readonly reconnects: ScriptFastbootDevice[] = [];

  async connect(): Promise<void> {
    this.events.push('connect');
  }

  async getVariable(name: string): Promise<string | null> {
    if (name === 'is-userspace') {
      return 'no';
    }
    if (name === 'product') {
      return 'frankel';
    }
    return null;
  }

  async runCommand(command: string): Promise<{ text: string }> {
    this.events.push(`command:${command}`);
    return { text: '' };
  }

  async waitForDisconnect(): Promise<void> {}

  async waitForConnect(onReconnect?: () => void | Promise<void>): Promise<void> {
    this.events.push('waitForConnect');
    await onReconnect?.();
  }

  async reboot(target = ''): Promise<void> {
    this.events.push(`reboot:${target}`);
  }

  async flashBlob(partition: string, blob: Blob, onProgress?: (progress: number) => void): Promise<void> {
    expect(blob.size).toBeGreaterThan(0);
    this.events.push(`flash:${partition}`);
    onProgress?.(1);
  }
}

const installBrowserPolyfills = (): void => {
  vi.stubGlobal('FileReader', TestFileReader);
  vi.stubGlobal('ProgressEvent', class ProgressEvent extends Event {});
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0)
  });
};

const makeNewLayoutZip = (): Blob =>
  makeZip({
    'script.txt': [
      'flash radio radio.img',
      'reboot-bootloader',
      'flash avb_custom_key avb_pkmd.bin',
      'flash boot boot.img',
      'erase userdata',
      'erase metadata',
      'flash super super_1.img',
      'flash super super_2.img'
    ].join('\n'),
    'radio.img': 'radio',
    'avb_pkmd.bin': 'avb',
    'boot.img': 'boot',
    'super_1.img': 'super-one',
    'super_2.img': 'super-two'
  });

describe('GrapheneOS install-layout fastboot engine', () => {
  it('detects and flashes a new layout without nested image zip or undefined getData', async () => {
    installBrowserPolyfills();
    const fastboot = await import('./vendor/graphene-fastboot.mjs');
    const blob = makeNewLayoutZip();
    const device = new ScriptFastbootDevice();
    const progress: string[] = [];

    await expect(fastboot.detectFactoryImageLayout(blob)).resolves.toBe('NEW_GRAPHENEOS_INSTALL_LAYOUT');
    await fastboot.FastbootDevice.prototype.flashFactoryZip.call(device, blob, true, async () => {
      device.reconnects.push(device);
      await device.connect();
    }, (action: string, item: string | null) => {
      progress.push(`${action}:${item}`);
    });

    expect(device.reconnects).toEqual([device]);
    expect(device.events).toContain('flash:radio');
    expect(device.events).toContain('command:erase:avb_custom_key');
    expect(device.events).toContain('flash:avb_custom_key');
    expect(device.events).toContain('flash:boot');
    expect(device.events).toContain('command:erase:userdata');
    expect(device.events).toContain('command:erase:metadata');
    expect(device.events).toContain('flash:super');
    expect(progress).toContain('reboot:bootloader');
  });

  it('accepts the layout that android-fastboot 1.1.3 rejected for absent image zip', async () => {
    installBrowserPolyfills();
    const fastboot = await import('./vendor/graphene-fastboot.mjs');
    const blob = makeNewLayoutZip();

    await expect(fastboot.detectFactoryImageLayout(blob)).resolves.toBe('NEW_GRAPHENEOS_INSTALL_LAYOUT');
  });
});
