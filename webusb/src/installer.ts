import { BlobStore } from './blob-store';
import { DEVICE_TARGET } from './config';
import { assertSha256Matches } from './crypto';
import {
  createFastbootDevice,
  inspectAndroidFastboot,
  normalizeUnlockedState,
  ZIP_INFLATE_WORKER_URL,
  ZIP_INFLATE_WORKER_SCRIPTS,
  ZIP_PAKO_INFLATE_URL,
  type FactoryFlashCallback,
  type FastbootDeviceLike,
  type ReconnectCallback
} from './fastboot';
import { maskSerial, collectBrowserCapabilities, setBrowserCapabilities } from './logger';
import { downloadRelease, fetchReleaseManifest, inspectStoredRelease, MANIFEST_URL, metadataFromManifest, releaseKey } from './release';
import {
  addLog,
  enterErrorState,
  getPersistedMetadata,
  getState,
  setCacheKey,
  setDeviceInfo,
  setDownloadProgress,
  setErrorMessage,
  setFastbootInspection,
  setFlashProgress,
  setLockAcknowledged,
  setProgress,
  setRelease,
  setReleaseStorageState,
  setStatusMessage,
  setUnlockAcknowledged,
  setVerifiedDigest,
  returnToIdle,
  transitionInstallerState,
  updatePersistedMetadata,
  restoreLogsForCurrentSession
} from './state';
import {
  InstallerError,
  ReconnectTimeoutError,
  ReleaseVerificationError,
  WebUsbUnavailableError,
  WrongDeviceError,
  type ReleaseManifest
} from './types';

type WakeLockSentinelLike = {
  release(): Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
};

type InstallerDependencies = {
  createDevice?: () => Promise<FastbootDeviceLike>;
  store?: BlobStore;
};

type FlashPrerequisites = {
  deviceConnected: boolean;
  productVerified: boolean;
  serialVerified: boolean;
  bootloaderUnlocked: boolean;
  releaseComplete: boolean;
  releaseVerified: boolean;
  releaseFileAvailable: boolean;
  installerState: string;
};

const optionalGetvars = ['current-slot', 'secure', 'snapshot-update-status', 'slot-count', 'is-userspace'] as const;

type FlashActivitySnapshot = {
  lastProgressAt: number | null;
  lastFastbootActivityAt: number | null;
  lastUsbActivityAt: number | null;
  lastAction: string | null;
  lastItem: string | null;
  lastProgress: number | null;
};

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
  storage?: {
    estimate?: () => Promise<StorageEstimate>;
  };
};

type ZipWorkerCheck = {
  label: string;
  url: string;
  reachable: boolean;
  status: number | null;
  error?: string;
};

type ZipWorkerFailureSnapshot = {
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  reason?: string;
  timestamp: string;
};

type ReconnectManagerOptions = {
  onExpectedDisconnect?: (device: USBDevice) => void;
};

let lastZipWorkerFailure: ZipWorkerFailureSnapshot | null = null;
let zipWorkerDiagnosticsInstalled = false;

const isZipWorkerUrl = (url: string | undefined): boolean => Boolean(url && ZIP_INFLATE_WORKER_SCRIPTS.some((script) => url?.includes(script)));

export const getLastZipWorkerFailure = (): ZipWorkerFailureSnapshot | null => lastZipWorkerFailure;

export const clearZipWorkerFailure = (): void => {
  lastZipWorkerFailure = null;
};

export const recordZipWorkerFailure = (failure: ZipWorkerFailureSnapshot): void => {
  lastZipWorkerFailure = failure;
};

export const installZipWorkerErrorDiagnostics = (): void => {
  if (zipWorkerDiagnosticsInstalled || typeof window === 'undefined') {
    return;
  }
  zipWorkerDiagnosticsInstalled = true;
  window.addEventListener('error', (event) => {
    if (!isZipWorkerUrl(event.filename)) {
      return;
    }
    const failure = {
      message: event.message || 'ZIP worker error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      timestamp: new Date().toISOString()
    };
    recordZipWorkerFailure(failure);
    addLog('ERROR', 'Worker error', failure, 'ZIP');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = userMessageForError(event.reason);
    if (!reason.toLowerCase().includes('zip') && !reason.toLowerCase().includes('worker') && !reason.toLowerCase().includes('inflate')) {
      return;
    }
    const failure = {
      message: `ZIP worker rejection: ${reason}`,
      reason,
      timestamp: new Date().toISOString()
    };
    recordZipWorkerFailure(failure);
    addLog('ERROR', 'Worker error', failure, 'ZIP');
  });
};

export class FlashActivityWatchdog {
  private readonly interval: ReturnType<typeof globalThis.setInterval>;
  private warned60s = false;
  private readonly activity: FlashActivitySnapshot = {
    lastProgressAt: null,
    lastFastbootActivityAt: null,
    lastUsbActivityAt: null,
    lastAction: null,
    lastItem: null,
    lastProgress: null
  };

  constructor(
    private readonly warn: (message: string, details?: unknown) => void,
    private readonly setWaitingMessage: (message: string) => void,
    private readonly now: () => number = () => Date.now(),
    intervalMs = 1_000
  ) {
    this.interval = globalThis.setInterval(() => this.check(), intervalMs);
  }

  markProgress(action: string | null, item: string | null, progress: number | null): void {
    this.activity.lastProgressAt = this.now();
    this.activity.lastAction = action;
    this.activity.lastItem = item;
    this.activity.lastProgress = progress;
    this.warned60s = false;
  }

  markFastbootActivity(): void {
    this.activity.lastFastbootActivityAt = this.now();
  }

  markUsbActivity(): void {
    this.activity.lastUsbActivityAt = this.now();
  }

  snapshot(): FlashActivitySnapshot {
    return { ...this.activity };
  }

  dispose(): void {
    globalThis.clearInterval(this.interval);
  }

  private check(): void {
    const lastActivityAt = Math.max(
      this.activity.lastProgressAt ?? 0,
      this.activity.lastFastbootActivityAt ?? 0,
      this.activity.lastUsbActivityAt ?? 0
    );
    if (lastActivityAt === 0) {
      return;
    }
    const idleMs = this.now() - lastActivityAt;
    if (idleMs >= 60_000 && !this.warned60s) {
      this.warned60s = true;
      this.warn('[WARN] Installation is still processing', { ...this.activity, idleMs });
      this.setWaitingMessage('Installation is still processing.');
    }
  }
}

export class ZipUnpackWatchdog {
  private readonly interval: ReturnType<typeof globalThis.setInterval>;
  private lastActivityAt: number | null = null;
  private lastAction: string | null = null;
  private lastItem: string | null = null;
  private lastProgress: number | null = null;
  private warned60s = false;

  constructor(
    private readonly warn: (message: string, details?: unknown) => void,
    private readonly setWaitingMessage: (message: string) => void,
    private readonly now: () => number = () => Date.now(),
    intervalMs = 1_000
  ) {
    this.interval = globalThis.setInterval(() => this.check(), intervalMs);
  }

  markActivity(action: string | null, item: string | null, progress: number | null): void {
    this.lastActivityAt = this.now();
    this.lastAction = action;
    this.lastItem = item;
    this.lastProgress = progress;
    this.warned60s = false;
  }

  dispose(): void {
    globalThis.clearInterval(this.interval);
  }

  private snapshot(idleMs: number): Record<string, unknown> {
    const nav = typeof navigator === 'undefined' ? null : (navigator as NavigatorWithMemory);
    return {
      idleMs,
      lastAction: this.lastAction,
      lastItem: this.lastItem,
      lastProgress: this.lastProgress,
      lastActivity: this.lastActivityAt ? new Date(this.lastActivityAt).toISOString() : null,
      workerFailure: getLastZipWorkerFailure(),
      visibilityState: typeof document === 'undefined' ? null : document.visibilityState,
      deviceMemory: nav?.deviceMemory ?? null,
      hardwareConcurrency: nav?.hardwareConcurrency ?? null
    };
  }

  private check(): void {
    if (!this.lastActivityAt) {
      return;
    }
    if (!((this.lastAction === 'load' && this.lastItem === 'package') || this.lastAction === 'load package' || this.lastAction === 'unpack')) {
      return;
    }
    const idleMs = this.now() - this.lastActivityAt;
    if (idleMs >= 60_000 && !this.warned60s) {
      this.warned60s = true;
      this.warn('[WARN] Installation files are still preparing', this.snapshot(idleMs));
      this.setWaitingMessage('Preparing installation files. This can take some time on mobile devices.');
    }
  }
}

const usbDiagnostics = (device: USBDevice): { vendorId: number | null; productId: number | null; serial: string } => {
  const details = device as USBDevice & { productId?: number };
  return { vendorId: device.vendorId ?? null, productId: details.productId ?? null, serial: maskSerial(device.serialNumber) };
};

const USB_LOG_PATCHED = Symbol('wormUsbLoggingPatched');

type UsbDeviceWithTransfers = USBDevice & {
  [USB_LOG_PATCHED]?: boolean;
  transferIn?: (endpointNumber: number, length: number) => Promise<unknown>;
  transferOut?: (endpointNumber: number, data: BufferSource) => Promise<unknown>;
};

const isActiveOperation = (): boolean =>
  ['DOWNLOADING', 'VERIFYING', 'FLASHING', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'UNLOCKING', 'WAITING_USER_UNLOCK', 'LOCKING', 'WAITING_USER_LOCK', 'REBOOTING'].includes(
    getState().installerState
  );

const userMessageForError = (error: unknown): string => {
  if (error instanceof InstallerError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isDeviceSelectionCancelled = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotFoundError';

const requireWebUsb = (): USB => {
  if (!('usb' in navigator)) {
    throw new WebUsbUnavailableError();
  }
  return navigator.usb;
};

const isKnownSerial = (serial: string | null | undefined): serial is string => Boolean(serial && serial !== 'Unavailable');

const serialMatches = (actual: string | null | undefined, expected: string | null | undefined): boolean => {
  if (!expected || expected === 'Unavailable') {
    return true;
  }
  if (!actual || actual === 'Unavailable') {
    return true;
  }
  return actual === expected;
};

const isUnlockedDeviceInfo = (bootloader: string): boolean => bootloader.trim().toLowerCase() === 'unlocked';

const reconnectSerialMatches = (actual: string | null | undefined, expected: string | null | undefined): boolean => {
  if (!isKnownSerial(expected)) {
    return true;
  }
  return actual === expected;
};

export class WakeLockManager {
  private sentinel: WakeLockSentinelLike | null = null;
  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && isActiveOperation()) {
      void this.acquire();
    }
  };

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  async acquire(): Promise<void> {
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) {
      return;
    }
    try {
      this.sentinel = await nav.wakeLock.request('screen');
      addLog('DEBUG', 'WakeLock acquired', undefined, 'BROWSER');
    } catch {
      this.sentinel = null;
      addLog('WARN', 'WakeLock acquire failed', undefined, 'BROWSER');
    }
  }

  async release(): Promise<void> {
    const current = this.sentinel;
    this.sentinel = null;
    if (current) {
      await current.release();
      addLog('DEBUG', 'WakeLock released', undefined, 'BROWSER');
    }
  }

  dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    void this.release();
  }
}

export class ReconnectManager {
  private disposed = false;
  private readonly timers = new Set<ReturnType<typeof globalThis.setTimeout>>();
  private lastConnectedDevice: USBDevice | null = null;
  private readonly onConnect = (event: USBConnectionEvent): void => {
    this.lastConnectedDevice = event.device;
    addLog('USB', 'Pixel connected', usbDiagnostics(event.device), 'USB');
  };
  private readonly onDisconnect = (event: USBConnectionEvent): void => {
    if (event.device.vendorId === DEVICE_TARGET.usbVendorId) {
      addLog('USB', 'Pixel disconnected', usbDiagnostics(event.device), 'USB');
      this.options.onExpectedDisconnect?.(event.device);
    }
  };

  constructor(private readonly usb: USB, private readonly options: ReconnectManagerOptions = {}) {
    this.usb.addEventListener('connect', this.onConnect);
    this.usb.addEventListener('disconnect', this.onDisconnect);
  }

  dispose(): void {
    this.disposed = true;
    this.usb.removeEventListener('connect', this.onConnect);
    this.usb.removeEventListener('disconnect', this.onDisconnect);
    for (const timer of this.timers) {
      globalThis.clearTimeout(timer);
    }
    this.timers.clear();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = globalThis.setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  private isExpectedGoogleDevice(device: USBDevice, expectedSerial: string | null | undefined): boolean {
    return device.vendorId === DEVICE_TARGET.usbVendorId && reconnectSerialMatches(device.serialNumber, expectedSerial);
  }

  async waitForExpectedDevice(expectedSerial: string | null | undefined, timeoutMs = 90_000): Promise<USBDevice> {
    transitionInstallerState('RECONNECTING', 'Waiting for Pixel...');

    const deadline = Date.now() + timeoutMs;
    while (!this.disposed && Date.now() < deadline) {
      if (this.lastConnectedDevice && this.isExpectedGoogleDevice(this.lastConnectedDevice, expectedSerial)) {
        return this.lastConnectedDevice;
      }
      const devices = await this.usb.getDevices();
      const match = devices.find((device) => this.isExpectedGoogleDevice(device, expectedSerial));
      if (match) {
        return match;
      }
      await this.delay(500);
    }

    if (this.disposed) {
      throw new ReconnectTimeoutError('Reconnect wait was cancelled.');
    }

    throw new ReconnectTimeoutError();
  }

  async requestExpectedDevice(expectedSerial: string | null | undefined): Promise<USBDevice> {
    const device = await this.usb.requestDevice({ filters: [{ vendorId: DEVICE_TARGET.usbVendorId }] });
    if (!this.isExpectedGoogleDevice(device, expectedSerial)) {
      addLog('WARN', 'Different Pixel detected', { serial: maskSerial(device.serialNumber) }, 'RECONNECT');
      throw new WrongDeviceError('Different Pixel detected. Reconnect the original device.');
    }
    addLog('USB', 'Pixel connected', usbDiagnostics(device), 'USB');
    return device;
  }
}

export class Installer {
  private device: FastbootDeviceLike | null = null;
  private releaseBlob: Blob | null = null;
  private manifest: ReleaseManifest | null = null;
  private verifiedSha256: string | null = null;
  private readonly store: BlobStore;
  private readonly wakeLock = new WakeLockManager();
  private downloadAbortController: AbortController | null = null;
  private destructiveOperation = false;
  private reconnectManager: ReconnectManager | null = null;
  private readonly reconnectLogMessages = new Set<string>();
  private flashWatchdog: FlashActivityWatchdog | null = null;
  private zipWatchdog: ZipUnpackWatchdog | null = null;
  private flashReconnectActive = false;
  private flashReconnectReminder: ReturnType<typeof globalThis.setTimeout> | null = null;
  private readonly onBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
    if (!this.downloadAbortController) {
      return undefined;
    }
    event.preventDefault();
    event.returnValue = 'A Worm OS release download is still in progress.';
    return event.returnValue;
  };

  constructor(private readonly dependencies: InstallerDependencies = {}) {
    this.store = dependencies.store ?? new BlobStore();
  }

  async init(): Promise<void> {
    await restoreLogsForCurrentSession();
    const capabilities = await collectBrowserCapabilities(MANIFEST_URL);
    setBrowserCapabilities(capabilities);
    await this.store.init();
    setFastbootInspection(await inspectAndroidFastboot());
    installZipWorkerErrorDiagnostics();
    await this.restoreStoredReleaseState();
  }

  async connect(manual = true): Promise<void> {
    try {
      transitionInstallerState(getState().installerState === 'ERROR' ? 'CONNECTING' : 'CONNECTING', 'Connecting to Pixel...');
      const usb = requireWebUsb();
      if (manual) {
        addLog('USB', 'Pixel connected', undefined, 'USB');
      }
      this.device = await this.createLoggedDevice();
      await this.device.connect();
      transitionInstallerState('CONNECTED', 'Pixel connected.');
      addLog('USB', 'Pixel connected', undefined, 'USB');
      await this.verifyConnectedDevice();
    } catch (error) {
      this.fail(error);
    }
  }

  async verifyConnectedDevice(): Promise<void> {
    const device = this.requireDevice();
    const product = await device.getVariable('product');
    const serial = await device.getVariable('serialno');
    const unlocked = await device.getVariable('unlocked');
    for (const name of optionalGetvars) {
      await device.getVariable(name).catch(() => undefined);
    }

    if (product !== DEVICE_TARGET.codename) {
      throw new WrongDeviceError(`Connected device product is ${product ?? 'unknown'}, expected ${DEVICE_TARGET.codename}.`);
    }

    const expectedSerial = getPersistedMetadata().expectedSerial;
    if (!serialMatches(serial, expectedSerial)) {
      throw new WrongDeviceError();
    }

    const bootloaderState = normalizeUnlockedState(unlocked);
    setDeviceInfo({
      device: DEVICE_TARGET.name,
      product,
      serial: serial ?? 'Unavailable',
      bootloader: bootloaderState === 'yes' ? 'Unlocked' : bootloaderState === 'no' ? 'Locked' : 'Unknown'
    });
    updatePersistedMetadata({ expectedProduct: product, expectedSerial: serial ?? expectedSerial });
    transitionInstallerState('DEVICE_VERIFIED', 'Pixel product and serial verified.');
    addLog('DEVICE', `Pixel verified: ${product}`, { product, serial: maskSerial(serial) }, 'DEVICE');
    addLog('DEVICE', `Bootloader ${bootloaderState === 'yes' ? 'unlocked' : bootloaderState === 'no' ? 'locked' : 'unknown'}`, { unlocked: bootloaderState }, 'DEVICE');

    if (bootloaderState === 'yes') {
      if (this.isRuntimeReleaseVerified()) {
        transitionInstallerState('VERIFIED', 'Release verified. Pixel reconnected and ready to flash.');
        void this.refreshFlashReadiness();
      } else {
        transitionInstallerState('UNLOCKED', 'Bootloader is already unlocked.');
      }
    } else {
      transitionInstallerState('UNLOCK_REQUIRED', 'Bootloader unlock is required.');
    }
  }

  acknowledgeUnlock(checked: boolean): void {
    setUnlockAcknowledged(checked);
  }

  acknowledgeLock(checked: boolean): void {
    setLockAcknowledged(checked);
  }

  async unlockBootloader(): Promise<void> {
    try {
      addLog('BOOTLOADER', 'Unlock requested', undefined, 'BOOTLOADER');
      if (!getState().unlockAcknowledged) {
        addLog('WARN', 'Unlock cancelled: acknowledgement missing');
        throw new InstallerError('Confirm the bootloader unlock data wipe warning before continuing.');
      }
      const device = this.requireDevice();
      const unlocked = await device.getVariable('unlocked');
      if (normalizeUnlockedState(unlocked) === 'yes') {
        transitionInstallerState('UNLOCKED', 'Bootloader is already unlocked.');
        return;
      }

      this.destructiveOperation = true;
      transitionInstallerState('UNLOCKING', 'Starting bootloader unlock.');
      await device.runCommand('flashing unlock');
      addLog('WARN', 'Waiting for physical confirmation');
      transitionInstallerState('WAITING_USER_UNLOCK', 'Confirm bootloader unlock on the Pixel using the physical buttons.');

      await this.reconnectAfterUnlock();
    } catch (error) {
      this.fail(error);
    } finally {
      this.destructiveOperation = false;
    }
  }

  async reconnectAfterUnlock(): Promise<void> {
    const usb = requireWebUsb();
    const manager = this.createReconnectManager(usb);
    await manager.waitForExpectedDevice(getPersistedMetadata().expectedSerial);
    this.device = await this.createLoggedDevice();
    await this.device.connect();
    const product = await this.device.getVariable('product');
    const serial = await this.device.getVariable('serialno');
    const unlocked = await this.device.getVariable('unlocked');
    if (product !== DEVICE_TARGET.codename || !reconnectSerialMatches(serial, getPersistedMetadata().expectedSerial)) {
      throw new WrongDeviceError();
    }
    if (normalizeUnlockedState(unlocked) !== 'yes') {
      throw new InstallerError('Bootloader unlock was not confirmed on the Pixel. Stopping.');
    }
    setDeviceInfo({ product, serial: serial ?? 'Unavailable', bootloader: 'Unlocked' });
    transitionInstallerState('UNLOCKED', 'Bootloader unlock verified.');
    addLog('BOOTLOADER', 'Unlock complete', { product, serial: maskSerial(serial), unlocked }, 'BOOTLOADER');
  }

  async downloadWormOs(): Promise<void> {
    try {
      await this.wakeLock.acquire();
      const manifest = await fetchReleaseManifest(addLog);
      this.manifest = manifest;
      setRelease(manifest);
      const key = releaseKey(manifest);
      setCacheKey(key);

      const cached = await inspectStoredRelease(manifest, this.store, (progress) => {
        setDownloadProgress(progress);
        setProgress(progress.percent ?? 0);
      }, addLog);
      setReleaseStorageState({ releaseComplete: cached.complete, releaseVerified: cached.verified, releaseFileAvailable: Boolean(cached.file) });
      if (cached.file && cached.complete && cached.verified) {
        this.releaseBlob = null;
        this.verifiedSha256 = manifest.release.sha256;
        setVerifiedDigest(manifest.release.sha256);
        transitionInstallerState('VERIFIED', 'Downloaded release found in persistent storage.');
        await this.refreshFlashReadiness();
        return;
      }
      if (cached.file && cached.complete) {
        this.releaseBlob = cached.file;
        transitionInstallerState('DOWNLOADED', 'Release already downloaded.');
        return;
      }

      transitionInstallerState('DOWNLOADING', `Downloading ${manifest.release.id}.`);
      this.downloadAbortController = new AbortController();
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this.onBeforeUnload);
      }
      const blob = await downloadRelease(manifest, this.store, this.downloadAbortController.signal, (progress) => {
        setDownloadProgress(progress);
        setProgress(progress.percent ?? 0);
      }, addLog);
      this.releaseBlob = blob;
      setReleaseStorageState({ releaseComplete: true, releaseVerified: false, releaseFileAvailable: true });
      transitionInstallerState('DOWNLOADED', `Release ${manifest.release.id} downloaded.`);
    } catch (error) {
      this.fail(error);
    } finally {
      this.downloadAbortController = null;
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
      }
      await this.wakeLock.release();
    }
  }

  abortDownload(): void {
    this.downloadAbortController?.abort();
  }

  async verifyRelease(): Promise<void> {
    try {
      await this.wakeLock.acquire();
      const manifest = this.requireManifest();
      const blob = this.requireReleaseBlob();
      transitionInstallerState('VERIFYING', 'Verifying release SHA-256.');
      if (manifest.release.size !== 0 && blob.size !== manifest.release.size) {
        throw new ReleaseVerificationError('Release size does not match the manifest.');
      }
      addLog('VERIFY', 'Image verification started', { bytes: blob.size }, 'VERIFY');
      const startedAt = performance.now();
      const loggedMilestones = new Set<number>();
      const digest = await assertSha256Matches(blob, manifest.release.sha256, (bytesVerified, percent) => {
        for (const milestone of [50, 100]) {
          if (percent >= milestone && !loggedMilestones.has(milestone)) {
            loggedMilestones.add(milestone);
            addLog('VERIFY', `${milestone}%`, { bytesVerified, percent: milestone }, 'VERIFY');
          }
        }
      });
      this.verifiedSha256 = digest;
      setVerifiedDigest(digest);
      const key = releaseKey(manifest);
      await this.store.saveMetadata(key, metadataFromManifest(manifest, blob.size, true, true));
      setDownloadProgress({
        releaseId: manifest.release.id,
        downloadedBytes: blob.size,
        totalBytes: manifest.release.size,
        percent: 100,
        storedLocally: true,
        verified: true,
        status: 'Release SHA-256 verified.'
      });
      setReleaseStorageState({ releaseComplete: true, releaseVerified: true, releaseFileAvailable: true });
      this.releaseBlob = null;
      addLog('VERIFY', 'Image verified', { durationMs: Math.round(performance.now() - startedAt) }, 'VERIFY');
      transitionInstallerState('VERIFIED', 'Release SHA-256 verified.');
      await this.refreshFlashReadiness();
    } catch (error) {
      if (error instanceof ReleaseVerificationError && this.manifest) {
        addLog('ERROR', 'Verification failed', { message: error.message }, 'VERIFY');
        const metadata = await this.store.getMetadata(releaseKey(this.manifest));
        if (metadata) {
          await this.store.saveMetadata(releaseKey(this.manifest), { ...metadata, verified: false, updatedAt: new Date().toISOString() });
        }
      }
      setVerifiedDigest(null);
      setReleaseStorageState({ releaseVerified: false });
      this.verifiedSha256 = null;
      this.fail(error instanceof ReleaseVerificationError ? new ReleaseVerificationError() : error);
    } finally {
      await this.wakeLock.release();
    }
  }

  async flashWormOs(): Promise<void> {
    let flashFactoryZipStarted = false;
    try {
      await this.wakeLock.acquire();
      addLog('FLASH', 'Installation started', undefined, 'FLASH');
      this.reconnectLogMessages.clear();
      if (this.destructiveOperation) {
        throw new InstallerError('Another destructive operation is already in progress.');
      }
      this.destructiveOperation = true;
      if (!this.device) {
        throw new InstallerError('Pixel disconnected');
      }
      const device = this.requireDevice();
      const manifest = this.requireManifest();
      await this.assertFlashPreconditions(device);
      const blob = await this.reopenVerifiedReleaseFile(manifest);
      await this.assertNoActiveSnapshotUpdate(device);
      await this.assertZipWorkerAssetsReachable();

      transitionInstallerState('FLASHING', 'Flashing Worm OS factory ZIP.');
      await this.logFactoryZipPreflight(device, manifest, blob);
      addLog('ZIP', 'Preparing installation files', undefined, 'ZIP');
      setProgress(0);
      const flashStartedAt = performance.now();
      const lastFlashProgress = new Map<string, number>();
      this.startFlashWatchdog();
      this.startZipWatchdog();
      let zipOpenedLogged = false;
      try {
        const flashFactoryZipPromise = device.flashFactoryZip(
          blob,
          true,
          () => {
            this.beginFlashReconnect();
          },
          (action, item, progress) => {
            if (this.flashReconnectActive) {
              this.flashReconnectActive = false;
              this.clearFlashReconnectReminder();
              transitionInstallerState('FLASHING', 'Installation resumed');
              this.logReconnectOnce('Installation resumed');
            }
            this.startFlashWatchdog();
            this.startZipWatchdog();
            this.flashWatchdog?.markProgress(action, item, progress);
            this.zipWatchdog?.markActivity(action, item, progress);
            if (!zipOpenedLogged && action === 'load' && item === 'package') {
              zipOpenedLogged = true;
              addLog('ZIP', 'Preparing installation files', undefined, 'ZIP');
            }
            const itemPercent = this.normalizeFactoryProgress(progress);
            setFlashProgress({ operation: action, item, itemPercent, overallPercent: null, rawProgress: progress, overallIndeterminate: true });
            if (action === 'unpack') {
              setStatusMessage('Preparing installation files...');
            } else {
              setStatusMessage(this.userVisibleFactoryStatus(action, item));
            }
            const key = `${action}:${item ?? ''}`;
            const bucket = Math.min(100, Math.floor(itemPercent / 25) * 25);
            const lastBucket = lastFlashProgress.get(key);
            if (item === 'avb_custom_key') {
              addLog('FLASH', 'Verified Boot key', undefined, 'FLASH');
            }
            if (action === 'unpack') {
              if (lastBucket === undefined) {
                addLog('ZIP', `Preparing ${item ?? 'item'}`, { item }, 'ZIP');
              }
              if (lastBucket === undefined || bucket > lastBucket || itemPercent === 100) {
                lastFlashProgress.set(key, bucket);
              }
            } else {
              if (lastBucket === undefined || bucket > lastBucket || itemPercent === 100) {
                lastFlashProgress.set(key, bucket);
                addLog('FLASH', `Flashing ${item ?? 'item'} ${bucket}%`, { action, item, percent: bucket }, 'FLASH');
              }
            }
          }
        );
        flashFactoryZipStarted = true;
        await flashFactoryZipPromise;
      } finally {
        this.stopWatchdogs();
      }

      setProgress(100);
      addLog('FLASH', 'Installation complete', { durationMs: Math.round(performance.now() - flashStartedAt) }, 'FLASH');
      transitionInstallerState('FLASH_COMPLETE', 'Factory ZIP flash completed.');
      await this.verifyAfterFlash();
    } catch (error) {
      const originalMessage = userMessageForError(error);
      const maskFlashError = flashFactoryZipStarted && originalMessage !== 'ZIP decompression worker stopped responding.';
      const message = maskFlashError ? 'Installation stopped.' : originalMessage;
      if (message !== originalMessage) {
        addLog('ERROR', originalMessage, undefined, 'FLASH');
      }
      if (flashFactoryZipStarted) {
        this.clearPendingFlashReconnect();
      }
      this.fail(maskFlashError ? new InstallerError(message) : error);
    } finally {
      this.endFlashReconnect();
      this.stopWatchdogs();
      this.destructiveOperation = false;
      await this.wakeLock.release();
    }
  }

  async reconnectManual(): Promise<void> {
    if (this.flashReconnectActive) {
      try {
        await this.manualReconnectDuringFlash();
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    try {
      transitionInstallerState('CONNECTING', 'Reconnecting Pixel...');
      const manager = this.createReconnectManager(requireWebUsb());
      await manager.requestExpectedDevice(getPersistedMetadata().expectedSerial);
      this.device = await this.createLoggedDevice();
      await this.device.connect();
      transitionInstallerState('CONNECTED', 'Pixel connected.');
      await this.verifyConnectedDevice();
    } catch (error) {
      this.fail(error);
    }
  }

  async clearDownloadedRelease(): Promise<void> {
    if (this.destructiveOperation || ['FLASHING', 'WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT'].includes(getState().installerState)) {
      setStatusMessage('Installation is active. Clear Release is disabled.');
      addLog('WARN', 'Clear Release blocked during active installation', undefined, 'DOWNLOAD');
      return;
    }
    await this.store.clear();
    this.releaseBlob = null;
    this.verifiedSha256 = null;
    setVerifiedDigest(null);
    setCacheKey(null);
    setReleaseStorageState({ releaseComplete: false, releaseVerified: false, releaseFileAvailable: false });
    setDownloadProgress(null);
    setProgress(0);
    setStatusMessage('Downloaded release cache cleared.');
    addLog('DOWNLOAD', 'Cache cleared', undefined, 'DOWNLOAD');
  }

  async lockBootloader(): Promise<void> {
    try {
      addLog('BOOTLOADER', 'Lock requested', undefined, 'BOOTLOADER');
      if (!this.canLockBootloader()) {
        throw new InstallerError('Bootloader lock is available only after a complete verified Worm OS installation.');
      }
      if (!getState().lockAcknowledged) {
        addLog('WARN', 'Lock cancelled: acknowledgement missing');
        throw new InstallerError('Confirm the bootloader lock data wipe warning before continuing.');
      }
      this.destructiveOperation = true;
      await this.wakeLock.acquire();
      const device = this.requireDevice();
      await this.assertLockPreconditions(device);

      transitionInstallerState('LOCKING', 'Starting bootloader lock.');
      await device.runCommand('flashing lock');
      addLog('WARN', 'Waiting physical confirmation');
      transitionInstallerState('WAITING_USER_LOCK', 'Confirm bootloader lock on the Pixel using the physical buttons.');
      await this.reconnectAfterLock();
    } catch (error) {
      this.fail(error);
    } finally {
      this.destructiveOperation = false;
      await this.wakeLock.release();
    }
  }

  async rebootPixel(): Promise<void> {
    try {
      if (getState().installerState !== 'LOCKED') {
        throw new InstallerError('Final reboot is available only after bootloader lock handling has completed safely.');
      }
      this.disposeReconnectManager();
      await this.wakeLock.acquire();
      const device = this.requireDevice();
      transitionInstallerState('REBOOTING', 'Rebooting Pixel.');
      await device.reboot();
      this.disposeReconnectManager();
      setProgress(100);
      transitionInstallerState('COMPLETE', 'Worm OS installation complete.');
      addLog('COMPLETE', 'Worm OS installation complete', {
        session: getState().sessionId,
        release: getState().release?.release.id,
        device: getState().deviceInfo.product
      }, 'COMPLETE');
    } catch (error) {
      this.fail(error);
    } finally {
      this.disposeReconnectManager();
      await this.wakeLock.release();
      this.wakeLock.dispose();
    }
  }

  canLockBootloader(): boolean {
    const state = getState();
    const expectedSerial = getPersistedMetadata().expectedSerial;
    return (
      state.installerState === 'LOCK_READY' &&
      state.deviceInfo.product === DEVICE_TARGET.codename &&
      reconnectSerialMatches(state.deviceInfo.serial, expectedSerial) &&
      Boolean(state.release) &&
      Boolean(state.verifiedDigest) &&
      state.verifiedDigest === state.release?.release.sha256 &&
      !this.destructiveOperation
    );
  }

  private isRuntimeReleaseVerified(): boolean {
    const state = getState();
    return Boolean(
      state.release &&
        state.releaseComplete &&
        state.releaseVerified &&
        state.releaseFileAvailable &&
        state.verifiedDigest === state.release.release.sha256
    );
  }

  private async refreshFlashReadiness(): Promise<FlashPrerequisites> {
    const prerequisites = await this.getFlashPrerequisites();
    this.logFlashPrerequisites(prerequisites);
    const missing = this.describeMissingFlashPrerequisites(prerequisites);
    for (const reason of missing) {
      addLog('FLASH', `Flash blocked: ${reason}`, undefined, 'FLASH');
    }
    if (prerequisites.releaseVerified && !prerequisites.deviceConnected) {
      setStatusMessage('Release verified. Reconnect Pixel to continue.');
    }
    return prerequisites;
  }

  private async getFlashPrerequisites(): Promise<FlashPrerequisites> {
    const state = getState();
    const manifest = state.release ?? this.manifest;
    const expectedSerial = getPersistedMetadata().expectedSerial;
    const metadata = manifest ? await this.store.getMetadata(releaseKey(manifest)) : null;
    const file = manifest ? await this.store.getReleaseFile(manifest) : null;
    const releaseComplete = Boolean(
      manifest &&
        metadata &&
        metadata.complete &&
        metadata.downloadedBytes === manifest.release.size &&
        metadata.expectedSha256 === manifest.release.sha256 &&
        metadata.expectedSize === manifest.release.size &&
        file?.size === manifest.release.size
    );
    const releaseVerified = Boolean(
      releaseComplete &&
        metadata?.verified &&
        this.verifiedSha256 === manifest?.release.sha256 &&
        state.verifiedDigest === manifest?.release.sha256
    );
    const releaseFileAvailable = Boolean(file);
    setReleaseStorageState({ releaseComplete, releaseVerified, releaseFileAvailable });

    return {
      deviceConnected: Boolean(this.device && state.deviceInfo.serial !== 'Not connected'),
      productVerified: state.deviceInfo.product === DEVICE_TARGET.codename,
      serialVerified: reconnectSerialMatches(state.deviceInfo.serial, expectedSerial),
      bootloaderUnlocked: isUnlockedDeviceInfo(state.deviceInfo.bootloader),
      releaseComplete,
      releaseVerified,
      releaseFileAvailable,
      installerState: state.installerState
    };
  }

  private logFlashPrerequisites(prerequisites: FlashPrerequisites): void {
    addLog(
      'FLASH',
      `[FLASH] prerequisites:
connected=${prerequisites.deviceConnected}
product=${prerequisites.productVerified}
serial=${prerequisites.serialVerified}
unlocked=${prerequisites.bootloaderUnlocked}
complete=${prerequisites.releaseComplete}
verified=${prerequisites.releaseVerified}
file=${prerequisites.releaseFileAvailable}
state=${prerequisites.installerState}`,
      prerequisites,
      'FLASH'
    );
  }

  private describeMissingFlashPrerequisites(prerequisites: FlashPrerequisites): string[] {
    const missing: string[] = [];
    if (!prerequisites.deviceConnected) missing.push('Pixel disconnected');
    if (!prerequisites.productVerified) missing.push(`product is not ${DEVICE_TARGET.codename}`);
    if (!prerequisites.serialVerified) missing.push('Device serial does not match');
    if (!prerequisites.bootloaderUnlocked) missing.push('Bootloader is locked');
    if (!prerequisites.releaseComplete) missing.push('release is not complete');
    if (!prerequisites.releaseVerified) missing.push('Release verification metadata is missing');
    if (!prerequisites.releaseFileAvailable) missing.push('Verified release file is missing');
    if (prerequisites.installerState !== 'VERIFIED') missing.push(`installer state is ${prerequisites.installerState}`);
    return missing;
  }

  private normalizeFactoryProgress(progress: number | null): number {
    if (typeof progress !== 'number' || !Number.isFinite(progress)) {
      return 0;
    }
    if (progress >= 0 && progress <= 1) {
      return Math.round(progress * 100);
    }
    if (progress >= 0 && progress <= 100) {
      return Math.round(progress);
    }
    return Math.min(100, Math.max(0, Math.round(progress)));
  }

  private async getOptionalVariable(device: FastbootDeviceLike, name: string): Promise<string | null> {
    try {
      return (await device.getVariable(name)) ?? null;
    } catch {
      return null;
    }
  }

  private logFastbootMode(isUserspace: string | null): void {
    const mode = isUserspace?.trim().toLowerCase() === 'yes' ? 'Fastbootd' : 'Bootloader';
    addLog('DEVICE', `Mode: ${mode}`, { isUserspace }, 'DEVICE');
  }

  private async logFactoryZipPreflight(device: FastbootDeviceLike, manifest: ReleaseManifest, file: File): Promise<void> {
    if (file.size !== manifest.release.size) {
      addLog('ERROR', 'Release file size does not match manifest size. Flash stopped before flashFactoryZip.', {
        fileSize: file.size,
        expectedSize: manifest.release.size,
        releaseId: manifest.release.id
      }, 'FLASH');
      throw new InstallerError('Release file size does not match the manifest. Flash stopped before writing.');
    }

    const [product, unlocked, currentSlot, isUserspace, maxDownloadSize] = await Promise.all([
      this.getOptionalVariable(device, 'product'),
      this.getOptionalVariable(device, 'unlocked'),
      this.getOptionalVariable(device, 'current-slot'),
      this.getOptionalVariable(device, 'is-userspace'),
      this.getOptionalVariable(device, 'max-download-size')
    ]);
    void currentSlot;
    void maxDownloadSize;
    this.logFastbootMode(isUserspace);
    if (product !== DEVICE_TARGET.codename || normalizeUnlockedState(unlocked) !== 'yes') {
      addLog('WARN', 'Flash preflight changed behavior', {
        product,
        unlocked,
        currentSlot,
        isUserspace,
        maxDownloadSize,
        fileSize: file.size,
        expectedSize: manifest.release.size
      }, 'FLASH');
    }
  }

  private async assertZipWorkerAssetsReachable(): Promise<void> {
    clearZipWorkerFailure();
    const checks = [
      { label: 'worker', url: ZIP_INFLATE_WORKER_URL },
      { label: 'pako', url: ZIP_PAKO_INFLATE_URL }
    ];
    const results: ZipWorkerCheck[] = [];
    for (const check of checks) {
      const result = await this.checkZipWorkerAsset(check.label, check.url);
      results.push(result);
    }
    if (results.some((result) => !result.reachable)) {
      addLog('ERROR', 'ZIP worker asset missing. Flash stopped before flashFactoryZip.', results, 'FASTBOOT');
      throw new InstallerError('ZIP decompression worker is unavailable. Installation cannot start.');
    }
  }

  private async checkZipWorkerAsset(label: string, url: string): Promise<ZipWorkerCheck> {
    try {
      let response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, { method: 'GET', cache: 'no-store' });
      }
      return { label, url, reachable: response.ok, status: response.status };
    } catch (error) {
      return { label, url, reachable: false, status: null, error: userMessageForError(error) };
    }
  }

  private async reopenVerifiedReleaseFile(manifest: ReleaseManifest): Promise<File> {
    const metadata = await this.store.getMetadata(releaseKey(manifest));
    if (!metadata?.verified || !metadata.complete || metadata.expectedSha256 !== manifest.release.sha256 || metadata.expectedSize !== manifest.release.size) {
      throw new InstallerError('Release verification metadata is missing');
    }
    const file = await this.store.getReleaseFile(manifest);
    if (!file) {
      setReleaseStorageState({ releaseFileAvailable: false });
      throw new InstallerError('Verified release file is missing');
    }
    if (file.size !== manifest.release.size || metadata.downloadedBytes !== manifest.release.size) {
      setReleaseStorageState({ releaseComplete: false });
      throw new InstallerError('Release file size does not match verified metadata');
    }
    if (this.verifiedSha256 !== manifest.release.sha256 || getState().verifiedDigest !== manifest.release.sha256) {
      throw new InstallerError('Release verification metadata is missing');
    }
    setReleaseStorageState({ releaseComplete: true, releaseVerified: true, releaseFileAvailable: true });
    return file;
  }

  private async verifyAfterFlash(): Promise<void> {
    const device = this.requireDevice();
    const product = await device.getVariable('product');
    const serial = await device.getVariable('serialno');
    const unlocked = await device.getVariable('unlocked');
    if (product !== DEVICE_TARGET.codename || !reconnectSerialMatches(serial, getPersistedMetadata().expectedSerial)) {
      throw new WrongDeviceError();
    }
    if (normalizeUnlockedState(unlocked) !== 'yes') {
      throw new InstallerError('Post-flash verification requires an unlocked bootloader before lock is offered.');
    }
    setDeviceInfo({ product, serial: serial ?? 'Unavailable', bootloader: 'Unlocked' });
    transitionInstallerState('LOCK_READY', 'Ready to lock bootloader.');
  }

  private async completeReconnectDuringFlash(device: FastbootDeviceLike): Promise<void> {
    try {
      await this.assertConnectedPixel(device);
      this.logReconnectOnce('Pixel reconnected');
      if (getState().installerState === 'WAITING_FOR_RECONNECT') {
        transitionInstallerState('FLASHING', 'Resuming installation...');
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private async manualReconnectDuringFlash(): Promise<void> {
    const device = this.requireDevice();
    this.logReconnectOnce('Reconnect Device selected');
    try {
      await device.connect();
      await this.assertConnectedPixel(device);
      this.logReconnectOnce('Pixel reconnected');
      transitionInstallerState('FLASHING', 'Resuming installation...');
    } catch (error) {
      if (isDeviceSelectionCancelled(error)) {
        setStatusMessage('Reconnect the Pixel to continue installation.');
        return;
      }
      if (error instanceof WrongDeviceError) {
        setStatusMessage('Different Pixel detected. Reconnect the original device.');
        return;
      }
      throw error;
    }
  }

  private beginFlashReconnect(): void {
    if (this.flashReconnectActive) {
      return;
    }
    this.flashReconnectActive = true;
    this.disposeReconnectManager();
    this.stopWatchdogs();
    this.logReconnectOnce('Pixel restarted');
    this.logReconnectOnce('Waiting for reconnect');
    transitionInstallerState('WAITING_FOR_RECONNECT', 'Reconnect the Pixel to continue installation.');
    this.flashReconnectReminder = globalThis.setTimeout(() => {
      if (this.flashReconnectActive && getState().installerState === 'WAITING_FOR_RECONNECT') {
        setStatusMessage('Still waiting for the Pixel.');
      }
    }, 30_000);
  }

  private endFlashReconnect(): void {
    this.flashReconnectActive = false;
    this.clearFlashReconnectReminder();
  }

  private clearFlashReconnectReminder(): void {
    if (this.flashReconnectReminder) {
      globalThis.clearTimeout(this.flashReconnectReminder);
      this.flashReconnectReminder = null;
    }
  }

  private startFlashWatchdog(): void {
    if (this.flashReconnectActive || this.flashWatchdog) {
      return;
    }
    this.flashWatchdog = new FlashActivityWatchdog(
      (message, details) => addLog('WARN', message, details, 'FLASH'),
      (message) => setStatusMessage(message)
    );
  }

  private startZipWatchdog(): void {
    if (this.flashReconnectActive || this.zipWatchdog) {
      return;
    }
    this.zipWatchdog = new ZipUnpackWatchdog(
      (message, details) => addLog('WARN', message, details, 'ZIP'),
      (message) => setStatusMessage(message)
    );
  }

  private stopWatchdogs(): void {
    this.flashWatchdog?.dispose();
    this.flashWatchdog = null;
    this.zipWatchdog?.dispose();
    this.zipWatchdog = null;
  }

  private logReconnectOnce(message: string, details?: unknown): void {
    if (this.reconnectLogMessages.has(message)) {
      return;
    }
    this.reconnectLogMessages.add(message);
    addLog('RECONNECT', message, details, 'RECONNECT');
  }

  private clearPendingFlashReconnect(): void {
    this.endFlashReconnect();
  }

  private async assertConnectedPixel(device: FastbootDeviceLike): Promise<void> {
    const product = await device.getVariable('product');
    const serial = await device.getVariable('serialno');
    const isUserspace = await this.getOptionalVariable(device, 'is-userspace');
    if (product !== DEVICE_TARGET.codename || !reconnectSerialMatches(serial, getPersistedMetadata().expectedSerial)) {
      throw new WrongDeviceError();
    }
    this.logFastbootMode(isUserspace);
    addLog('RECONNECT', 'Product reverified', { product }, 'RECONNECT');
    addLog('RECONNECT', 'Serial reverified', { serial: maskSerial(serial) }, 'RECONNECT');
  }

  private userVisibleFactoryStatus(action: string, item: string | null): string {
    const visibleItem = item === 'avb_custom_key' ? 'Verified Boot key' : item;
    if (action === 'load' && item === 'package') {
      return 'Loading installation package...';
    }
    if (action === 'reboot') {
      return visibleItem ? `Rebooting ${visibleItem}...` : 'Rebooting Pixel...';
    }
    if (action === 'wipe') {
      return visibleItem ? `Wiping ${visibleItem}...` : 'Wiping data...';
    }
    if (action === 'flash') {
      return visibleItem ? `Flashing ${visibleItem}...` : 'Flashing...';
    }
    return visibleItem ? `Running ${action} ${visibleItem}...` : `Running ${action}...`;
  }

  private async assertFlashPreconditions(device: FastbootDeviceLike): Promise<void> {
    const product = await device.getVariable('product');
    const serial = await device.getVariable('serialno');
    const unlocked = await device.getVariable('unlocked');
    if (product !== DEVICE_TARGET.codename) {
      throw new WrongDeviceError(`Connected device product is ${product ?? 'unknown'}, expected ${DEVICE_TARGET.codename}.`);
    }
    if (!reconnectSerialMatches(serial, getPersistedMetadata().expectedSerial)) {
      throw new WrongDeviceError('Device serial does not match');
    }
    if (normalizeUnlockedState(unlocked) !== 'yes') {
      throw new InstallerError('Bootloader is locked');
    }
    setDeviceInfo({ product, serial: serial ?? 'Unavailable', bootloader: 'Unlocked' });
  }

  private async assertLockPreconditions(device: FastbootDeviceLike): Promise<void> {
    const manifest = this.requireManifest();
    const product = await device.getVariable('product');
    const serial = await device.getVariable('serialno');
    if (product !== DEVICE_TARGET.codename) {
      throw new WrongDeviceError(`Connected device product is ${product ?? 'unknown'}, expected ${DEVICE_TARGET.codename}.`);
    }
    if (!reconnectSerialMatches(serial, getPersistedMetadata().expectedSerial)) {
      throw new WrongDeviceError();
    }
    if (this.verifiedSha256 !== manifest.release.sha256 || getState().verifiedDigest !== manifest.release.sha256) {
      throw new ReleaseVerificationError('Release SHA-256 must be verified before locking the bootloader.');
    }
  }

  private async reconnectAfterLock(): Promise<void> {
    const manager = this.createReconnectManager(requireWebUsb());
    await manager.waitForExpectedDevice(getPersistedMetadata().expectedSerial);
    this.device = await (this.dependencies.createDevice?.() ?? createFastbootDevice());
    await this.device.connect();
    const product = await this.device.getVariable('product');
    const serial = await this.device.getVariable('serialno');
    const unlocked = await this.device.getVariable('unlocked');
    if (product !== DEVICE_TARGET.codename || !reconnectSerialMatches(serial, getPersistedMetadata().expectedSerial)) {
      throw new WrongDeviceError();
    }
    const normalized = normalizeUnlockedState(unlocked);
    setDeviceInfo({
      product,
      serial: serial ?? 'Unavailable',
      bootloader: normalized === 'no' ? 'Locked' : normalized === 'yes' ? 'Unlocked' : 'Unknown'
    });
    if (normalized === 'yes') {
      throw new InstallerError('Bootloader is still unlocked after the lock command. Stopping.');
    }
    if (normalized === 'unknown') {
      transitionInstallerState('LOCKED', 'Lock command completed. Verify the locked state on the Pixel screen.');
      addLog('BOOTLOADER', 'Lock complete', { product, serial: maskSerial(serial), unlocked: normalized }, 'BOOTLOADER');
      return;
    }
    transitionInstallerState('LOCKED', 'Bootloader lock verified.');
    addLog('BOOTLOADER', 'Lock complete', { product, serial: maskSerial(serial), unlocked: normalized }, 'BOOTLOADER');
  }

  private async assertNoActiveSnapshotUpdate(device: FastbootDeviceLike): Promise<void> {
    try {
      const status = await device.getVariable('snapshot-update-status');
      if (status && status !== 'none') {
        addLog('WARN', 'pending snapshot detected');
        addLog('WARN', 'cancel snapshot requested');
        await device.runCommand('snapshot-update:cancel');
        addLog('FASTBOOT', 'cancel result completed', undefined, 'FASTBOOT');
      }
    } catch (error) {
      if (error instanceof InstallerError) {
        throw error;
      }
      addLog('DEBUG', 'getvar snapshot-update-status unsupported');
    }
  }

  private async createLoggedDevice(): Promise<FastbootDeviceLike> {
    const raw = await (this.dependencies.createDevice?.() ?? createFastbootDevice());
    return this.wrapFastbootDevice(raw);
  }

  private patchUsbTransferLogging(usbDevice: USBDevice): void {
    const patched = usbDevice as UsbDeviceWithTransfers;
    if (patched[USB_LOG_PATCHED] || typeof patched.transferIn !== 'function' || typeof patched.transferOut !== 'function') {
      return;
    }
    const originalTransferIn = patched.transferIn.bind(usbDevice);
    const originalTransferOut = patched.transferOut.bind(usbDevice);
    patched.transferIn = async (endpointNumber: number, length: number) => {
      this.flashWatchdog?.markUsbActivity();
      addLog('USB', '[FASTBOOT] USB transfer started', { direction: 'in', endpointNumber, length }, 'USB');
      try {
        const result = await originalTransferIn(endpointNumber, length);
        this.flashWatchdog?.markUsbActivity();
        addLog('USB', '[FASTBOOT] USB transfer completed', { direction: 'in', endpointNumber, length }, 'USB');
        return result;
      } catch (error) {
        addLog('ERROR', `[FASTBOOT] FAIL ${userMessageForError(error)}`, { direction: 'in', endpointNumber }, 'FASTBOOT');
        throw error;
      }
    };
    patched.transferOut = async (endpointNumber: number, data: BufferSource) => {
      this.flashWatchdog?.markUsbActivity();
      const byteLength = 'byteLength' in data ? data.byteLength : null;
      addLog('USB', '[FASTBOOT] USB transfer started', { direction: 'out', endpointNumber, byteLength }, 'USB');
      try {
        const result = await originalTransferOut(endpointNumber, data);
        this.flashWatchdog?.markUsbActivity();
        addLog('USB', '[FASTBOOT] USB transfer completed', { direction: 'out', endpointNumber, byteLength }, 'USB');
        return result;
      } catch (error) {
        addLog('ERROR', `[FASTBOOT] FAIL ${userMessageForError(error)}`, { direction: 'out', endpointNumber }, 'FASTBOOT');
        throw error;
      }
    };
    patched[USB_LOG_PATCHED] = true;
  }

  private wrapFastbootDevice(device: FastbootDeviceLike): FastbootDeviceLike {
    return {
      get isConnected() {
        return device.isConnected;
      },
      get device() {
        return device.device;
      },
      connect: async () => {
        await device.connect();
        const usbDevice = device.device;
        if (usbDevice) {
          this.patchUsbTransferLogging(usbDevice);
          addLog('USB', 'Pixel connected', usbDiagnostics(usbDevice), 'USB');
        }
      },
      getVariable: async (varName: string) => {
        try {
          const value = await device.getVariable(varName);
          if (value === undefined || value === null) {
            return value;
          }
          return value;
        } catch (error) {
          const message = userMessageForError(error);
          addLog('WARN', `getvar ${varName} unavailable`, { varName, message }, 'FASTBOOT');
          throw error;
        }
      },
      runCommand: async (command: string) => {
        const startedAt = performance.now();
        this.flashWatchdog?.markFastbootActivity();
        try {
          const response = await device.runCommand(command);
          this.flashWatchdog?.markFastbootActivity();
          return response;
        } catch (error) {
          addLog('ERROR', `[FASTBOOT] FAIL ${userMessageForError(error)}`, { command, durationMs: Math.round(performance.now() - startedAt) }, 'FASTBOOT');
          throw error;
        }
      },
      waitForDisconnect: () => device.waitForDisconnect(),
      waitForConnect: (onReconnect?: ReconnectCallback) => device.waitForConnect(onReconnect),
      reboot: async (target?: string, wait?: boolean, onReconnect?: ReconnectCallback) => {
        this.flashWatchdog?.markFastbootActivity();
        await device.reboot(target, wait, onReconnect);
        this.flashWatchdog?.markFastbootActivity();
      },
      flashFactoryZip: async (blob: Blob, wipe: boolean, onReconnect: ReconnectCallback, onProgress?: FactoryFlashCallback) => {
        const originalWaitForConnect = device.waitForConnect.bind(device);
        device.waitForConnect = async (callback?: ReconnectCallback) => {
          let reconnectRequest: Promise<void> | null = null;
          await originalWaitForConnect(() => {
            const result = callback?.();
            reconnectRequest = Promise.resolve(result);
          });
          if (reconnectRequest) {
            await reconnectRequest;
          }
          await this.completeReconnectDuringFlash(device);
        };
        try {
          await device.flashFactoryZip(blob, wipe, onReconnect, onProgress);
        } finally {
          device.waitForConnect = originalWaitForConnect;
        }
      }
    };
  }

  private requireDevice(): FastbootDeviceLike {
    if (!this.device) {
      throw new InstallerError('No Pixel is connected.');
    }
    return this.device;
  }

  private requireManifest(): ReleaseManifest {
    if (!this.manifest) {
      const stateRelease = getState().release;
      if (stateRelease) {
        this.manifest = stateRelease;
      }
    }
    if (!this.manifest) {
      throw new InstallerError('No Worm OS release manifest is loaded.');
    }
    return this.manifest;
  }

  private requireReleaseBlob(): Blob {
    if (!this.releaseBlob) {
      throw new InstallerError('No Worm OS release has been downloaded.');
    }
    return this.releaseBlob;
  }

  private async restoreStoredReleaseState(): Promise<void> {
    try {
      const manifest = await fetchReleaseManifest(addLog);
      this.manifest = manifest;
      setRelease(manifest);
      setCacheKey(releaseKey(manifest));
      const cached = await inspectStoredRelease(manifest, this.store, (progress) => {
        setDownloadProgress(progress);
        setProgress(progress.percent ?? 0);
      }, addLog);
      setReleaseStorageState({ releaseComplete: cached.complete, releaseVerified: cached.verified, releaseFileAvailable: Boolean(cached.file) });
      if (!cached.file) {
        return;
      }
      if (cached.complete && cached.verified) {
        this.releaseBlob = null;
        this.verifiedSha256 = manifest.release.sha256;
        setVerifiedDigest(manifest.release.sha256);
        transitionInstallerState('VERIFIED', 'Downloaded release found in persistent storage.');
        await this.refreshFlashReadiness();
      } else if (cached.complete) {
        this.releaseBlob = cached.file;
        transitionInstallerState('DOWNLOADED', 'Release already downloaded.');
      } else if (cached.file.size > 0) {
        setStatusMessage('Partial Worm OS release found.');
        addLog('info', 'Partial Worm OS release found.');
      }
    } catch (error) {
      addLog('DEBUG', `Stored release check skipped: ${userMessageForError(error)}`);
    }
  }

  private createReconnectManager(usb: USB, options?: ReconnectManagerOptions): ReconnectManager {
    this.disposeReconnectManager();
    this.reconnectManager = new ReconnectManager(usb, options);
    return this.reconnectManager;
  }

  private disposeReconnectManager(): void {
    this.reconnectManager?.dispose();
    this.reconnectManager = null;
  }

  private fail(error: unknown): void {
    if (isDeviceSelectionCancelled(error)) {
      addLog('WARN', 'requestDevice cancelled', { errorClass: 'NotFoundError' }, 'USB');
      this.disposeReconnectManager();
      this.device = null;
      returnToIdle('No Pixel selected. Put the Pixel 10 in Fastboot Mode and try again.');
      return;
    }

    const message = userMessageForError(error);
    const errorClass = error instanceof Error ? error.name : typeof error;
    const flashActivity = this.flashWatchdog?.snapshot() ?? null;

    const stage = getState().statusMessage || getState().installerState;
    const item = flashActivity?.lastItem ?? getState().flash?.item ?? null;
    const mode = getState().flash?.operation === 'unpack' ? 'Preparing files' : getState().deviceInfo.bootloader || 'Unknown';
    const connection = this.device?.isConnected === false ? 'disconnected' : this.device ? 'connected' : 'not connected';
    addLog('ERROR', 'Installation error', {
      stage,
      item,
      mode,
      connection,
      message,
      errorClass,
      lastProgress: flashActivity?.lastProgress ?? getState().flash?.rawProgress ?? null
    }, 'ERROR');
    console.error(error);
    if (getState().installerState !== 'DOWNLOADING') {
      this.disposeReconnectManager();
    }
    if (['ERROR', 'COMPLETE'].includes(getState().installerState)) {
      this.wakeLock.dispose();
    }
    setErrorMessage(message);
    enterErrorState(message);
  }
}
