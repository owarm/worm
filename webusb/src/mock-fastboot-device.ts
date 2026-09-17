import type { FactoryFlashCallback, FastbootCommandResponse, FastbootDeviceLike, ReconnectCallback } from './fastboot';

export const TEST_DEVICE = {
  device: 'Pixel 10',
  product: 'frankel',
  serial: 'TEST-FRANKEL-0001',
  bootloader: 'Unlocked',
  mode: 'Bootloader',
  connection: 'Connected'
} as const;

export class MockInstallerDevice implements FastbootDeviceLike {
  isConnected = false;
  device: USBDevice | null = null;
  mode: 'Bootloader' | 'Fastbootd' = 'Bootloader';
  lockCalls = 0;
  rebootCalls = 0;
  runCommandCalls = 0;
  flashFactoryZipCalls = 0;

  async connect(): Promise<void> {
    this.isConnected = true;
  }

  async getVariable(varName: string): Promise<string | undefined> {
    if (varName === 'product') return TEST_DEVICE.product;
    if (varName === 'serialno') return TEST_DEVICE.serial;
    if (varName === 'unlocked') return this.lockCalls > 0 ? 'no' : 'yes';
    if (varName === 'current-slot') return 'a';
    if (varName === 'secure') return 'yes';
    if (varName === 'snapshot-update-status') return 'none';
    if (varName === 'is-userspace') return this.mode === 'Fastbootd' ? 'yes' : 'no';
    return undefined;
  }

  async runCommand(command: string): Promise<FastbootCommandResponse> {
    this.runCommandCalls += 1;
    if (command === 'flashing lock') {
      this.lockCalls += 1;
    }
    return { text: 'OKAY', dataSize: null };
  }

  async waitForDisconnect(): Promise<void> {}

  async waitForConnect(_onReconnect?: ReconnectCallback): Promise<void> {}

  async reboot(): Promise<void> {
    this.rebootCalls += 1;
    this.isConnected = false;
  }

  async flashBlob(_partition: string, _blob: Blob, onProgress?: (progress: number) => void): Promise<void> {
    onProgress?.(1);
  }

  async flashFactoryZip(
    _blob: Blob,
    _wipe: boolean,
    _onReconnect: ReconnectCallback,
    _onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashFactoryZipCalls += 1;
    throw new Error('MockInstallerDevice.flashFactoryZip is disabled in Test Installer mode.');
  }
}
