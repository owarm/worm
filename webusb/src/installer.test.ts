import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobStore } from './blob-store';
import { sha256Blob } from './crypto';
import { FlashActivityWatchdog, Installer, ReconnectManager, ZipUnpackWatchdog, clearZipWorkerFailure, recordZipWorkerFailure } from './installer';
import { ZIP_INFLATE_WORKER_URL, ZIP_PAKO_INFLATE_URL, ZIP_WORKER_CONFIGURATION } from './fastboot';
import { metadataFromManifest, releaseFilename, releaseKey } from './release';
import { __resetStateForTests, getState, setDeviceInfo, setLockAcknowledged, setRelease, subscribe, transitionInstallerState } from './state';
import { __resetLoggerForTests } from './logger';
import { __uiTest, isEnabled } from './ui';
import { MockFastbootDevice } from './mock-fastboot';
import type { CachedRelease, ReleaseManifest, ReleaseMetadata } from './types';
import type { FastbootDeviceLike, FastbootCommandResponse, FactoryFlashCallback, ReconnectCallback } from './fastboot';
import { WrongDeviceError } from './types';

const emptySha256ForTests = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const manifest: ReleaseManifest = {
  schema: 1,
  channel: 'stable',
  device: 'frankel',
  release: {
    id: '2026091200',
    file: '/releases/frankel-install-2026091200.zip',
    sha256: emptySha256ForTests,
    size: 0
  }
};

const manifestForBlob = async (blob: Blob, overrides: Partial<ReleaseManifest['release']> = {}): Promise<ReleaseManifest> => ({
  ...manifest,
  release: {
    ...manifest.release,
    id: overrides.id ?? 'streamed-release',
    sha256: overrides.sha256 ?? (await sha256Blob(blob)),
    size: overrides.size ?? blob.size,
    file: overrides.file ?? '/releases/streamed-release.zip'
  }
});

class MemoryStore extends BlobStore {
  deletedKeys: string[] = [];
  private records = new Map<string, CachedRelease>();
  private missingFiles = new Set<string>();
  private writableManifest: ReleaseManifest | null = null;

  constructor(seed?: CachedRelease, seedManifest: ReleaseManifest = manifest) {
    super();
    if (seed) {
      this.records.set(releaseKey(seedManifest), seed);
    }
  }

  override async init(): Promise<void> {}

  override async saveRelease(key: string, blob: Blob, metadata: ReleaseMetadata): Promise<void> {
    this.records.set(key, { blob, metadata });
    this.missingFiles.delete(key);
  }

  override async saveMetadata(key: string, metadata: ReleaseMetadata): Promise<void> {
    const existing = this.records.get(key);
    this.records.set(key, { blob: existing?.blob ?? new Blob(), metadata });
  }

  override async getMetadata(key: string): Promise<ReleaseMetadata | null> {
    return this.records.get(key)?.metadata ?? null;
  }

  override async getRelease(key: string): Promise<CachedRelease | null> {
    return this.records.get(key) ?? null;
  }

  override async getReleaseFile(releaseManifest: ReleaseManifest): Promise<File | null> {
    if (this.missingFiles.has(releaseKey(releaseManifest))) {
      return null;
    }
    const record = this.records.get(releaseKey(releaseManifest));
    if (!record) {
      return null;
    }
    return new File([record.blob], releaseFilename(releaseManifest), { type: 'application/zip' });
  }

  override async getWritable(releaseManifest: ReleaseManifest): Promise<FileSystemWritableFileStream> {
    this.writableManifest = releaseManifest;
    let parts: BlobPart[] = [];
    let position = 0;
    const writeBlob = async (): Promise<void> => {
      const blob = new Blob(parts);
      const key = releaseKey(releaseManifest);
      const metadata = this.records.get(key)?.metadata ?? metadataFromManifest(releaseManifest);
      this.records.set(key, { blob, metadata });
    };
    return {
      locked: false,
      abort: async () => undefined,
      close: writeBlob,
      getWriter: (() => {
        throw new Error('not used');
      }) as FileSystemWritableFileStream['getWriter'],
      seek: async (offset: number) => {
        position = offset;
      },
      truncate: async (size: number) => {
        parts = size === 0 ? [] : [new Blob(parts).slice(0, size)];
        position = size;
      },
      write: async (data: FileSystemWriteChunkType) => {
        const chunk = data instanceof Blob || typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data : new Uint8Array();
        const current = new Blob(parts);
        const prefix = current.slice(0, position);
        parts = [prefix, chunk];
        position += chunk instanceof Blob ? chunk.size : typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      }
    };
  }

  override async ensureEnoughStorage(): Promise<void> {}

  override async deleteRelease(key: string): Promise<void> {
    this.deletedKeys.push(key);
    this.records.delete(key);
  }

  override async clear(): Promise<void> {
    this.records.clear();
  }

  removeFile(releaseManifest: ReleaseManifest): void {
    this.missingFiles.add(releaseKey(releaseManifest));
  }
}

class FakeFastbootDevice implements FastbootDeviceLike {
  product = 'frankel';
  serial = 'SERIAL1';
  unlocked = 'yes';
  snapshot = 'none';
  flashCalled = false;
  flashedBlob: Blob | null = null;
  lockCalled = false;
  rebootCalled = false;
  getVariableCalls: string[] = [];
  runCommandCalls: string[] = [];
  device: USBDevice | null = { opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' };

  async connect(): Promise<void> {}

  async getVariable(varName: string): Promise<string | undefined> {
    this.getVariableCalls.push(varName);
    if (varName === 'product') return this.product;
    if (varName === 'serialno') return this.serial;
    if (varName === 'unlocked') return this.unlocked;
    if (varName === 'snapshot-update-status') return this.snapshot;
    if (varName === 'current-slot') return 'a';
    if (varName === 'is-userspace') return 'no';
    if (varName === 'max-download-size') return '0x10000000';
    return undefined;
  }

  async runCommand(command: string): Promise<FastbootCommandResponse> {
    this.runCommandCalls.push(command);
    if (command === 'flashing lock') {
      this.lockCalled = true;
      this.unlocked = 'no';
    }
    return { text: '', dataSize: null };
  }

  async waitForDisconnect(): Promise<void> {}

  async waitForConnect(_onReconnect?: ReconnectCallback): Promise<void> {}

  async reboot(_target?: string, _wait?: boolean, _onReconnect?: ReconnectCallback): Promise<void> {
    this.rebootCalled = true;
  }

  async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalled = true;
    this.flashedBlob = blob;
    await onReconnect();
    onProgress?.('flash', 'boot', 1);
  }
}

class CountingReconnectFastbootDevice extends FakeFastbootDevice {
  flashCalls = 0;

  override async flashFactoryZip(
    blob: Blob,
    wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    await super.flashFactoryZip(blob, wipe, onReconnect, onProgress);
  }
}

class LibraryReconnectFastbootDevice extends FakeFastbootDevice {
  flashCalls = 0;
  connectCalls = 0;
  progressAfterReconnect = true;
  preReconnectProgress: Array<[string, string | null, number | null]> = [];
  isUserspaceAfterReconnect = false;
  requestedDevice = false;
  private waitResolve: (() => void) | null = null;

  override async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.connectCalls > 1) {
      this.waitResolve?.();
    }
  }

  override async waitForConnect(onReconnect?: ReconnectCallback): Promise<void> {
    onReconnect?.();
    if (this.connectCalls <= 1) {
      await new Promise<void>((resolve) => {
        this.waitResolve = resolve;
      });
    }
  }

  override async getVariable(varName: string): Promise<string | undefined> {
    if (varName === 'is-userspace' && this.isUserspaceAfterReconnect && this.connectCalls > 1) return 'yes';
    return super.getVariable(varName);
  }

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    this.flashCalled = true;
    this.flashedBlob = blob;
    for (const [action, item, progress] of this.preReconnectProgress) {
      onProgress?.(action, item, progress);
    }
    await this.waitForConnect(onReconnect);
    if (this.progressAfterReconnect) {
      onProgress?.('flash', 'boot', 1);
    }
  }
}

class RadioReconnectFastbootDevice extends FakeFastbootDevice {
  flashCalls = 0;
  connectCalls = 0;
  reconnectConnectCalls = 0;
  private pendingReconnect: (() => void) | null = null;
  private nextProgress: (() => void) | null = null;
  private finishFlash: (() => void) | null = null;

  override async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.pendingReconnect) {
      this.reconnectConnectCalls += 1;
      const resolve = this.pendingReconnect;
      this.pendingReconnect = null;
      resolve();
    }
  }

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    this.flashCalled = true;
    this.flashedBlob = blob;
    onProgress?.('flash', 'radio', 0.25);
    onProgress?.('flash', 'radio', 0.5);
    onProgress?.('flash', 'radio', 0.75);
    onProgress?.('flash', 'radio', 1);
    await onReconnect();
    await new Promise<void>((resolve) => {
      this.pendingReconnect = resolve;
    });
    await new Promise<void>((resolve) => {
      this.nextProgress = resolve;
    });
    onProgress?.('flash', 'avb_custom_key', 1);
    await new Promise<void>((resolve) => {
      this.finishFlash = resolve;
    });
  }

  resolveFlash(): void {
    this.finishFlash?.();
    this.finishFlash = null;
  }

  emitNextProgress(): void {
    this.nextProgress?.();
    this.nextProgress = null;
  }
}

class RadioReconnectRejectBeforeProgressFastbootDevice extends RadioReconnectFastbootDevice {
  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    this.flashCalled = true;
    this.flashedBlob = blob;
    onProgress?.('flash', 'radio', 1);
    await onReconnect();
    await new Promise<void>((resolve) => {
      const originalConnect = this.connect.bind(this);
      this.connect = async () => {
        await originalConnect();
        resolve();
      };
    });
    throw new TypeError("Cannot read properties of undefined (reading 'getVariable')");
  }
}

class MultiReconnectFastbootDevice extends FakeFastbootDevice {
  flashCalls = 0;
  connectCalls = 0;
  reconnectConnectCalls = 0;
  reconnectCallbacks = 0;
  private pendingReconnect: (() => void) | null = null;

  constructor(private readonly reconnects = 3) {
    super();
  }

  override async connect(): Promise<void> {
    if (this.flashCalls > 0 && this.pendingReconnect) {
      this.reconnectConnectCalls += 1;
      const resolve = this.pendingReconnect;
      this.pendingReconnect = null;
      resolve();
      return;
    }
    this.connectCalls += 1;
  }

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    this.flashCalled = true;
    this.flashedBlob = blob;
    for (let index = 1; index <= this.reconnects; index += 1) {
      this.reconnectCallbacks += 1;
      await onReconnect();
      await new Promise<void>((resolve) => {
        this.pendingReconnect = resolve;
      });
      onProgress?.('flash', `boot-${index}`, 1);
    }
  }
}

class ProgressFastbootDevice extends FakeFastbootDevice {
  progressEvents: Array<[string, string | null, number | null]> = [];

  constructor(events: Array<[string, string | null, number | null]>) {
    super();
    this.progressEvents = events;
  }

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    _onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalled = true;
    this.flashedBlob = blob;
    for (const [action, item, progress] of this.progressEvents) {
      onProgress?.(action, item, progress);
    }
  }
}

class RejectingFastbootDevice extends FakeFastbootDevice {
  constructor(private readonly flashError: Error) {
    super();
  }

  override async flashFactoryZip(): Promise<void> {
    this.flashCalled = true;
    throw this.flashError;
  }
}

class NullUsbHandleFastbootDevice extends FakeFastbootDevice {
  override device: USBDevice | null = null;
}

class UndefinedProgressFastbootDevice extends FakeFastbootDevice {
  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    _onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalled = true;
    this.flashedBlob = blob;
    onProgress?.(undefined, undefined, undefined);
  }
}

class ThisCheckingFastbootDevice extends FakeFastbootDevice {
  override async getVariable(varName: string): Promise<string | undefined> {
    if (!(this instanceof ThisCheckingFastbootDevice)) {
      throw new Error('getVariable lost this');
    }
    return super.getVariable(varName);
  }

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    _onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    if (!(this instanceof ThisCheckingFastbootDevice)) {
      throw new Error('flashFactoryZip lost this');
    }
    this.flashCalled = true;
    this.flashedBlob = blob;
    onProgress?.('flash', 'boot', 1);
  }
}

class LateCallbackRejectFastbootDevice extends FakeFastbootDevice {
  capturedReconnect: ReconnectCallback | null = null;
  capturedProgress: FactoryFlashCallback | null = null;

  override async flashFactoryZip(
    _blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalled = true;
    this.capturedReconnect = onReconnect;
    this.capturedProgress = onProgress ?? null;
    throw new TypeError("Cannot read properties of undefined (reading 'getVariable')");
  }
}

class ReconnectThenRejectFastbootDevice extends FakeFastbootDevice {
  flashCalls = 0;
  connectCalls = 0;
  reconnectConnectCalls = 0;
  private pendingReconnect: (() => void) | null = null;

  override async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.pendingReconnect) {
      this.reconnectConnectCalls += 1;
      const resolve = this.pendingReconnect;
      this.pendingReconnect = null;
      resolve();
    }
  }

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    this.flashCalled = true;
    this.flashedBlob = blob;
    onProgress?.('load', 'package', 0);
    onProgress?.('flash', 'radio', 0.5);
    await onReconnect();
    await new Promise<void>((resolve) => {
      this.pendingReconnect = resolve;
    });
    onProgress?.('flash', 'radio', 1);
    throw new TypeError("Cannot read properties of undefined (reading 'getVariable')");
  }
}

class RetryFastbootDevice extends FakeFastbootDevice {
  flashCalls = 0;
  failFirst = true;

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    _onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    this.flashCalled = true;
    this.flashedBlob = blob;
    onProgress?.('flash', `boot-${this.flashCalls}`, 1);
    if (this.failFirst) {
      this.failFirst = false;
      throw new TypeError("Cannot read properties of undefined (reading 'get')");
    }
  }
}

class RejectingAfterProgressFastbootDevice extends ProgressFastbootDevice {
  constructor(events: Array<[string, string | null, number | null]>, private readonly flashError: Error) {
    super(events);
  }

  override async flashFactoryZip(
    blob: Blob,
    wipe: boolean,
    onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    await super.flashFactoryZip(blob, wipe, onReconnect, onProgress);
    throw this.flashError;
  }
}

class PendingUnpackFastbootDevice extends FakeFastbootDevice {
  flashCalls = 0;

  override async flashFactoryZip(
    blob: Blob,
    _wipe: boolean,
    _onReconnect: ReconnectCallback,
    onProgress?: FactoryFlashCallback
  ): Promise<void> {
    this.flashCalls += 1;
    this.flashCalled = true;
    this.flashedBlob = blob;
    onProgress?.('unpack', 'bootloader', 0);
    return new Promise(() => undefined);
  }
}

class FastbootdProgressDevice extends ProgressFastbootDevice {
  override async getVariable(varName: string): Promise<string | undefined> {
    if (varName === 'is-userspace') return 'yes';
    return super.getVariable(varName);
  }
}

class FastbootdReconnectDevice extends FakeFastbootDevice {
  override async getVariable(varName: string): Promise<string | undefined> {
    if (varName === 'is-userspace') return 'yes';
    return super.getVariable(varName);
  }
}

class ConnectErrorFastbootDevice extends FakeFastbootDevice {
  constructor(private readonly error: unknown) {
    super();
  }

  override async connect(): Promise<void> {
    throw this.error;
  }
}

const installFetchManifest = (releaseManifest: ReleaseManifest = manifest, releaseBlob: Blob = new Blob()): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/manifest.json') {
        return new Response(JSON.stringify(releaseManifest), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(releaseBlob, { status: 200, headers: { 'content-length': String(releaseBlob.size) } });
    })
  );
};

const installUsb = (): void => {
  const usb = {
    getDevices: async () => [{ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }],
    requestDevice: async () => ({ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  } satisfies USB;
  vi.stubGlobal('navigator', { usb });
};

const installControlledUsb = (options: {
  getDevices?: () => USBDevice[] | Promise<USBDevice[]>;
  requestDevice?: () => USBDevice | Promise<USBDevice>;
} = {}): { disconnect: (device?: USBDevice) => void } => {
  const listeners = new Set<(event: USBConnectionEvent) => void>();
  const defaultDevice = { opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' } as USBDevice;
  const usb = {
    getDevices: async () => options.getDevices?.() ?? [defaultDevice],
    requestDevice: async () => options.requestDevice?.() ?? defaultDevice,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'disconnect' && typeof listener === 'function') {
        listeners.add(listener as (event: USBConnectionEvent) => void);
      }
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'disconnect' && typeof listener === 'function') {
        listeners.delete(listener as (event: USBConnectionEvent) => void);
      }
    }
  } satisfies USB;
  vi.stubGlobal('navigator', { usb });
  return {
    disconnect: (device = defaultDevice) => {
      for (const listener of listeners) {
        listener({ device } as USBConnectionEvent);
      }
    }
  };
};

const connectInstaller = async (installer: Installer): Promise<void> => {
  await installer.init();
  await installer.connect(false);
};

const moveToUnlocked = (): void => {
  transitionInstallerState('CONNECTING');
  transitionInstallerState('CONNECTED');
  transitionInstallerState('DEVICE_VERIFIED');
  transitionInstallerState('UNLOCKED');
};

describe('installer orchestration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearZipWorkerFailure();
  });

  beforeEach(() => {
    __resetLoggerForTests();
    __resetStateForTests();
    installFetchManifest();
    installUsb();
    vi.stubGlobal('crypto', crypto);
  });

  it('accepts a valid cached release', async () => {
    const store = new MemoryStore({ blob: new Blob(), metadata: metadataFromManifest(manifest, 0, true, true) });
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store });

    await connectInstaller(installer);
    await installer.downloadWormOs();

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().verifiedDigest).toBe(emptySha256ForTests);
  });

  it('keeps the real GrapheneOS Fastboot factory ZIP API available without startup log spam', async () => {
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store: new MemoryStore() });

    await connectInstaller(installer);

    expect(getState().fastbootInspection).toMatchObject({
      flashFactoryZipSignature: 'FastbootDevice.flashFactoryZip(blob, wipe, onReconnect, onProgress)',
      configureZip: ZIP_WORKER_CONFIGURATION,
      zipWorkers: [ZIP_INFLATE_WORKER_URL, ZIP_PAKO_INFLATE_URL]
    });
    expect(getState().logs.some((entry) => entry.message === 'configureZip real configuration')).toBe(false);
  });

  it('deletes corrupted cache and redownloads', async () => {
    const store = new MemoryStore({ blob: new Blob(['corrupt']), metadata: metadataFromManifest(manifest, 7, true, false) });
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store });

    await connectInstaller(installer);
    await installer.downloadWormOs();

    expect(store.deletedKeys).toEqual([]);
    expect(getState().installerState).toBe('DOWNLOADED');
  });

  it('blocks flash when bootloader is not unlocked', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    device.unlocked = 'no';
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(false);
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Bootloader is locked');
  });

  it('verified release enables Flash', async () => {
    const store = new MemoryStore({ blob: new Blob(), metadata: metadataFromManifest(manifest, 0, true, true) });
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store });

    await connectInstaller(installer);
    await installer.downloadWormOs();

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().releaseComplete).toBe(true);
    expect(getState().releaseVerified).toBe(true);
    expect(getState().releaseFileAvailable).toBe(true);
    expect(isEnabled('flash', getState())).toBe(true);
  });

  it('verify progresses from 0 to 100, finalizes SHA, persists VERIFIED metadata, and rerenders state', async () => {
    const releaseBlob = new Blob(['worm-image']);
    const releaseManifest = await manifestForBlob(releaseBlob);
    installFetchManifest(releaseManifest, releaseBlob);
    const store = new MemoryStore(undefined, releaseManifest);
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store });
    const seenStates: string[] = [];
    const seenVerifyPercents: number[] = [];
    const unsubscribe = subscribe((state) => {
      seenStates.push(state.installerState);
      seenVerifyPercents.push(state.verify.percent);
    });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    unsubscribe();

    const metadata = await store.getMetadata(releaseKey(releaseManifest));
    expect(seenStates).toContain('VERIFYING');
    expect(seenStates).toContain('VERIFIED');
    expect(seenVerifyPercents).toContain(0);
    expect(seenVerifyPercents).toContain(100);
    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().statusMessage).toBe('Image verified ✓');
    expect(getState().verify.actualSha256).toBe(releaseManifest.release.sha256);
    expect(metadata).toMatchObject({
      complete: true,
      verified: true,
      expectedSha256: releaseManifest.release.sha256,
      expectedSize: releaseManifest.release.size
    });
  });

  it('invalid SHA moves to ERROR, clears metadata verified, and keeps expected/actual hashes in debug state', async () => {
    const releaseBlob = new Blob(['corrupt-image']);
    const releaseManifest = await manifestForBlob(releaseBlob, { sha256: emptySha256ForTests });
    installFetchManifest(releaseManifest, releaseBlob);
    const store = new MemoryStore(undefined, releaseManifest);
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();

    const metadata = await store.getMetadata(releaseKey(releaseManifest));
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Image verification failed.');
    expect(getState().releaseVerified).toBe(false);
    expect(isEnabled('flash', getState())).toBe(false);
    expect(getState().verify.expectedSha256).toBe(emptySha256ForTests);
    expect(getState().verify.actualSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata?.verified).toBe(false);
  });

  it('cached verified release skips redundant SHA verify', async () => {
    const releaseBlob = new Blob(['already-verified']);
    const releaseManifest = await manifestForBlob(releaseBlob);
    installFetchManifest(releaseManifest, releaseBlob);
    const streamSpy = vi.spyOn(Blob.prototype, 'stream');
    const store = new MemoryStore(
      { blob: releaseBlob, metadata: metadataFromManifest(releaseManifest, releaseBlob.size, true, true) },
      releaseManifest
    );
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store });

    await connectInstaller(installer);
    await installer.downloadWormOs();

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().statusMessage).toBe('Image already verified ✓');
    expect(getState().verify.percent).toBe(100);
    expect(getState().logs.some((entry) => entry.message === 'Image already verified')).toBe(true);
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('verified plus disconnected keeps VERIFIED and disables Flash until the same Pixel reconnects without reverify', async () => {
    const devices = [new FakeFastbootDevice(), new FakeFastbootDevice()];
    const installer = new Installer({ createDevice: async () => devices.shift() ?? new FakeFastbootDevice(), store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    setDeviceInfo({ serial: 'Not connected' });
    await (installer as unknown as { refreshFlashReadiness: () => Promise<unknown> }).refreshFlashReadiness();

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().releaseVerified).toBe(true);
    expect(isEnabled('flash', getState())).toBe(false);
    expect(getState().statusMessage).toBe('Image verified ✓ Reconnect your device to continue.');

    await installer.reconnectManual();

    expect(getState().installerState).toBe('VERIFIED');
    expect(isEnabled('flash', getState())).toBe(true);
    expect(getState().logs.filter((entry) => entry.message === 'Image verification started')).toHaveLength(1);
  });

  it('Wake Lock failure does not block verification', async () => {
    installUsb();
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    vi.stubGlobal('navigator', {
      usb: navigator.usb,
      wakeLock: {
        request: vi.fn(() => new Promise(() => undefined))
      }
    });
    await expect(installer.verifyRelease()).resolves.toBeUndefined();

    expect(getState().installerState).toBe('VERIFIED');
  });

  it('returns to idle when requestDevice is cancelled', async () => {
    const installer = new Installer({
      createDevice: async () => new ConnectErrorFastbootDevice({ name: 'NotFoundError', message: 'No device selected' }),
      store: new MemoryStore()
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await installer.init();
    await installer.connect();

    const state = getState();
    expect(state.installerState).toBe('IDLE');
    expect(state.statusMessage).toBe('No Pixel selected. Put the Pixel 10 in Fastboot Mode and try again.');
    expect(state.errorMessage).toBeNull();
    expect(state.logs.filter((entry) => entry.message === state.statusMessage)).toHaveLength(0);
    expect(state.logs.some((entry) => entry.level === 'ERROR' && entry.message === state.statusMessage)).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps Connect Pixel available after requestDevice is cancelled', async () => {
    const installer = new Installer({
      createDevice: async () => new ConnectErrorFastbootDevice({ name: 'NotFoundError', message: 'No device selected' }),
      store: new MemoryStore()
    });

    await installer.init();
    await installer.connect();

    const state = getState();
    expect(isEnabled('connect', state)).toBe(true);
    expect(isEnabled('reconnect', state)).toBe(false);
  });

  it('keeps real USB errors in the error state', async () => {
    const error = new Error('USB transfer failed');
    error.name = 'NetworkError';
    const installer = new Installer({
      createDevice: async () => new ConnectErrorFastbootDevice(error),
      store: new MemoryStore()
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await installer.init();
    await installer.connect();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('USB transfer failed');
  });

  it('blocks flash without SHA-256 verification', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(false);
    expect(getState().errorMessage ?? '').toContain('verification');
  });

  it('verified OPFS file survives without in-memory Blob', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(true);
    expect(device.flashedBlob).toBeInstanceOf(File);
    expect(device.flashedBlob?.size).toBe(manifest.release.size);
  });

  it('verification does not disconnect Pixel', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().deviceInfo.product).toBe('frankel');
    expect(getState().deviceInfo.serial).toBe('SERIAL1');
    expect(getState().deviceInfo.bootloader).toBe('Unlocked');
    expect(device.flashCalled).toBe(false);
  });

  it('reconnect after verified keeps verified state', async () => {
    const devices = [new FakeFastbootDevice(), new FakeFastbootDevice()];
    const installer = new Installer({ createDevice: async () => devices.shift() ?? new FakeFastbootDevice(), store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.reconnectManual();

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().releaseVerified).toBe(true);
    expect(getState().verifiedDigest).toBe(emptySha256ForTests);
  });

  it('same-device reconnect keeps verified release ready', async () => {
    const devices = [new FakeFastbootDevice(), new FakeFastbootDevice()];
    const installer = new Installer({ createDevice: async () => devices.shift() ?? new FakeFastbootDevice(), store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.reconnectManual();

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().releaseVerified).toBe(true);
  });

  it('different serial is rejected', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    device.serial = 'SERIAL2';
    await installer.reconnectManual();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('The reconnected Pixel does not match the expected device.');
  });

  it('reconnect after verified enables Flash', async () => {
    const devices = [new FakeFastbootDevice(), new FakeFastbootDevice()];
    const installer = new Installer({ createDevice: async () => devices.shift() ?? new FakeFastbootDevice(), store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.reconnectManual();

    expect(isEnabled('flash', getState())).toBe(true);
  });

  it('missing OPFS file blocks flash with precise error', async () => {
    const store = new MemoryStore();
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    store.removeFile(manifest);
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(false);
    expect(getState().errorMessage).toBe('Verified release file is missing');
  });

  it('correct frankel + verified + unlocked starts flashFactoryZip', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(true);
  });

  it('ZIP worker assets valid allow install to start', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(true);
    expect(getState().logs.some((entry) => entry.message.includes('asset reachable: yes'))).toBe(false);
  });

  it('ZIP worker asset 404 blocks flash before flashFactoryZip', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/manifest.json') {
          return new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url === ZIP_INFLATE_WORKER_URL || url === ZIP_PAKO_INFLATE_URL) {
          return new Response(null, { status: 404 });
        }
        return new Response(new Blob(), { status: 200, headers: { 'content-length': '0' } });
      })
    );
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(false);
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('ZIP decompression worker is unavailable. Installation cannot start.');
  });

  it('progress 0.01 updates current item progress without using it as overall', async () => {
    const device = new ProgressFastbootDevice([['flash', 'boot', 0.01]]);
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().flash).toMatchObject({
      operation: 'flash',
      item: 'boot',
      itemPercent: 1,
      overallPercent: null,
      overallIndeterminate: true
    });
  });

  it('unpack progress is current-item only and keeps overall preparing', async () => {
    const device = new ProgressFastbootDevice([
      ['unpack', 'bootloader', 0],
      ['unpack', 'bootloader', 0.25]
    ]);
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().flash).toMatchObject({
      operation: 'unpack',
      item: 'bootloader',
      itemPercent: 25,
      overallPercent: null,
      overallIndeterminate: true
    });
    expect(getState().progress).toBe(100);
    expect(getState().logs.some((entry) => entry.category === 'ZIP' && entry.message === 'Preparing bootloader')).toBe(true);
  });

  it('change item updates flash UI state immediately', async () => {
    const device = new ProgressFastbootDevice([
      ['flash', 'boot', 0.25],
      ['flash', 'vendor_boot', 0]
    ]);
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().flash?.item).toBe('vendor_boot');
    expect(getState().flash?.itemPercent).toBe(0);
    expect(getState().progress).toBe(100);
  });

  it('throttles flash progress logs to essential milestones', async () => {
    const device = new ProgressFastbootDevice([
      ['flash', 'boot', 0],
      ['flash', 'boot', 0.01],
      ['flash', 'boot', 0.1],
      ['flash', 'boot', 0.25],
      ['flash', 'boot', 0.5],
      ['flash', 'boot', 0.75],
      ['flash', 'boot', 1]
    ]);
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    const bootProgress = getState().logs.filter((entry) => entry.category === 'FLASH' && /^Flashing boot \d+%$/.test(entry.message)).map((entry) => entry.message);
    expect(bootProgress).toEqual(['Flashing boot 0%', 'Flashing boot 25%', 'Flashing boot 50%', 'Flashing boot 75%', 'Flashing boot 100%']);
  });

  it('shows Verified Boot key for avb_custom_key while dropping debug item logs', async () => {
    const device = new RejectingAfterProgressFastbootDevice([['flash', 'avb_custom_key', 0.5]], new Error('stop after avb progress'));
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().errorMessage).toBe('Installation stopped.');
    expect(getState().flash).toMatchObject({ operation: 'flash', item: 'avb_custom_key', itemPercent: 50 });
    expect(getState().logs.some((entry) => entry.message === 'Verified Boot key')).toBe(true);
    expect(getState().logs.some((entry) => entry.message === 'fastboot item: avb_custom_key')).toBe(false);
  });

  it('ZIP worker error becomes ERROR', async () => {
    const device = new RejectingFastbootDevice(new Error('ZIP worker failed to inflate'));
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Installation stopped.');
  });

  it('flashFactoryZip rejection becomes ERROR with last progress details', async () => {
    const device = new RejectingFastbootDevice(new Error('fastboot write failed'));
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Installation stopped.');
  });

  it('missing fastboot device fails before undefined property access', async () => {
    const device = new NullUsbHandleFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(false);
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Fastboot USB device handle is unavailable.');
    expect(getState().logs.map((entry) => entry.message).join('\n')).not.toContain('Cannot read properties');
  });

  it('missing release File fails with a precise error before factory flash', async () => {
    const store = new MemoryStore();
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    store.removeFile(manifest);
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(false);
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Verified release file is missing');
  });

  it('undefined progress callback values do not crash installation', async () => {
    const device = new UndefinedProgressFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().flash).toMatchObject({ operation: 'prepare', item: 'images', itemPercent: 0, rawProgress: null });
  });

  it('calls fastboot methods with the correct this binding', async () => {
    const device = new ThisCheckingFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(true);
    expect(getState().installerState).toBe('LOCK_READY');
  });

  it('flashFactoryZip TypeError stores full diagnostics but shows one stopped error', async () => {
    const device = new LateCallbackRejectFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    const messages = getState().logs.map((entry) => entry.message);
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Installation stopped.');
    expect(messages.filter((message) => message === 'Installation stopped.')).toHaveLength(1);
    expect(messages).toEqual(expect.arrayContaining(['Preparing images', 'Factory flash error', 'Factory flash stack', 'Installation error']));
    const installError = getState().logs.findLast((entry) => entry.message === 'Installation error');
    expect(installError?.details).toMatchObject({
      errorName: 'TypeError',
      errorMessage: "Cannot read properties of undefined (reading 'getVariable')",
      errorConstructorName: 'TypeError',
      installerState: 'FLASHING',
      factoryFlashActive: false
    });
    expect(String((installError?.details as { errorStack?: unknown })?.errorStack)).toContain('TypeError');
  });

  it('realistic factory flash TypeError preserves diagnostics after progress and reconnect', async () => {
    const device = new ReconnectThenRejectFastbootDevice();
    const store = new MemoryStore();
    const installer = new Installer({ createDevice: async () => device, store });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.waitFor(() => expect(getState().installerState).toBe('WAITING_FOR_RECONNECT'));
    await installer.reconnectManual();
    await flashing;

    const messages = getState().logs.map((entry) => entry.message);
    const stoppedIndex = messages.lastIndexOf('Installation stopped.');
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Installation stopped.');
    expect(getState().releaseVerified).toBe(true);
    expect(await store.getReleaseFile(manifest)).toBeInstanceOf(File);
    expect(messages).toEqual(expect.arrayContaining(['Preparing images', 'Flashing radio 50%', 'connect() start', 'Installation resumed', 'Factory flash error']));
    expect(messages.filter((message) => message === 'Installation stopped.')).toHaveLength(1);
    expect(messages.indexOf('Installation resumed')).toBeLessThan(stoppedIndex);
    const installError = getState().logs.findLast((entry) => entry.message === 'Installation error');
    expect(installError?.details).toMatchObject({
      errorName: 'TypeError',
      errorMessage: "Cannot read properties of undefined (reading 'getVariable')",
      lastAction: 'flash',
      lastItem: 'radio',
      lastProgress: 1
    });
  });

  it('late reconnect callback after ERROR cannot resume installation', async () => {
    const device = new LateCallbackRejectFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();
    await device.capturedReconnect?.();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().logs.some((entry) => entry.message === 'Installation resumed')).toBe(false);
    expect(getState().logs.some((entry) => entry.message === 'Pixel reconnected')).toBe(false);
  });

  it('late progress callback after ERROR cannot change UI state', async () => {
    const device = new LateCallbackRejectFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();
    const flashBeforeLateProgress = getState().flash;
    device.capturedProgress?.('flash', 'radio', 1);

    expect(getState().installerState).toBe('ERROR');
    expect(getState().flash).toEqual(flashBeforeLateProgress);
    expect(getState().logs.some((entry) => entry.message === 'Flashing radio 100%')).toBe(false);
  });

  it('retry keeps the verified release and uses a new flash attempt', async () => {
    const device = new RetryFastbootDevice();
    const store = new MemoryStore();
    const installer = new Installer({ createDevice: async () => device, store });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().releaseVerified).toBe(true);
    expect(await store.getReleaseFile(manifest)).toBeInstanceOf(File);

    await installer.connect(false);
    await installer.flashWormOs();

    expect(device.flashCalls).toBe(2);
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().releaseVerified).toBe(true);
  });

  it('OPFS File is passed directly to flashFactoryZip without arrayBuffer on the whole ZIP', async () => {
    const device = new ProgressFastbootDevice([['flash', 'boot', 1]]);
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const arrayBufferSpy = vi.spyOn(Blob.prototype, 'arrayBuffer');
    await installer.flashWormOs();

    expect(device.flashedBlob).toBeInstanceOf(File);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it('fastbootd mode during flash is logged and flash continues', async () => {
    const device = new FastbootdProgressDevice([['flash', 'system', 1]]);
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(device.flashCalled).toBe(true);
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().logs.some((entry) => entry.category === 'DEVICE' && entry.message === 'Mode: Fastbootd')).toBe(true);
  });

  it('rejects wrong release size', async () => {
    const sizedManifest = { ...manifest, release: { ...manifest.release, size: 10 } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/manifest.json') {
          return new Response(JSON.stringify(sizedManifest), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(new Blob(), { status: 200, headers: { 'content-length': '0' } });
      })
    );
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage ?? '').toContain('size');
  });

  it('does not automatically lock after flash', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();

    expect(getState().installerState).toBe('LOCK_READY');
    expect(device.lockCalled).toBe(false);
  });

  it('blocks lock before LOCK_READY', async () => {
    moveToUnlocked();
    const installer = new Installer({ createDevice: async () => new FakeFastbootDevice(), store: new MemoryStore() });
    await installer.lockBootloader();

    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage ?? '').toContain('complete verified');
  });

  it('allows lock at LOCK_READY', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();
    setLockAcknowledged(true);
    await installer.lockBootloader();

    expect(device.lockCalled).toBe(true);
    expect(getState().installerState).toBe('LOCKED');
    expect(getState().deviceInfo.bootloader).toBe('Locked');
  });

  it('final reboot stops reconnect manager', async () => {
    const device = new FakeFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    await installer.flashWormOs();
    setLockAcknowledged(true);
    await installer.lockBootloader();
    await installer.rebootPixel();

    expect(device.rebootCalled).toBe(true);
    expect(getState().installerState).toBe('COMPLETE');
  });

  it('accepts the same serial after reconnect', async () => {
    const usb = {
      getDevices: async () => [{ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }],
      requestDevice: async () => ({ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    } satisfies USB;
    const manager = new ReconnectManager(usb);
    transitionInstallerState('CONNECTING');
    transitionInstallerState('CONNECTED');
    transitionInstallerState('DEVICE_VERIFIED');
    transitionInstallerState('UNLOCKED');
    transitionInstallerState('DOWNLOADING');
    transitionInstallerState('DOWNLOADED');
    transitionInstallerState('VERIFYING');
    transitionInstallerState('VERIFIED');
    transitionInstallerState('FLASHING');

    await expect(manager.waitForExpectedDevice('SERIAL1', 10)).resolves.toMatchObject({ serialNumber: 'SERIAL1' });
  });

  it('rejects a different serial after reconnect', async () => {
    const usb = {
      getDevices: async () => [{ opened: true, vendorId: 0x18d1, serialNumber: 'OTHER', productName: 'Pixel' }],
      requestDevice: async () => ({ opened: true, vendorId: 0x18d1, serialNumber: 'OTHER', productName: 'Pixel' }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    } satisfies USB;
    const manager = new ReconnectManager(usb);

    await expect(manager.requestExpectedDevice('SERIAL1')).rejects.toThrow(WrongDeviceError);
  });

  it('flash watchdog is diagnostic and does not repeat flash', () => {
    vi.useFakeTimers();
    const warnings: string[] = [];
    let status = '';
    let flashCalls = 0;
    const watchdog = new FlashActivityWatchdog(
      (message) => warnings.push(message),
      (message) => {
        status = message;
      }
    );

    flashCalls += 1;
    watchdog.markProgress('flash', 'boot', 0.01);
    vi.advanceTimersByTime(60_000);

    expect(warnings).toContain('[WARN] Installation is still processing');
    expect(status).toBe('Installation is still processing.');
    expect(flashCalls).toBe(1);
    watchdog.dispose();
    vi.useRealTimers();
  });

  it('unpack activity resets ZIP watchdog', () => {
    vi.useFakeTimers();
    const warnings: string[] = [];
    const watchdog = new ZipUnpackWatchdog((message) => warnings.push(message), () => undefined);

    watchdog.markActivity('unpack', 'bootloader', 0);
    vi.advanceTimersByTime(14_000);
    watchdog.markActivity('unpack', 'bootloader', 0.1);
    vi.advanceTimersByTime(14_000);

    expect(warnings).not.toContain('[WARN] Installation files are still preparing');
    watchdog.dispose();
  });

  it('unpack 60s creates ZIP warning', () => {
    vi.useFakeTimers();
    const warnings: string[] = [];
    let status = '';
    const watchdog = new ZipUnpackWatchdog(
      (message) => warnings.push(message),
      (message) => {
        status = message;
      }
    );

    watchdog.markActivity('unpack', 'bootloader', 0);
    vi.advanceTimersByTime(60_000);

    expect(warnings).toContain('[WARN] Installation files are still preparing');
    expect(status).toBe('Preparing installation files. This can take some time on mobile devices.');
    watchdog.dispose();
  });

  it('ZIP watchdog stays diagnostic even after a worker failure report', () => {
    vi.useFakeTimers();
    const warnings: string[] = [];
    const watchdog = new ZipUnpackWatchdog((message) => warnings.push(message), () => undefined);
    watchdog.markActivity('unpack', 'bootloader', 0);
    recordZipWorkerFailure({ message: 'Worker error', timestamp: new Date().toISOString() });
    vi.advanceTimersByTime(90_000);

    expect(warnings).toContain('[WARN] Installation files are still preparing');
    expect(getState().installerState).not.toBe('ERROR');
    watchdog.dispose();
    vi.useRealTimers();
  });

  it('watchdog 90s reports processing without invoking flash again', () => {
    vi.useFakeTimers();
    let flashCalls = 0;
    const warnings: string[] = [];
    const watchdog = new FlashActivityWatchdog((message) => warnings.push(message), () => undefined);

    flashCalls += 1;
    watchdog.markProgress('flash', 'boot', 0.01);
    vi.advanceTimersByTime(90_000);

    expect(warnings).toContain('[WARN] Installation is still processing');
    expect(flashCalls).toBe(1);
    watchdog.dispose();
    vi.useRealTimers();
  });

  it('reconnect callback waits for the expected Pixel', async () => {
    vi.useFakeTimers();
    transitionInstallerState('CONNECTING');
    transitionInstallerState('CONNECTED');
    transitionInstallerState('DEVICE_VERIFIED');
    transitionInstallerState('UNLOCKED');
    transitionInstallerState('DOWNLOADING');
    transitionInstallerState('DOWNLOADED');
    transitionInstallerState('VERIFYING');
    transitionInstallerState('VERIFIED');
    transitionInstallerState('FLASHING');
    let available = false;
    const usb = {
      getDevices: async () => (available ? [{ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }] : []),
      requestDevice: async () => ({ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    } satisfies USB;
    const manager = new ReconnectManager(usb);
    const wait = manager.waitForExpectedDevice('SERIAL1', 2_000);
    let resolved = false;
    void wait.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    available = true;
    await vi.advanceTimersByTimeAsync(500);

    await expect(wait).resolves.toMatchObject({ serialNumber: 'SERIAL1' });
    vi.useRealTimers();
  });

  it('reconnect callback shows Reconnect Pixel and waits without restarting flashFactoryZip', async () => {
    vi.useFakeTimers();
    const device = new LibraryReconnectFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(isEnabled('reconnect', getState())).toBe(true);
    expect(isEnabled('clear', getState())).toBe(false);
    expect(isEnabled('reboot', getState())).toBe(false);
    expect(device.flashCalls).toBe(1);

    await installer.reconnectManual();
    await vi.advanceTimersByTimeAsync(1);
    await flashing;
    expect(getState().logs.some((entry) => entry.message === 'Installation resumed')).toBe(true);
    expect(device.flashCalls).toBe(1);
    expect(getState().installerState).toBe('LOCK_READY');
    vi.useRealTimers();
  });

  it('watchdogs are suspended during flashFactoryZip reconnect', async () => {
    vi.useFakeTimers();
    const device = new LibraryReconnectFastbootDevice();
    device.preReconnectProgress = [['unpack', 'bootloader', 0]];
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(300_000);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(getState().logs.some((entry) => entry.message === '[WARN] Installation is still processing')).toBe(false);
    expect(getState().logs.some((entry) => entry.message === '[WARN] Installation files are still preparing')).toBe(false);

    await installer.reconnectManual();
    await flashing;
    vi.useRealTimers();
  });

  it('uses one FastbootDevice instance for a complete flash with reconnect', async () => {
    vi.useFakeTimers();
    const device = new LibraryReconnectFastbootDevice();
    let instances = 0;
    const installer = new Installer({
      createDevice: async () => {
        instances += 1;
        return device;
      },
      store: new MemoryStore()
    });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);
    await installer.reconnectManual();
    await flashing;

    expect(instances).toBe(1);
    expect(device.flashCalls).toBe(1);
    expect(device.connectCalls).toBe(2);
    expect(getState().installerState).toBe('LOCK_READY');
    vi.useRealTimers();
  });

  it('five minutes in reconnect stays WAITING_FOR_RECONNECT without ERROR or requestDevice', async () => {
    vi.useFakeTimers();
    let requestDeviceCalls = 0;
    let available = false;
    installControlledUsb({
      getDevices: () => (available ? [{ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }] as USBDevice[] : []),
      requestDevice: () => {
        requestDeviceCalls += 1;
        return { opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' } as USBDevice;
      }
    });
    const device = new LibraryReconnectFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(getState().errorMessage).toBeNull();
    expect(getState().statusMessage).toBe('Still waiting for the Pixel.');
    expect(isEnabled('clear', getState())).toBe(false);
    expect(requestDeviceCalls).toBe(0);

    await installer.reconnectManual();
    expect(device.connectCalls).toBe(2);
    await flashing;
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().errorMessage).toBeNull();
    expect(getState().logs.some((entry) => entry.message === 'Installation resumed')).toBe(true);
    expect(device.flashCalls).toBe(1);
    expect(getState().installerState).toBe('LOCK_READY');
    vi.useRealTimers();
  });

  it('Reconnect Pixel calls sameDevice.connect and does not call flashFactoryZip again', async () => {
    vi.useFakeTimers();
    const device = new LibraryReconnectFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);

    expect(device.connectCalls).toBe(1);
    await installer.reconnectManual();
    await flashing;
    expect(device.connectCalls).toBe(2);
    expect(device.flashCalls).toBe(1);
    expect(getState().installerState).toBe('LOCK_READY');
    vi.useRealTimers();
  });

  it('requires a manual Reconnect Pixel click for five consecutive factory ZIP reboots', async () => {
    vi.useFakeTimers();
    let instances = 0;
    let getDevicesCalls = 0;
    let requestDeviceCalls = 0;
    installControlledUsb({
      getDevices: () => {
        getDevicesCalls += 1;
        return [{ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }] as USBDevice[];
      },
      requestDevice: () => {
        requestDeviceCalls += 1;
        return { opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' } as USBDevice;
      }
    });
    const device = new MultiReconnectFastbootDevice(5);
    const installer = new Installer({
      createDevice: async () => {
        instances += 1;
        return device;
      },
      store: new MemoryStore()
    });

    await connectInstaller(installer);
    const getDevicesBeforeFlash = getDevicesCalls;
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
      expect(isEnabled('reconnect', getState())).toBe(true);
      expect(isEnabled('connect', getState())).toBe(false);
      expect(isEnabled('download', getState())).toBe(false);
      expect(isEnabled('clear', getState())).toBe(false);
      expect(isEnabled('verify', getState())).toBe(false);
      expect(isEnabled('flash', getState())).toBe(false);
      expect(isEnabled('lock', getState())).toBe(false);
      expect(isEnabled('reboot', getState())).toBe(false);

      await installer.reconnectManual();
      await vi.advanceTimersByTimeAsync(1);

      if (cycle < 5) {
        expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
        expect(isEnabled('reconnect', getState())).toBe(true);
      } else {
        await flashing;
        expect(getState().installerState).toBe('LOCK_READY');
        expect(isEnabled('reconnect', getState())).toBe(false);
      }
    }

    const reconnectLogs = getState().logs.filter((entry) => entry.category === 'RECONNECT');
    expect(reconnectLogs.filter((entry) => entry.message === 'Pixel restarted')).toHaveLength(5);
    expect(reconnectLogs.filter((entry) => entry.message === 'Waiting for manual reconnect')).toHaveLength(5);
    expect(reconnectLogs.filter((entry) => entry.message === 'Reconnect Pixel clicked')).toHaveLength(5);
    expect(reconnectLogs.filter((entry) => entry.message === 'connect() success')).toHaveLength(5);
    expect(reconnectLogs.filter((entry) => entry.message === 'Installation resumed')).toHaveLength(5);
    expect(instances).toBe(1);
    expect(device.flashCalls).toBe(1);
    expect(device.reconnectConnectCalls).toBe(5);
    expect(device.reconnectCallbacks).toBe(5);
    expect(getDevicesCalls).toBe(getDevicesBeforeFlash);
    expect(requestDeviceCalls).toBe(0);
    expect(getState().errorMessage).toBeNull();
    expect(getState().logs.some((entry) => /ZIP worker stalled|Flash stalled|No flash progress/.test(entry.message))).toBe(false);
    vi.useRealTimers();
  });

  it('radio reboot reconnect uses only sameDevice.connect before factory ZIP continues', async () => {
    vi.useFakeTimers();
    const device = new RadioReconnectFastbootDevice();
    let instances = 0;
    const installer = new Installer({
      createDevice: async () => {
        instances += 1;
        return device;
      },
      store: new MemoryStore()
    });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(isEnabled('reconnect', getState())).toBe(true);
    expect(__uiTest.renderCurrentCard(getState())).toContain('Radio installed');
    expect(__uiTest.renderCurrentCard(getState())).toContain('Pixel restarted into bootloader.');
    expect(__uiTest.renderCurrentCard(getState())).toContain('Restarting bootloader');
    expect(getState().logs.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        'radio start',
        'radio 25%',
        'radio 50%',
        'radio 75%',
        'radio 100%',
        'radio complete',
        'requested after radio',
        'waiting for manual click'
      ])
    );

    const getVariablesBeforeReconnect = device.getVariableCalls.length;
    const runCommandsBeforeReconnect = device.runCommandCalls.length;

    await installer.reconnectManual();
    await vi.advanceTimersByTimeAsync(1);

    expect(device.getVariableCalls).toHaveLength(getVariablesBeforeReconnect);
    expect(device.runCommandCalls).toHaveLength(runCommandsBeforeReconnect);
    expect(device.reconnectConnectCalls).toBe(1);
    expect(device.flashCalls).toBe(1);
    expect(instances).toBe(1);
    expect(getState().installerState).toBe('WAITING_FOR_FLASH_RESUME');
    expect(getState().statusMessage).toBe('Connection restored. Waiting for installation...');
    expect(getState().errorMessage).toBeNull();
    expect(getState().logs.some((entry) => entry.message === 'Installation resumed')).toBe(false);
    expect(device.getVariableCalls).toHaveLength(getVariablesBeforeReconnect);
    expect(device.runCommandCalls).toHaveLength(runCommandsBeforeReconnect);
    expect(device.flashCalls).toBe(1);
    expect(instances).toBe(1);

    device.emitNextProgress();
    await vi.advanceTimersByTimeAsync(1);

    expect(getState().installerState).toBe('FLASHING');
    expect(getState().statusMessage).toBe('Installation resumed.');
    expect(getState().flash).toMatchObject({ operation: 'flash', item: 'avb_custom_key', itemPercent: 100 });
    expect(isEnabled('reconnect', getState())).toBe(false);
    expect(getState().logs.map((entry) => entry.message)).toEqual(expect.arrayContaining(['connect() start', 'connect() success', 'waiting for next callback', 'Installation resumed']));
    expect(device.getVariableCalls).toHaveLength(getVariablesBeforeReconnect);
    expect(device.runCommandCalls).toHaveLength(runCommandsBeforeReconnect);

    device.resolveFlash();
    await flashing;

    expect(instances).toBe(1);
    expect(device.flashCalls).toBe(1);
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().errorMessage).toBeNull();
    vi.useRealTimers();
  });

  it('radio reconnect rejection before next progress keeps the real factory error and does not fake resume', async () => {
    vi.useFakeTimers();
    const device = new RadioReconnectRejectBeforeProgressFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');

    await installer.reconnectManual();
    await flashing;

    const messages = getState().logs.map((entry) => entry.message);
    const factoryError = getState().logs.findLast((entry) => entry.message === 'Factory flash error');
    expect(getState().installerState).toBe('ERROR');
    expect(getState().errorMessage).toBe('Installation stopped.');
    expect(messages).toEqual(expect.arrayContaining(['radio complete', 'connect() success', 'Factory flash error']));
    expect(messages.some((message) => message === 'Installation resumed')).toBe(false);
    expect(factoryError?.details).toMatchObject({
      errorName: 'TypeError',
      errorMessage: "Cannot read properties of undefined (reading 'getVariable')",
      lastAction: 'flash',
      lastItem: 'radio',
      lastProgress: 1,
      reconnectSequence: 1
    });
    vi.useRealTimers();
  });

  it('premature factory reconnect click does not call connect or enter ERROR', async () => {
    vi.useFakeTimers();
    let available = false;
    installControlledUsb({
      getDevices: () => (available ? [{ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }] as USBDevice[] : [])
    });
    const device = new LibraryReconnectFastbootDevice();
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    await installer.reconnectManual();
    expect(device.connectCalls).toBe(2);
    await flashing;
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().errorMessage).toBeNull();
    expect(isEnabled('reconnect', getState())).toBe(false);

    expect(device.connectCalls).toBe(2);
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().errorMessage).toBeNull();
    vi.useRealTimers();
  });

  it('runs the complete mock Pixel lifecycle without real WebUSB or production release', async () => {
    vi.useFakeTimers();
    const device = new MockFastbootDevice();
    let instances = 0;
    const installer = new Installer({
      createDevice: async () => {
        instances += 1;
        return device;
      },
      store: new MemoryStore(),
      mockMode: true
    });

    await installer.init();
    await installer.connect();
    await installer.downloadWormOs();
    await installer.verifyRelease();

    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(20);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(isEnabled('reconnect', getState())).toBe(true);

    await installer.reconnectManual();
    await vi.advanceTimersByTimeAsync(20);
    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');

    await installer.reconnectManual();
    await vi.advanceTimersByTimeAsync(20);
    expect(getState().logs.some((entry) => entry.category === 'DEVICE' && entry.message === 'Mode: Bootloader')).toBe(true);
    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');

    await installer.reconnectManual();
    await vi.advanceTimersByTimeAsync(20);
    await flashing;

    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().logs.some((entry) => entry.message === 'Installation complete')).toBe(true);
    expect(getState().logs.some((entry) => entry.message === 'Verified Boot key')).toBe(true);

    setLockAcknowledged(true);
    await installer.lockBootloader();
    expect(getState().installerState).toBe('LOCKED');
    expect(getState().deviceInfo.bootloader).toBe('Locked');
    expect(isEnabled('reboot', getState())).toBe(true);

    await installer.rebootPixel();

    expect(instances).toBe(1);
    expect(device.flashFactoryZipCalls).toBe(1);
    expect(device.manualReconnectClicks).toBe(3);
    expect(getState().logs.filter((entry) => entry.message === 'Reconnect Pixel clicked')).toHaveLength(3);
    expect(getState().logs.some((entry) => entry.level === 'ERROR')).toBe(false);
    expect(getState().installerState).toBe('COMPLETE');
    vi.useRealTimers();
  });

  it('does not query fastbootd mode after reconnect during flashFactoryZip', async () => {
    vi.useFakeTimers();
    const device = new LibraryReconnectFastbootDevice();
    device.isUserspaceAfterReconnect = true;
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);
    const isUserspaceQueriesBeforeReconnect = device.getVariableCalls.filter((name) => name === 'is-userspace').length;
    await installer.reconnectManual();
    await flashing;

    expect(device.flashCalls).toBe(1);
    expect(getState().installerState).toBe('LOCK_READY');
    expect(device.getVariableCalls.filter((name) => name === 'is-userspace')).toHaveLength(isUserspaceQueriesBeforeReconnect);
    expect(getState().logs.some((entry) => entry.category === 'DEVICE' && entry.message === 'Mode: Fastbootd')).toBe(false);
    vi.useRealTimers();
  });

  it('visibilitychange does not reset installation state', () => {
    transitionInstallerState('CONNECTING');
    transitionInstallerState('CONNECTED');
    transitionInstallerState('DEVICE_VERIFIED');
    transitionInstallerState('UNLOCKED');
    transitionInstallerState('DOWNLOADING');
    transitionInstallerState('DOWNLOADED');
    transitionInstallerState('VERIFYING');
    transitionInstallerState('VERIFIED');
    transitionInstallerState('FLASHING');

    globalThis.dispatchEvent?.(new Event('visibilitychange'));

    expect(getState().installerState).toBe('FLASHING');
  });

  it('times out while reconnecting', async () => {
    const usb = {
      getDevices: async () => [],
      requestDevice: async () => ({ opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    } satisfies USB;
    const manager = new ReconnectManager(usb);
    transitionInstallerState('CONNECTING');
    transitionInstallerState('CONNECTED');
    transitionInstallerState('DEVICE_VERIFIED');
    transitionInstallerState('UNLOCKED');
    transitionInstallerState('DOWNLOADING');
    transitionInstallerState('DOWNLOADED');
    transitionInstallerState('VERIFYING');
    transitionInstallerState('VERIFIED');
    transitionInstallerState('FLASHING');

    await expect(manager.waitForExpectedDevice('SERIAL1', 0)).rejects.toThrow('Reconnect wait expired');
  });
});
