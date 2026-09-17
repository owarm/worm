import { TEST_DEVICE, MockInstallerDevice } from './mock-fastboot-device';
import {
  addLog,
  exitTestSession,
  getState,
  setDeviceInfo,
  setDownloadProgress,
  setFlashProgress,
  setLockAcknowledged,
  setProgress,
  setRelease,
  setReleaseStorageState,
  setStatusMessage,
  setTestReconnectSequence,
  setUnlockAcknowledged,
  setVerifiedDigest,
  startTestSession,
  transitionInstallerState
} from './state';
import type { ReleaseManifest } from './types';
import { InstallerError } from './types';

export const TEST_RELEASE_MANIFEST: ReleaseManifest = {
  schema: 1,
  channel: 'test',
  device: 'frankel',
  release: {
    id: 'test-installer-image',
    file: '/test/frankel-test-installer.zip',
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    size: 400
  }
};

type Timer = ReturnType<typeof globalThis.setTimeout>;
type ReconnectStage = 0 | 1 | 2 | 3;

export class TestInstaller {
  readonly device = new MockInstallerDevice();
  private readonly timers = new Set<Timer>();
  private readonly pendingDelays = new Set<() => void>();
  private reconnectStage: ReconnectStage = 0;
  private exited = false;

  get reconnectClicks(): number {
    return this.reconnectStage;
  }

  start(): void {
    this.cancelTimers();
    this.exited = false;
    this.reconnectStage = 0;
    startTestSession();
    setRelease(TEST_RELEASE_MANIFEST);
    setReleaseStorageState({ releaseComplete: false, releaseVerified: false, releaseFileAvailable: false });
    setUnlockAcknowledged(false);
    setLockAcknowledged(false);
    addLog('INFO', 'Test mode started', { mockDevice: true }, 'DEVICE');
  }

  exit(): void {
    this.exited = true;
    this.cancelTimers();
    this.reconnectStage = 0;
    exitTestSession();
  }

  async connect(): Promise<void> {
    this.assertActiveTestMode();
    transitionInstallerState('CONNECTING', 'Connecting to mock Pixel...');
    await this.device.connect();
    setDeviceInfo({
      device: TEST_DEVICE.device,
      product: TEST_DEVICE.product,
      serial: TEST_DEVICE.serial,
      bootloader: TEST_DEVICE.bootloader
    });
    transitionInstallerState('CONNECTED', 'Pixel connected.');
    addLog('USB', 'Pixel connected', { mockDevice: true }, 'USB');
    transitionInstallerState('DEVICE_VERIFIED', 'Device verified.');
    addLog('DEVICE', 'Device verified', { product: TEST_DEVICE.product, serial: TEST_DEVICE.serial }, 'DEVICE');
    transitionInstallerState('UNLOCKED', 'Bootloader is already unlocked.');
  }

  async download(): Promise<void> {
    this.assertActiveTestMode();
    transitionInstallerState('DOWNLOADING', 'Downloading simulated image.');
    addLog('DOWNLOAD', 'Download started', undefined, 'DOWNLOAD');
    for (const percent of [0, 25, 50, 75, 100]) {
      this.assertActiveTestMode();
      setProgress(percent);
      setDownloadProgress({
        releaseId: TEST_RELEASE_MANIFEST.release.id,
        downloadedBytes: percent * 4,
        totalBytes: TEST_RELEASE_MANIFEST.release.size,
        percent,
        storedLocally: false,
        verified: false,
        status: percent === 100 ? 'Download complete' : `Download ${percent}%`
      });
      if (percent > 0 && percent < 100) {
        addLog('DOWNLOAD', `Download ${percent}%`, { percent }, 'DOWNLOAD');
      }
      if (percent === 100) {
        addLog('DOWNLOAD', 'Download complete', { percent }, 'DOWNLOAD');
      }
      if (percent < 100) {
        await this.delay(750);
      }
    }
    setReleaseStorageState({ releaseComplete: true, releaseFileAvailable: true, releaseVerified: false });
    transitionInstallerState('DOWNLOADED', 'Simulated image downloaded.');
  }

  async verify(): Promise<void> {
    this.assertActiveTestMode();
    transitionInstallerState('VERIFYING', 'Verifying image.');
    addLog('VERIFY', 'Verifying image', undefined, 'VERIFY');
    for (const percent of [50, 100]) {
      await this.delay(1_000);
      this.assertActiveTestMode();
      setProgress(percent);
      addLog('VERIFY', `${percent}%`, { percent }, 'VERIFY');
    }
    setVerifiedDigest(TEST_RELEASE_MANIFEST.release.sha256);
    setReleaseStorageState({ releaseComplete: true, releaseFileAvailable: true, releaseVerified: true });
    setDownloadProgress({
      releaseId: TEST_RELEASE_MANIFEST.release.id,
      downloadedBytes: TEST_RELEASE_MANIFEST.release.size,
      totalBytes: TEST_RELEASE_MANIFEST.release.size,
      percent: 100,
      storedLocally: false,
      verified: true,
      status: 'Image verified'
    });
    addLog('VERIFY', 'Image verified', undefined, 'VERIFY');
    transitionInstallerState('VERIFIED', 'Image verified.');
  }

  async install(): Promise<void> {
    this.assertActiveTestMode();
    transitionInstallerState('FLASHING', 'Installing simulated image.');
    addLog('FLASH', 'Installation started', undefined, 'FLASH');
    addLog('ZIP', 'Preparing installation files', undefined, 'ZIP');
    setFlashProgress({ operation: 'unpack', item: 'bootloader', itemPercent: 0, overallPercent: null, rawProgress: 0, overallIndeterminate: true });
    setStatusMessage('Preparing installation files');
    addLog('ZIP', 'Unpacking bootloader', undefined, 'ZIP');
    for (const percent of [25, 50, 75, 100]) {
      await this.delay(300);
      this.assertActiveTestMode();
      setFlashProgress({ operation: 'unpack', item: 'bootloader', itemPercent: percent, overallPercent: null, rawProgress: percent, overallIndeterminate: true });
      addLog('FLASH', `Bootloader ${percent}%`, { percent }, 'FLASH');
    }
    this.pauseForReconnect(1);
  }

  async reconnect(): Promise<void> {
    this.assertActiveTestMode();
    if (getState().installerState !== 'WAITING_FOR_RECONNECT') {
      setStatusMessage('Reconnect Pixel is disabled until the Pixel restarts.');
      return;
    }
    const nextStage = (this.reconnectStage + 1) as ReconnectStage;
    this.reconnectStage = nextStage;
    setTestReconnectSequence(nextStage);
    await this.device.connect();
    addLog('RECONNECT', 'Pixel reconnected', { reconnectSequence: nextStage }, 'RECONNECT');
    transitionInstallerState('WAITING_FOR_FLASH_RESUME', 'Device reconnected. Waiting for installation to continue...');
    if (nextStage === 1) {
      this.device.mode = 'Fastbootd';
      addLog('DEVICE', 'Mode: Fastbootd', { mockDevice: true }, 'DEVICE');
      addLog('RECONNECT', 'Installation resumed', { reconnectSequence: nextStage }, 'RECONNECT');
      transitionInstallerState('FLASHING', 'Installation resumed.');
      await this.progressItem('Flashing device', 'device', 2);
      return;
    }
    if (nextStage === 2) {
      this.device.mode = 'Bootloader';
      addLog('DEVICE', 'Mode: Bootloader', { mockDevice: true }, 'DEVICE');
      addLog('RECONNECT', 'Installation resumed', { reconnectSequence: nextStage }, 'RECONNECT');
      transitionInstallerState('FLASHING', 'Installation resumed.');
      await this.progressItem('Flashing firmware', 'firmware', 3);
      return;
    }
    addLog('RECONNECT', 'Installation resumed', { reconnectSequence: nextStage }, 'RECONNECT');
    transitionInstallerState('FLASHING', 'Installation resumed.');
    await this.delay(500);
    this.assertActiveTestMode();
    addLog('FLASH', 'Installation complete', undefined, 'FLASH');
    setProgress(100);
    transitionInstallerState('FLASH_COMPLETE', 'Installation complete.');
    transitionInstallerState('LOCK_READY', 'Ready to lock bootloader.');
  }

  async lock(): Promise<void> {
    this.assertActiveTestMode();
    if (getState().installerState !== 'LOCK_READY') {
      throw new InstallerError('Mock lock is available only after simulated installation.');
    }
    addLog('BOOTLOADER', 'Lock requested', undefined, 'BOOTLOADER');
    transitionInstallerState('LOCKING', 'Waiting for confirmation.');
    addLog('BOOTLOADER', 'Waiting for confirmation', undefined, 'BOOTLOADER');
    await this.delay(500);
    this.assertActiveTestMode();
    setDeviceInfo({ bootloader: 'Locked' });
    addLog('BOOTLOADER', 'Bootloader locked', undefined, 'BOOTLOADER');
    transitionInstallerState('LOCKED', 'Bootloader locked.');
  }

  async reboot(): Promise<void> {
    this.assertActiveTestMode();
    if (getState().installerState !== 'LOCKED') {
      throw new InstallerError('Mock reboot is available only after mock lock.');
    }
    transitionInstallerState('REBOOTING', 'Rebooting.');
    addLog('COMPLETE', 'Rebooting', undefined, 'COMPLETE');
    await this.delay(500);
    this.assertActiveTestMode();
    setProgress(100);
    addLog('COMPLETE', 'Complete', undefined, 'COMPLETE');
    transitionInstallerState('COMPLETE', 'Installation complete.');
  }

  private async progressItem(label: string, item: string, nextReconnect: 2 | 3): Promise<void> {
    for (const percent of [25, 50, 75, 100]) {
      await this.delay(400);
      this.assertActiveTestMode();
      setFlashProgress({ operation: 'flash', item, itemPercent: percent, overallPercent: null, rawProgress: percent, overallIndeterminate: true });
      addLog('FLASH', `${label} ${percent}%`, { percent }, 'FLASH');
    }
    if (item === 'firmware') {
      addLog('FLASH', 'Verified Boot key', undefined, 'FLASH');
    }
    this.pauseForReconnect(nextReconnect);
  }

  private pauseForReconnect(sequence: 1 | 2 | 3): void {
    this.assertActiveTestMode();
    setTestReconnectSequence(sequence);
    addLog('RECONNECT', 'Pixel restarted', { reconnectSequence: sequence }, 'RECONNECT');
    addLog('RECONNECT', 'Waiting for manual reconnect', { reconnectSequence: sequence }, 'RECONNECT');
    transitionInstallerState('WAITING_FOR_RECONNECT', 'Pixel restarted');
    setStatusMessage('Reconnect the device to continue installation.');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.pendingDelays.delete(done);
        resolve();
      };
      const timer = globalThis.setTimeout(() => {
        this.timers.delete(timer);
        done();
      }, ms);
      this.pendingDelays.add(done);
      this.timers.add(timer);
    });
  }

  private cancelTimers(): void {
    for (const timer of this.timers) {
      globalThis.clearTimeout(timer);
    }
    this.timers.clear();
    for (const resolve of this.pendingDelays) {
      resolve();
    }
    this.pendingDelays.clear();
  }

  private assertActiveTestMode(): void {
    if (this.exited || !getState().testMode) {
      throw new InstallerError('Test Installer is not active.');
    }
  }
}
