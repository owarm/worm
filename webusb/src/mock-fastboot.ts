import type { FactoryFlashCallback, FastbootCommandResponse, FastbootDeviceLike, ReconnectCallback } from './fastboot';

const MOCK_SERIAL = 'MOCK-FRANKEL-0001';

const delay = (): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

export class MockFastbootDevice implements FastbootDeviceLike {
  isConnected = false;
  device: USBDevice | null = { opened: true, vendorId: 0x18d1, serialNumber: MOCK_SERIAL, productName: 'Pixel' } as USBDevice;
  flashFactoryZipCalls = 0;
  connectCalls = 0;
  manualReconnectClicks = 0;
  private unlocked = 'yes';
  private userspace = 'no';
  private pendingReconnect: (() => void) | null = null;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.isConnected = true;
    if (this.pendingReconnect) {
      this.manualReconnectClicks += 1;
      const resolve = this.pendingReconnect;
      this.pendingReconnect = null;
      resolve();
    }
  }

  async getVariable(varName: string): Promise<string | null | undefined> {
    if (varName === 'product') return 'frankel';
    if (varName === 'serialno') return MOCK_SERIAL;
    if (varName === 'unlocked') return this.unlocked;
    if (varName === 'current-slot') return 'a';
    if (varName === 'secure') return 'yes';
    if (varName === 'snapshot-update-status') return 'none';
    if (varName === 'is-userspace') return this.userspace;
    if (varName === 'max-download-size') return '0x10000000';
    return undefined;
  }

  async runCommand(command: string): Promise<FastbootCommandResponse> {
    if (command === 'flashing lock') {
      this.unlocked = 'no';
      return { text: 'OKAY', dataSize: null };
    }
    return { text: 'OKAY', dataSize: null };
  }

  async waitForDisconnect(): Promise<void> {}

  async waitForConnect(onReconnect?: ReconnectCallback): Promise<void> {
    await onReconnect?.();
    await this.waitForManualReconnect();
  }

  async reboot(_target?: string, _wait?: boolean, _onReconnect?: ReconnectCallback): Promise<void> {
    this.isConnected = false;
    if (_wait && _onReconnect) {
      await this.rebootAndWait(_onReconnect, _target === 'fastboot' ? 'yes' : 'no');
    }
  }

  async flashBlob(_partition: string, _blob: Blob, onProgress?: (progress: number) => void): Promise<void> {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      onProgress?.(progress);
      await delay();
    }
  }

  async flashFactoryZip(
    _blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashFactoryZipCalls += 1;

    await this.emit(onProgress, 'load', 'package');
    await this.emit(onProgress, 'unpack', 'bootloader');
    await this.emit(onProgress, 'flash', 'bootloader');

    await this.rebootAndWait(onReconnect, 'yes');

    await this.emit(onProgress, 'flash', 'radio', [25, 50, 75, 100]);

    await this.rebootAndWait(onReconnect, 'no');

    await this.emit(onProgress, 'unpack', 'image-frankel');
    await this.emit(onProgress, 'flash', 'device');

    await this.rebootAndWait(onReconnect, 'no');

    onProgress?.('flash', 'avb_custom_key', 1);
    await delay();
  }

  private async emit(onProgress: FactoryFlashCallback | undefined, action: string, item: string, steps = [0, 25, 50, 75, 100]): Promise<void> {
    for (const progress of steps) {
      onProgress?.(action, item, progress);
      await delay();
    }
  }

  private async rebootAndWait(onReconnect: ReconnectCallback, nextUserspace: 'yes' | 'no'): Promise<void> {
    this.isConnected = false;
    this.userspace = nextUserspace;
    await onReconnect();
    await this.waitForManualReconnect();
  }

  private async waitForManualReconnect(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.pendingReconnect = resolve;
    });
  }
}

export const createMockFastbootDevice = async (): Promise<MockFastbootDevice> => new MockFastbootDevice();
