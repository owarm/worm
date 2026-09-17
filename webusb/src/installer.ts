import { BlobStore } from './blob-store';
import { DEVICE_TARGET } from './config';
import { sha256Blob } from './crypto';
import {
  createFastbootDevice,
  inspectAndroidFastboot,
  normalizeUnlockedState,
  ZIP_WORKER_CONFIGURATION,
  ZIP_INFLATE_WORKER_URL,
  ZIP_INFLATE_WORKER_SCRIPTS,
  ZIP_PAKO_INFLATE_URL,
  type FactoryFlashCallback,
  type FastbootDeviceLike,
  type ReconnectCallback
} from './fastboot';
import { buildFlashPlan, formatFlashPlan, openZipEntries, readEntryBlob, type FlashPlan, type FlashPlanStep } from './flash-plan';
import { maskSerial, collectBrowserCapabilities, setBrowserCapabilities } from './logger';
import { downloadRelease, fetchReleaseManifest, inspectStoredRelease, MANIFEST_URL, metadataFromManifest, releaseKey } from './release';
import {
  addLog,
  enterErrorState,
  getPersistedMetadata,
  getState,
  isTestMode,
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
  setVerifyProgress,
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
  mockMode?: boolean;
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
  lastOperation: string | null;
  lastSuccessfulOperation: string | null;
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

class FastbootSession {
  private devicePromise: Promise<FastbootDeviceLike> | null = null;
  device: FastbootDeviceLike | null = null;

  constructor(private readonly createDevice: () => Promise<FastbootDeviceLike>) {}

  async getDevice(): Promise<FastbootDeviceLike> {
    if (!this.devicePromise) {
      this.devicePromise = this.createDevice().then((device) => {
        this.device = device;
        return device;
      });
    }
    return this.devicePromise;
  }
}

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
    lastProgress: null,
    lastOperation: null,
    lastSuccessfulOperation: null
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

type UsbAlternateDescriptor = {
  interfaceClass?: number;
  interfaceSubclass?: number;
  interfaceProtocol?: number;
};

type UsbInterfaceDescriptor = {
  alternates?: UsbAlternateDescriptor[];
};

type UsbConfigurationDescriptor = {
  interfaces?: UsbInterfaceDescriptor[];
};

type UsbDeviceWithDescriptors = USBDevice & {
  configurations?: UsbConfigurationDescriptor[];
};

const hasFastbootInterface = (device: USBDevice): boolean => {
  const configurations = (device as UsbDeviceWithDescriptors).configurations ?? [];
  if (configurations.length === 0) {
    return true;
  }
  return configurations.some((configuration) =>
    (configuration.interfaces ?? []).some((usbInterface) =>
      (usbInterface.alternates ?? []).some(
        (alternate) => alternate.interfaceClass === 0xff && alternate.interfaceSubclass === 0x42 && alternate.interfaceProtocol === 0x03
      )
    )
  );
};

const isAuthorizedFastbootCandidate = (device: USBDevice, expectedSerial: string | null | undefined): boolean =>
  device.vendorId === DEVICE_TARGET.usbVendorId && reconnectSerialMatches(device.serialNumber, expectedSerial) && hasFastbootInterface(device);

const USB_LOG_PATCHED = Symbol('wormUsbLoggingPatched');

type UsbDeviceWithTransfers = USBDevice & {
  [USB_LOG_PATCHED]?: boolean;
  transferIn?: (endpointNumber: number, length: number) => Promise<unknown>;
  transferOut?: (endpointNumber: number, data: BufferSource) => Promise<unknown>;
};

const isActiveOperation = (): boolean =>
  ['DOWNLOADING', 'VERIFYING', 'FLASHING', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'UNLOCKING', 'WAITING_USER_UNLOCK', 'LOCKING', 'WAITING_USER_LOCK', 'REBOOTING'].includes(
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
  private readonly fastbootSession: FastbootSession;
  private releaseBlob: Blob | null = null;
  private manifest: ReleaseManifest | null = null;
  private verifiedSha256: string | null = null;
  private readonly store: BlobStore;
  private readonly mockMode: boolean;
  private readonly wakeLock = new WakeLockManager();
  private downloadAbortController: AbortController | null = null;
  private destructiveOperation = false;
  private reconnectManager: ReconnectManager | null = null;
  private flashWatchdog: FlashActivityWatchdog | null = null;
  private zipWatchdog: ZipUnpackWatchdog | null = null;
  private factoryFlashActive = false;
  private factoryReconnectPending = false;
  private factoryWaitingForFlashResume = false;
  private reconnectBusy = false;
  private reconnectSequence = 0;
  private currentFlashAttemptId = 0;
  private terminalFlashAttemptId: number | null = null;
  private lastFlashActivity: FlashActivitySnapshot = {
    lastProgressAt: null,
    lastFastbootActivityAt: null,
    lastUsbActivityAt: null,
    lastAction: null,
    lastItem: null,
    lastProgress: null,
    lastOperation: null,
    lastSuccessfulOperation: null
  };
  private flashReconnectReminder: ReturnType<typeof globalThis.setTimeout> | null = null;
  private readonly onBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
    if (!this.downloadAbortController) {
      return undefined;
    }
    event.preventDefault();
    event.returnValue = 'An installation image download is still in progress.';
    return event.returnValue;
  };

  constructor(private readonly dependencies: InstallerDependencies = {}) {
    this.store = dependencies.store ?? new BlobStore();
    this.mockMode = import.meta.env.DEV && dependencies.mockMode === true;
    this.fastbootSession = new FastbootSession(() => this.createLoggedDevice());
  }

  async init(): Promise<void> {
    this.assertRealInstallerAllowed('init');
    await restoreLogsForCurrentSession();
    const capabilities = await collectBrowserCapabilities(MANIFEST_URL);
    setBrowserCapabilities(capabilities);
    await this.store.init();
    setFastbootInspection(await inspectAndroidFastboot());
    installZipWorkerErrorDiagnostics();
    if (this.mockMode) {
      await this.restoreMockReleaseState();
    } else {
      await this.restoreStoredReleaseState();
    }
  }

  async connect(manual = true): Promise<void> {
    try {
      this.assertRealInstallerAllowed('connect');
      transitionInstallerState(getState().installerState === 'ERROR' ? 'CONNECTING' : 'CONNECTING', 'Connecting to Pixel...');
      if (!this.mockMode) {
        requireWebUsb();
      }
      if (manual) {
        addLog('USB', 'Pixel connected', undefined, 'USB');
      }
      const device = await this.getSessionDevice();
      await device.connect();
      transitionInstallerState('CONNECTED', 'Pixel connected.');
      addLog('USB', 'Pixel connected', undefined, 'USB');
      await this.verifyConnectedDevice();
    } catch (error) {
      this.fail(error);
    }
  }

  async verifyConnectedDevice(): Promise<void> {
    this.assertRealInstallerAllowed('verifyConnectedDevice');
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
    if (this.mockMode) {
      addLog('DEVICE', `Product verified: ${product}`, { product }, 'DEVICE');
      if (bootloaderState === 'yes') {
        addLog('DEVICE', 'Bootloader unlocked', { unlocked: bootloaderState }, 'DEVICE');
      }
    }

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
      this.assertRealInstallerAllowed('unlockBootloader');
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
    this.assertRealInstallerAllowed('reconnectAfterUnlock');
    const usb = requireWebUsb();
    const manager = this.createReconnectManager(usb);
    await manager.waitForExpectedDevice(getPersistedMetadata().expectedSerial);
    const device = await this.getSessionDevice();
    await device.connect();
    const product = await device.getVariable('product');
    const serial = await device.getVariable('serialno');
    const unlocked = await device.getVariable('unlocked');
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
      this.assertRealInstallerAllowed('downloadWormOs');
      await this.wakeLock.acquire();
      if (this.mockMode) {
        await this.downloadMockRelease();
        return;
      }
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
        setProgress(100);
        setVerifyProgress({
          state: 'verified',
          verifiedBytes: cached.file.size,
          totalBytes: cached.file.size,
          percent: 100,
          expectedSha256: manifest.release.sha256,
          actualSha256: manifest.release.sha256,
          metadataVerified: true,
          fileAvailable: true,
          fileSize: cached.file.size
        });
        addLog('VERIFY', 'Image already verified', undefined, 'VERIFY');
        transitionInstallerState('VERIFIED', 'Image already verified ✓');
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
      if (this.downloadAbortController?.signal.aborted) {
        setReleaseStorageState({ releaseComplete: false, releaseVerified: false });
        addLog('DOWNLOAD', 'Download paused', undefined, 'DOWNLOAD');
        transitionInstallerState('DOWNLOAD_PAUSED', 'Download paused. Resume when ready.');
        return;
      }
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
      this.assertRealInstallerAllowed('verifyRelease');
      void this.wakeLock.acquire();
      if (this.mockMode) {
        await this.verifyMockRelease();
        return;
      }
      const manifest = this.requireManifest();
      const key = releaseKey(manifest);
      const metadata = await this.store.getMetadata(key);
      const file = await this.store.getReleaseFile(manifest);
      const fileAvailable = Boolean(file);
      setVerifyProgress({
        state: 'checking-cache',
        verifiedBytes: 0,
        totalBytes: manifest.release.size,
        percent: 0,
        expectedSha256: manifest.release.sha256,
        actualSha256: null,
        metadataVerified: Boolean(metadata?.verified),
        fileAvailable,
        fileSize: file?.size ?? null
      });
      if (!file) {
        throw new ReleaseVerificationError('Release file is missing from persistent browser storage.');
      }
      if (file.size !== manifest.release.size) {
        throw new ReleaseVerificationError(`Release file size mismatch: expected ${manifest.release.size} bytes, found ${file.size} bytes.`);
      }

      const metadataMatches =
        metadata?.releaseId === manifest.release.id &&
        metadata.device === manifest.device &&
        metadata.expectedSha256 === manifest.release.sha256 &&
        metadata.expectedSize === manifest.release.size;
      if (metadataMatches && metadata.complete && metadata.verified && file.size === manifest.release.size) {
        this.releaseBlob = null;
        this.verifiedSha256 = manifest.release.sha256;
        setVerifiedDigest(manifest.release.sha256);
        setReleaseStorageState({ releaseComplete: true, releaseVerified: true, releaseFileAvailable: true });
        setProgress(100);
        setVerifyProgress({
          state: 'verified',
          verifiedBytes: file.size,
          totalBytes: file.size,
          percent: 100,
          actualSha256: manifest.release.sha256,
          metadataVerified: true,
          fileAvailable: true,
          fileSize: file.size
        });
        setDownloadProgress({
          releaseId: manifest.release.id,
          downloadedBytes: file.size,
          totalBytes: manifest.release.size,
          percent: 100,
          storedLocally: true,
          verified: true,
          status: 'Image already verified ✓'
        });
        addLog('VERIFY', 'Image already verified', undefined, 'VERIFY');
        transitionInstallerState('VERIFIED', 'Image already verified ✓');
        await this.refreshFlashReadiness();
        return;
      }

      transitionInstallerState('VERIFYING', 'Verifying image.');
      setProgress(0);
      setVerifyProgress({ state: 'verifying', verifiedBytes: 0, totalBytes: file.size, percent: 0 });
      addLog('VERIFY', 'Image verification started', { bytes: file.size }, 'VERIFY');
      const startedAt = performance.now();
      const loggedMilestones = new Set<number>();
      let lastRenderedPercent = 0;
      const digest = await sha256Blob(file, (bytesVerified, percent) => {
        if (percent === 100 || percent - lastRenderedPercent >= 5) {
          lastRenderedPercent = percent;
          setProgress(percent);
          setVerifyProgress({ verifiedBytes: bytesVerified, percent });
          setStatusMessage(`Verifying image ${percent}%`);
        }
        for (const milestone of [25, 50, 75, 100]) {
          if (percent >= milestone && !loggedMilestones.has(milestone)) {
            loggedMilestones.add(milestone);
            addLog('VERIFY', `${milestone}%`, { bytesVerified, percent: milestone }, 'VERIFY');
          }
        }
      });
      setVerifyProgress({ actualSha256: digest, verifiedBytes: file.size, percent: 100 });
      if (digest !== manifest.release.sha256) {
        throw new ReleaseVerificationError('Image verification failed.');
      }
      this.verifiedSha256 = digest;
      setVerifiedDigest(digest);
      try {
        await this.store.saveMetadata(key, metadataFromManifest(manifest, file.size, true, true));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new InstallerError(`Storage metadata save failed after verification: ${message}`);
      }
      setDownloadProgress({
        releaseId: manifest.release.id,
        downloadedBytes: file.size,
        totalBytes: manifest.release.size,
        percent: 100,
        storedLocally: true,
        verified: true,
        status: 'Image verified ✓'
      });
      setReleaseStorageState({ releaseComplete: true, releaseVerified: true, releaseFileAvailable: true });
      this.releaseBlob = null;
      setProgress(100);
      setVerifyProgress({ state: 'verified', metadataVerified: true, fileAvailable: true, fileSize: file.size });
      addLog('VERIFY', 'Image verified', { durationMs: Math.round(performance.now() - startedAt) }, 'VERIFY');
      transitionInstallerState('VERIFIED', 'Image verified ✓');
      await this.refreshFlashReadiness();
    } catch (error) {
      if (error instanceof ReleaseVerificationError && this.manifest) {
        addLog('ERROR', 'Image verification failed', {
          message: error.message,
          expectedSha256: this.manifest.release.sha256,
          actualSha256: getState().verify.actualSha256
        }, 'VERIFY');
        const metadata = await this.store.getMetadata(releaseKey(this.manifest));
        if (metadata) {
          try {
            await this.store.saveMetadata(releaseKey(this.manifest), { ...metadata, verified: false, updatedAt: new Date().toISOString() });
          } catch (saveError) {
            addLog('ERROR', 'Storage metadata save failed after verification error', { message: saveError instanceof Error ? saveError.message : String(saveError) }, 'VERIFY');
          }
        }
      }
      setVerifiedDigest(null);
      setReleaseStorageState({ releaseVerified: false });
      setVerifyProgress({ state: 'failed', metadataVerified: false });
      this.verifiedSha256 = null;
      this.fail(error);
    } finally {
      void this.wakeLock.release().catch(() => undefined);
    }
  }

  async flashWormOs(): Promise<void> {
    let flashFactoryZipStarted = false;
    const attemptId = ++this.currentFlashAttemptId;
    this.terminalFlashAttemptId = null;
    try {
      this.assertRealInstallerAllowed('flashWormOs');
      await this.wakeLock.acquire();
      addLog('FLASH', 'Installation started', undefined, 'FLASH');
      if (this.destructiveOperation) {
        throw new InstallerError('Another destructive operation is already in progress.');
      }
      this.destructiveOperation = true;
      if (!this.fastbootSession.device) {
        throw new InstallerError('Pixel disconnected');
      }
      const device = this.requireDevice();
      const manifest = this.requireManifest();
      await this.assertFlashPreconditions(device);
      const blob = await this.reopenVerifiedReleaseFile(manifest);
      this.assertFactoryFlashStartReady(device, manifest, blob);
      await this.assertNoActiveSnapshotUpdate(device);
      await this.assertZipWorkerAssetsReachable();

      transitionInstallerState('FLASHING', 'Flashing Worm OS.');
      await this.logFactoryZipPreflight(device, manifest, blob);
      addLog('ZIP', 'Preparing installation files', undefined, 'ZIP');
      setProgress(0);
      const flashStartedAt = performance.now();
      this.startFlashWatchdog();
      this.startZipWatchdog();
      try {
        this.factoryFlashActive = true;
        const onProgress: FactoryFlashCallback = (action, item, progress) => {
          if (!this.isActiveFlashAttempt(attemptId)) {
            return;
          }
          const safeAction = action ?? 'prepare';
          const safeItem = item ?? 'images';
          const safeProgress = progress ?? null;
          let resumedFromReconnect = false;
          if (this.factoryWaitingForFlashResume) {
            resumedFromReconnect = true;
            this.factoryWaitingForFlashResume = false;
            this.factoryReconnectPending = false;
            this.reconnectBusy = false;
            this.clearFlashReconnectReminder();
            this.logReconnect('Installation resumed', this.reconnectSequence, { flashAttemptId: attemptId });
            if (getState().installerState === 'WAITING_FOR_RECONNECT') {
              transitionInstallerState('WAITING_FOR_FLASH_RESUME', 'Connection restored. Waiting for installation...');
            }
            transitionInstallerState('FLASHING', 'Installation resumed.');
          }
          this.startFlashWatchdog();
          this.startZipWatchdog();
          this.flashWatchdog?.markProgress(safeAction, safeItem, safeProgress);
          this.zipWatchdog?.markActivity(safeAction, safeItem, safeProgress);
          const lastOperation = this.formatFactoryOperation(safeAction, safeItem);
          const activity = this.flashWatchdog?.snapshot() ?? this.lastFlashActivity;
          this.lastFlashActivity = {
            ...activity,
            lastAction: safeAction,
            lastItem: safeItem,
            lastProgress: safeProgress,
            lastOperation
          };
          const itemPercent = this.normalizeFactoryProgress(safeProgress);
          if (itemPercent >= 100) {
            this.lastFlashActivity = {
              ...this.lastFlashActivity,
              lastSuccessfulOperation: lastOperation
            };
          }
          setFlashProgress({ operation: safeAction, item: safeItem, itemPercent, overallPercent: null, rawProgress: safeProgress, overallIndeterminate: true });
          if (!resumedFromReconnect) {
            if (safeAction === 'unpack' || safeAction === 'prepare') {
              setStatusMessage('Preparing installation files...');
            } else {
              setStatusMessage(this.userVisibleFactoryStatus(safeAction, safeItem));
            }
          }
        };
        this.assertFactoryFlashCallbacks(() => undefined, onProgress);
        addLog('ZIP', 'Preparing images', undefined, 'ZIP');
        const plan = await buildFlashPlan(blob, manifest.release.id);
        addLog('FLASH', 'Final ordered flash plan', { plan: formatFlashPlan(plan), requiredFiles: plan.requiredFiles }, 'FLASH');
        flashFactoryZipStarted = true;
        await this.executeFlashPlan(device, blob, plan, attemptId, onProgress);
      } finally {
        this.factoryFlashActive = false;
        this.stopWatchdogs();
      }

      if (!this.isActiveFlashAttempt(attemptId)) {
        return;
      }
      this.terminalFlashAttemptId = attemptId;
      setProgress(100);
      addLog('FLASH', 'Installation complete', { durationMs: Math.round(performance.now() - flashStartedAt) }, 'FLASH');
      transitionInstallerState('FLASH_COMPLETE', 'Factory ZIP flash completed.');
      await this.verifyAfterFlash();
    } catch (error) {
      const originalMessage = userMessageForError(error);
      const maskFlashError = flashFactoryZipStarted && originalMessage !== 'ZIP decompression worker stopped responding.';
      this.terminalFlashAttemptId = attemptId;
      if (flashFactoryZipStarted) {
        this.logFactoryFlashError(error);
      }
      const message = maskFlashError ? 'Installation stopped.' : originalMessage;
      if (flashFactoryZipStarted) {
        this.clearPendingFlashReconnect();
      }
      this.fail(error, message);
    } finally {
      this.endFlashReconnect();
      this.stopWatchdogs();
      this.destructiveOperation = false;
      await this.wakeLock.release();
    }
  }

  async reconnectManual(): Promise<void> {
    this.assertRealInstallerAllowed('reconnectManual');
    if (this.factoryFlashActive || this.factoryReconnectPending) {
      await this.manualReconnectDuringFlash();
      return;
    }
    try {
      transitionInstallerState('CONNECTING', 'Reconnecting Pixel...');
      const manager = this.createReconnectManager(requireWebUsb());
      await manager.requestExpectedDevice(getPersistedMetadata().expectedSerial);
      const device = await this.getSessionDevice();
      await device.connect();
      transitionInstallerState('CONNECTED', 'Pixel connected.');
      await this.verifyConnectedDevice();
    } catch (error) {
      this.fail(error);
    }
  }

  async clearDownloadedRelease(): Promise<void> {
    this.assertRealInstallerAllowed('clearDownloadedRelease');
    if (this.destructiveOperation || ['FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT'].includes(getState().installerState)) {
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
      this.assertRealInstallerAllowed('lockBootloader');
      addLog('BOOTLOADER', 'Lock requested', undefined, 'BOOTLOADER');
      if (!this.canLockBootloader()) {
        throw new InstallerError('Bootloader lock is available only after a complete verified installation.');
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
      if (this.mockMode) {
        const unlocked = await device.getVariable('unlocked');
        setDeviceInfo({ bootloader: normalizeUnlockedState(unlocked) === 'no' ? 'Locked' : 'Unknown' });
        transitionInstallerState('LOCKED', 'Bootloader lock verified.');
        addLog('BOOTLOADER', 'Lock complete', { unlocked }, 'BOOTLOADER');
        return;
      }
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
      this.assertRealInstallerAllowed('rebootPixel');
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
      transitionInstallerState('COMPLETE', 'Installation complete.');
      addLog('COMPLETE', 'Installation complete', {
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
      setStatusMessage('Image verified ✓ Reconnect your device to continue.');
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
      deviceConnected: Boolean(this.fastbootSession.device && state.deviceInfo.serial !== 'Not connected'),
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

  private isActiveFlashAttempt(attemptId: number): boolean {
    return this.currentFlashAttemptId === attemptId && this.terminalFlashAttemptId !== attemptId;
  }

  private assertFactoryFlashStartReady(device: FastbootDeviceLike, manifest: ReleaseManifest, file: File): void {
    if (!this.fastbootSession) {
      throw new InstallerError('Fastboot session is unavailable.');
    }
    if (!this.fastbootSession.device) {
      throw new InstallerError('Fastboot device instance is unavailable.');
    }
    if (this.fastbootSession.device !== device) {
      throw new InstallerError('Fastboot device instance changed before factory flash.');
    }
    if (!device.device) {
      throw new InstallerError('Fastboot USB device handle is unavailable.');
    }
    if (!(file instanceof Blob)) {
      throw new InstallerError('Verified release file is not a Blob.');
    }
    if (file.size <= 0 && manifest.release.size > 0) {
      throw new InstallerError('Verified release file is empty.');
    }
    if (file.size !== manifest.release.size) {
      throw new InstallerError('Release file size does not match the manifest. Flash stopped before writing.');
    }
    if (!manifest.release || typeof manifest.release.id !== 'string') {
      throw new InstallerError('Release manifest details are unavailable.');
    }
    if (!this.isRuntimeReleaseVerified()) {
      throw new InstallerError('Release verification metadata is missing');
    }
    if (typeof device.flashFactoryZip !== 'function') {
      throw new InstallerError('Fastboot factory ZIP flash function is unavailable.');
    }
    if (!ZIP_WORKER_CONFIGURATION?.workerScripts?.inflate?.length) {
      throw new InstallerError('ZIP worker configuration is unavailable.');
    }
  }

  private assertFactoryFlashCallbacks(onReconnect: ReconnectCallback, onProgress: FactoryFlashCallback): void {
    if (typeof onReconnect !== 'function') {
      throw new InstallerError('Factory flash reconnect callback is unavailable.');
    }
    if (typeof onProgress !== 'function') {
      throw new InstallerError('Factory flash progress callback is unavailable.');
    }
  }

  private errorDiagnostics(error: unknown): Record<string, unknown> {
    const errorObject = error instanceof Error ? error : null;
    const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    return {
      errorName: errorObject?.name ?? typeof error,
      errorMessage: errorObject?.message ?? String(error),
      errorConstructorName: errorObject?.constructor?.name ?? typeof error,
      errorStack: errorObject?.stack ?? null,
      fastbootStatus: typeof errorRecord.status === 'string' ? errorRecord.status : null,
      bootloaderMessage: typeof errorRecord.bootloaderMessage === 'string' ? errorRecord.bootloaderMessage : null
    };
  }

  private logFactoryFlashError(error: unknown): void {
    const diagnostics = this.errorDiagnostics(error);
    const activity = this.flashWatchdog?.snapshot() ?? this.lastFlashActivity;
    const lastAction = activity.lastAction ?? getState().flash?.operation ?? null;
    const lastItem = activity.lastItem ?? getState().flash?.item ?? null;
    const lastOperation = activity.lastOperation ?? this.formatFactoryOperation(lastAction, lastItem);
    const details = {
      ...diagnostics,
      installerState: getState().installerState,
      factoryFlashActive: this.factoryFlashActive,
      action: lastAction,
      item: lastItem,
      lastAction,
      lastItem,
      lastProgress: activity.lastProgress ?? getState().flash?.rawProgress ?? null,
      lastOperation,
      lastSuccessfulOperation: activity.lastSuccessfulOperation ?? null,
      reconnectSequence: this.reconnectSequence
    };
    addLog('ERROR', 'Factory flash error', details, 'FLASH');
    addLog('ERROR', 'Factory flash stack', { stack: diagnostics.errorStack ?? '-' }, 'FLASH');
  }

  private formatFactoryOperation(action: string | null | undefined, item: string | null | undefined): string | null {
    if (!action) {
      return null;
    }
    if (action === 'flash' && item === 'radio') {
      return 'radio';
    }
    if (action === 'reboot' && item === 'bootloader') {
      return 'reboot-bootloader after radio';
    }
    if (action === 'flash' && item === 'avb_custom_key') {
      return 'avb_custom_key';
    }
    if (action === 'oem' && item === 'uart disable') {
      return 'uart disable';
    }
    if ((action === 'erase' || action === 'wipe') && (item === 'dpm_a' || item === 'dpm_b')) {
      return 'dpm erase';
    }
    if ((action === 'update' || action === 'check') && item === 'android-info') {
      return 'android-info check';
    }
    if (action === 'snapshot-update' && item === 'cancel') {
      return 'snapshot cancel';
    }
    if (action === 'flash' && item && /^(boot|dtbo|vendor_boot|vendor_kernel_boot|init_boot)(?:_[ab])?(?:\.img)?$/.test(item)) {
      return 'boot images';
    }
    if ((action === 'erase' || action === 'wipe') && item === 'userdata') {
      return 'userdata erase';
    }
    if ((action === 'erase' || action === 'wipe') && item === 'metadata') {
      return 'metadata erase';
    }
    const superMatch = item?.match(/^super(?:[_ -](\d+))?(?:\.img)?$/);
    if (action === 'flash' && superMatch) {
      return `super ${superMatch[1] ?? '?'}/16`;
    }
    if (action === 'wipe' && item === 'super') {
      return 'wipe-super';
    }
    if (action === 'wipe' && item === 'data') {
      return 'wipe-data';
    }
    if (action === 'reboot') {
      return item ? `reboot ${item}` : 'reboot';
    }
    if (action === 'flash') {
      return item ? `flash ${item}` : 'flash';
    }
    if (action === 'unpack') {
      return item ? `unpack ${item}` : 'unpack';
    }
    if (action === 'load') {
      return item ? `load ${item}` : 'load';
    }
    return item ? `${action} ${item}` : action;
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
    if (this.mockMode) {
      return;
    }
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
    if (!(file instanceof Blob)) {
      setReleaseStorageState({ releaseFileAvailable: false });
      throw new InstallerError('Verified release file is not a Blob.');
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

  private async executeFlashPlan(
    device: FastbootDeviceLike,
    packageBlob: Blob,
    plan: FlashPlan,
    attemptId: number,
    onProgress: FactoryFlashCallback
  ): Promise<void> {
    const outer = await openZipEntries(packageBlob);
    const nestedCache = new Map<string, { reader: Awaited<ReturnType<typeof openZipEntries>>['reader']; entries: Awaited<ReturnType<typeof openZipEntries>>['entries'] }>();
    try {
      for (let index = 0; index < plan.steps.length; index += 1) {
        if (!this.isActiveFlashAttempt(attemptId)) {
          return;
        }
        updatePersistedMetadata({ flashStepIndex: index });
        const step = plan.steps[index];
        await this.assertConnectedPixel(device);
        await this.executeFlashPlanStep(device, outer.entries, nestedCache, step, attemptId, onProgress);
      }
      updatePersistedMetadata({ flashStepIndex: plan.steps.length });
    } finally {
      await outer.reader.close();
      for (const nested of nestedCache.values()) {
        await nested.reader.close();
      }
    }
  }

  private async executeFlashPlanStep(
    device: FastbootDeviceLike,
    outerEntries: Awaited<ReturnType<typeof openZipEntries>>['entries'],
    nestedCache: Map<string, Awaited<ReturnType<typeof openZipEntries>>>,
    step: FlashPlanStep,
    attemptId: number,
    onProgress: FactoryFlashCallback
  ): Promise<void> {
    const commandLabel = this.flashPlanCommandLabel(step);
    try {
      if (step.type === 'command') {
        onProgress(step.action, step.item, 0);
        if (step.command === 'check:android-info.zip') {
          await readEntryBlob(outerEntries, 'android-info.zip');
          addLog('FASTBOOT', 'android-info.zip requirements checked', { command: step.command }, 'FASTBOOT');
          onProgress(step.action, step.item, 1);
          return;
        }
        addLog('FASTBOOT', `fastboot ${step.command}`, { command: step.command }, 'FASTBOOT');
        await device.runCommand(step.command);
        onProgress(step.action, step.item, 1);
        return;
      }
      if (step.type === 'erase') {
        onProgress('erase', step.item, 0);
        addLog('FASTBOOT', `fastboot erase ${step.partition}`, { command: `erase:${step.partition}` }, 'FASTBOOT');
        await device.runCommand(`erase:${step.partition}`);
        onProgress('erase', step.item, 1);
        return;
      }
      if (step.type === 'reboot') {
        onProgress('reboot', step.item, 0);
        addLog('RECONNECT', `reboot ${step.target}`, { target: step.target }, 'RECONNECT');
        await device.reboot(step.target, true, () => this.beginFlashReconnect(attemptId));
        await this.assertConnectedPixel(device);
        onProgress('reboot', step.item, 1);
        return;
      }

      const entries = step.source === 'nested' && step.nestedZip ? await this.getNestedEntries(outerEntries, nestedCache, step.nestedZip) : outerEntries;
      onProgress('unpack', step.item, 0);
      addLog('ZIP', `Preparing ${step.item}`, { filename: step.filename }, 'ZIP');
      const imageBlob = await readEntryBlob(entries, step.filename);
      onProgress('unpack', step.item, 1);
      onProgress('flash', step.item, 0);
      if (step.partition === 'avb_custom_key') {
        addLog('FLASH', 'Verified Boot key', undefined, 'FLASH');
      }
      if (step.partition === 'radio') {
        addLog('FLASH', 'radio start', { flashAttemptId: attemptId }, 'FLASH');
      }
      await device.flashBlob(step.partition, imageBlob, (progress) => {
        onProgress('flash', step.item, progress);
        const percent = this.normalizeFactoryProgress(progress);
        if (percent === 25 || percent === 50 || percent === 75 || percent === 100) {
          addLog('FLASH', `Flashing ${step.item} ${percent}%`, { partition: step.partition, filename: step.filename, percent }, 'FLASH');
          if (step.partition === 'radio') addLog('FLASH', `radio ${percent}%`, { percent, flashAttemptId: attemptId }, 'FLASH');
        }
      });
      if (step.partition === 'radio') {
        addLog('FLASH', 'radio complete', { flashAttemptId: attemptId }, 'FLASH');
      }
    } catch (error) {
      addLog('ERROR', 'Fastboot command failed', {
        stage: getState().installerState,
        command: commandLabel,
        response: this.errorDiagnostics(error)
      }, 'FASTBOOT');
      throw error;
    }
  }

  private async getNestedEntries(
    outerEntries: Awaited<ReturnType<typeof openZipEntries>>['entries'],
    nestedCache: Map<string, Awaited<ReturnType<typeof openZipEntries>>>,
    nestedZip: string
  ): Promise<Awaited<ReturnType<typeof openZipEntries>>['entries']> {
    const cached = nestedCache.get(nestedZip);
    if (cached) return cached.entries;
    const blob = await readEntryBlob(outerEntries, nestedZip);
    const opened = await openZipEntries(blob);
    nestedCache.set(nestedZip, opened);
    return opened.entries;
  }

  private flashPlanCommandLabel(step: FlashPlanStep): string {
    if (step.type === 'flash') return `flash ${step.partition} ${step.filename}`;
    if (step.type === 'erase') return `erase ${step.partition}`;
    if (step.type === 'reboot') return `reboot ${step.target}`;
    return step.command;
  }

  private async manualReconnectDuringFlash(): Promise<void> {
    if (!this.factoryReconnectPending) {
      setStatusMessage('Installation is running. Reconnect Pixel is disabled until the Pixel restarts.');
      return;
    }
    if (this.reconnectBusy) {
      setStatusMessage('Connection restored. Waiting for installation...');
      return;
    }
    const attemptId = this.currentFlashAttemptId;
    if (!this.isActiveFlashAttempt(attemptId)) {
      return;
    }
    const device = this.requireDevice();
    const sequence = this.reconnectSequence;
    this.logReconnect('Reconnect Pixel clicked', sequence, { flashAttemptId: attemptId });
    this.logReconnect('connect() start', sequence, { flashAttemptId: attemptId });
    this.factoryWaitingForFlashResume = true;
    this.reconnectBusy = true;
    try {
      await device.connect();
      if (!this.isActiveFlashAttempt(attemptId)) {
        return;
      }
      this.logReconnect('connect() success', sequence, { flashAttemptId: attemptId });
      if (this.factoryWaitingForFlashResume && this.reconnectSequence === sequence && this.isActiveFlashAttempt(attemptId)) {
        this.clearFlashReconnectReminder();
        addLog('FLASH', 'waiting for next callback', { flashAttemptId: attemptId, reconnectSequence: sequence }, 'FLASH');
        if (getState().installerState === 'WAITING_FOR_RECONNECT') {
          transitionInstallerState('WAITING_FOR_FLASH_RESUME', 'Connection restored. Waiting for installation...');
        } else {
          setStatusMessage('Connection restored. Waiting for installation...');
        }
      }
    } catch (error) {
      this.factoryWaitingForFlashResume = false;
      this.reconnectBusy = false;
      const message = userMessageForError(error);
      addLog('ERROR', 'Fastboot reconnect failed', { reconnectSequence: sequence, lastConnectError: message }, 'RECONNECT');
      setStatusMessage('Reconnect failed. Keep the Pixel connected and tap Reconnect again.');
      if (isDeviceSelectionCancelled(error)) {
        setStatusMessage('Reconnect the Pixel to continue installation.');
        return;
      }
      if (error instanceof WrongDeviceError) {
        setStatusMessage('Different Pixel detected. Reconnect the original device.');
        return;
      }
    }
  }

  private beginFlashReconnect(attemptId: number): void {
    if (!this.isActiveFlashAttempt(attemptId)) {
      return;
    }
    this.reconnectSequence += 1;
    const sequence = this.reconnectSequence;
    this.factoryReconnectPending = true;
    this.factoryWaitingForFlashResume = false;
    this.reconnectBusy = false;
    this.disposeReconnectManager();
    this.stopWatchdogs();
    this.logReconnect('requested after radio', sequence, { factoryFlashActive: true, factoryReconnectPending: true, flashAttemptId: attemptId, lastItem: this.lastFlashActivity.lastItem });
    this.logReconnect('waiting for manual click', sequence, { factoryFlashActive: true, factoryReconnectPending: true, flashAttemptId: attemptId });
    this.logReconnect('Pixel restarted', sequence, { factoryFlashActive: true, factoryReconnectPending: true, flashAttemptId: attemptId });
    this.logReconnect('Waiting for manual reconnect', sequence, { factoryFlashActive: true, factoryReconnectPending: true, flashAttemptId: attemptId });
    transitionInstallerState('WAITING_FOR_RECONNECT', 'Pixel restarted into bootloader.');
    setStatusMessage('Pixel restarted into bootloader.');
    this.flashReconnectReminder = globalThis.setTimeout(() => {
      if (this.isActiveFlashAttempt(attemptId) && this.factoryReconnectPending && this.reconnectSequence === sequence && getState().installerState === 'WAITING_FOR_RECONNECT') {
        setStatusMessage('Still waiting for the Pixel.');
      }
    }, 60_000);
  }

  private endFlashReconnect(): void {
    this.factoryFlashActive = false;
    this.factoryReconnectPending = false;
    this.factoryWaitingForFlashResume = false;
    this.reconnectBusy = false;
    this.clearFlashReconnectReminder();
  }

  private clearFlashReconnectReminder(): void {
    if (this.flashReconnectReminder) {
      globalThis.clearTimeout(this.flashReconnectReminder);
      this.flashReconnectReminder = null;
    }
  }

  private startFlashWatchdog(): void {
    if (this.factoryReconnectPending || this.flashWatchdog) {
      return;
    }
    this.flashWatchdog = new FlashActivityWatchdog(
      (message, details) => addLog('WARN', message, details, 'FLASH'),
      (message) => setStatusMessage(message)
    );
  }

  private startZipWatchdog(): void {
    if (this.factoryReconnectPending || this.zipWatchdog) {
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

  private logReconnect(message: string, reconnectSequence?: number, details?: Record<string, unknown>): void {
    addLog('RECONNECT', message, reconnectSequence ? { ...details, reconnectSequence } : details, 'RECONNECT');
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
    const superMatch = item?.match(/^super(?:[_ -](\d+))?(?:\.img)?$/);
    if (action === 'load' && item === 'package') {
      return 'Loading installation package...';
    }
    if (action === 'unpack' && item === 'images') {
      return 'Preparing images...';
    }
    if (action === 'reboot') {
      return visibleItem ? `Restarting ${visibleItem}...` : 'Restarting Pixel...';
    }
    if (action === 'wipe') {
      return visibleItem ? `Wiping ${visibleItem}...` : 'Wiping data...';
    }
    if (action === 'flash' && item === 'avb_custom_key') {
      return 'Installing Verified Boot key...';
    }
    if (action === 'flash' && superMatch) {
      return `Flashing super ${superMatch[1] ?? '?'}/16...`;
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
    const device = await this.getSessionDevice();
    await device.connect();
    const product = await device.getVariable('product');
    const serial = await device.getVariable('serialno');
    const unlocked = await device.getVariable('unlocked');
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
    this.assertRealInstallerAllowed('createLoggedDevice');
    const raw = await (this.dependencies.createDevice?.() ?? createFastbootDevice());
    return this.wrapFastbootDevice(raw);
  }

  private async getSessionDevice(): Promise<FastbootDeviceLike> {
    return this.fastbootSession.getDevice();
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
      flashBlob: async (partition: string, blob: Blob, onProgress?: (progress: number) => void) => {
        this.flashWatchdog?.markFastbootActivity();
        await device.flashBlob(partition, blob, onProgress);
        this.flashWatchdog?.markFastbootActivity();
      },
      flashFactoryZip: async (blob: Blob, wipe: boolean, onReconnect: ReconnectCallback, onProgress?: FactoryFlashCallback) => {
        await device.flashFactoryZip(blob, wipe, onReconnect, onProgress);
      }
    };
  }

  private requireDevice(): FastbootDeviceLike {
    if (!this.fastbootSession.device) {
      throw new InstallerError('No Pixel is connected.');
    }
    return this.fastbootSession.device;
  }

  private requireManifest(): ReleaseManifest {
    if (!this.manifest) {
      const stateRelease = getState().release;
      if (stateRelease) {
        this.manifest = stateRelease;
      }
    }
    if (!this.manifest) {
      throw new InstallerError('No installation image manifest is loaded.');
    }
    return this.manifest;
  }

  private requireReleaseBlob(): Blob {
    if (!this.releaseBlob) {
      throw new InstallerError('No installation image has been downloaded.');
    }
    return this.releaseBlob;
  }

  private assertRealInstallerAllowed(operation: string): void {
    if (isTestMode()) {
      throw new InstallerError(`Blocked real installer operation during Test Installer mode: ${operation}`);
    }
  }

  private async restoreStoredReleaseState(): Promise<void> {
    this.assertRealInstallerAllowed('restoreStoredReleaseState');
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
        setProgress(100);
        setVerifyProgress({
          state: 'verified',
          verifiedBytes: cached.file.size,
          totalBytes: manifest.release.size,
          percent: 100,
          expectedSha256: manifest.release.sha256,
          actualSha256: manifest.release.sha256,
          metadataVerified: true,
          fileAvailable: true,
          fileSize: cached.file.size
        });
        addLog('VERIFY', 'Image already verified', undefined, 'VERIFY');
        transitionInstallerState('VERIFIED', 'Image already verified ✓');
        await this.refreshFlashReadiness();
      } else if (cached.complete) {
        this.releaseBlob = cached.file;
        transitionInstallerState('DOWNLOADED', 'Release already downloaded.');
      } else if (cached.file.size > 0) {
        setStatusMessage('Partial installation image found.');
        addLog('info', 'Partial installation image found.');
      }
    } catch (error) {
      addLog('DEBUG', `Stored release check skipped: ${userMessageForError(error)}`);
    }
  }

  private async restoreMockReleaseState(): Promise<void> {
    const { MOCK_RELEASE_MANIFEST } = await this.getMockDeviceModule();
    this.manifest = MOCK_RELEASE_MANIFEST;
    setRelease(MOCK_RELEASE_MANIFEST);
    setCacheKey(releaseKey(MOCK_RELEASE_MANIFEST));
    setReleaseStorageState({ releaseComplete: false, releaseVerified: false, releaseFileAvailable: false });
    addLog('INFO', 'Mock Pixel test mode active', undefined, 'DEVICE');
  }

  private async downloadMockRelease(): Promise<void> {
    const { MOCK_RELEASE_MANIFEST, mockDownloadProgress, saveMockRelease } = await this.getMockDeviceModule();
    this.manifest = MOCK_RELEASE_MANIFEST;
    setRelease(MOCK_RELEASE_MANIFEST);
    setCacheKey(releaseKey(MOCK_RELEASE_MANIFEST));
    transitionInstallerState('DOWNLOADING', 'Downloading mock release.');
    for (const percent of [0, 25, 50, 75, 100]) {
      const progress = mockDownloadProgress(percent);
      setDownloadProgress(progress);
      setProgress(percent);
      addLog('DOWNLOAD', `${percent}%`, { percent }, 'DOWNLOAD');
    }
    this.releaseBlob = await saveMockRelease(this.store);
    setReleaseStorageState({ releaseComplete: true, releaseVerified: false, releaseFileAvailable: true });
    transitionInstallerState('DOWNLOADED', 'Mock release downloaded.');
  }

  private async verifyMockRelease(): Promise<void> {
    const { MOCK_RELEASE_SHA256, markMockReleaseVerified } = await this.getMockDeviceModule();
    const manifest = this.requireManifest();
    this.requireReleaseBlob();
    transitionInstallerState('VERIFYING', 'Verifying mock release SHA-256.');
    for (const percent of [0, 50, 100]) {
      setProgress(percent);
      addLog('VERIFY', `${percent}%`, { percent }, 'VERIFY');
    }
    await markMockReleaseVerified(this.store);
    this.verifiedSha256 = MOCK_RELEASE_SHA256;
    setVerifiedDigest(MOCK_RELEASE_SHA256);
    setDownloadProgress({
      releaseId: manifest.release.id,
      downloadedBytes: manifest.release.size,
      totalBytes: manifest.release.size,
      percent: 100,
      storedLocally: true,
      verified: true,
      status: 'Mock release SHA-256 verified.'
    });
    setReleaseStorageState({ releaseComplete: true, releaseVerified: true, releaseFileAvailable: true });
    this.releaseBlob = null;
    addLog('VERIFY', 'SHA verification: success', undefined, 'VERIFY');
    transitionInstallerState('VERIFIED', 'Mock release SHA-256 verified.');
    await this.refreshFlashReadiness();
  }

  private async getMockDeviceModule(): Promise<typeof import('./mock-device')> {
    if (!import.meta.env.DEV) {
      throw new InstallerError('Mock mode is unavailable in production.');
    }
    return import('./mock-device');
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

  private fail(error: unknown, userFacingMessage?: string): void {
    if (isDeviceSelectionCancelled(error)) {
      addLog('WARN', 'requestDevice cancelled', { errorClass: 'NotFoundError' }, 'USB');
      this.disposeReconnectManager();
      returnToIdle('No Pixel selected. Put the Pixel 10 in Fastboot Mode and try again.');
      return;
    }

    const message = userFacingMessage ?? userMessageForError(error);
    const errorClass = error instanceof Error ? error.name : typeof error;
    const flashActivity = this.flashWatchdog?.snapshot() ?? this.lastFlashActivity;

    const stage = getState().statusMessage || getState().installerState;
    const item = flashActivity?.lastItem ?? getState().flash?.item ?? null;
    const mode = getState().flash?.operation === 'unpack' ? 'Preparing files' : getState().deviceInfo.bootloader || 'Unknown';
    const sessionDevice = this.fastbootSession.device;
    const connection = sessionDevice?.isConnected === false ? 'disconnected' : sessionDevice ? 'connected' : 'not connected';
    addLog('ERROR', 'Installation error', {
      ...this.errorDiagnostics(error),
      stage,
      item,
      mode,
      connection,
      message,
      errorClass,
      installerState: getState().installerState,
      factoryFlashActive: this.factoryFlashActive,
      factoryWaitingForFlashResume: this.factoryWaitingForFlashResume,
      action: flashActivity.lastAction ?? getState().flash?.operation ?? null,
      lastAction: flashActivity.lastAction ?? getState().flash?.operation ?? null,
      lastItem: flashActivity.lastItem ?? getState().flash?.item ?? null,
      lastProgress: flashActivity.lastProgress ?? getState().flash?.rawProgress ?? null,
      lastOperation: flashActivity.lastOperation ?? this.formatFactoryOperation(flashActivity.lastAction ?? getState().flash?.operation, flashActivity.lastItem ?? getState().flash?.item),
      lastSuccessfulOperation: flashActivity.lastSuccessfulOperation ?? null,
      reconnectSequence: this.reconnectSequence
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
