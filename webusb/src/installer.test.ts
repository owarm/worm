import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobStore } from './blob-store';
import { FlashActivityWatchdog, Installer, ReconnectManager, ZipUnpackWatchdog, clearZipWorkerFailure, recordZipWorkerFailure } from './installer';
import { ZIP_INFLATE_WORKER_URL, ZIP_PAKO_INFLATE_URL, ZIP_WORKER_CONFIGURATION } from './fastboot';
import { metadataFromManifest, releaseFilename, releaseKey } from './release';
import { __resetStateForTests, getState, setLockAcknowledged, setRelease, transitionInstallerState } from './state';
import { __resetLoggerForTests } from './logger';
import { isEnabled } from './ui';
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

class MemoryStore extends BlobStore {
  deletedKeys: string[] = [];
  private records = new Map<string, CachedRelease>();
  private missingFiles = new Set<string>();
  private writableManifest: ReleaseManifest | null = null;

  constructor(seed?: CachedRelease) {
    super();
    if (seed) {
      this.records.set(releaseKey(manifest), seed);
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
  device: USBDevice | null = { opened: true, vendorId: 0x18d1, serialNumber: 'SERIAL1', productName: 'Pixel' };

  async connect(): Promise<void> {}

  async getVariable(varName: string): Promise<string | undefined> {
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

const installFetchManifest = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/manifest.json') {
        return new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(new Blob(), { status: 200, headers: { 'content-length': '0' } });
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

  it('keeps the real android-fastboot factory ZIP API available without startup log spam', async () => {
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
    const first = new FakeFastbootDevice();
    const second = new FakeFastbootDevice();
    second.serial = 'SERIAL2';
    const devices = [first, second];
    const installer = new Installer({ createDevice: async () => devices.shift() ?? second, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
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

  it('reconnect callback shows Reconnect Device and waits without restarting flashFactoryZip', async () => {
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
    installControlledUsb({
      getDevices: () => [],
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
    await flashing;
    expect(device.flashCalls).toBe(1);
    expect(getState().installerState).toBe('LOCK_READY');
    vi.useRealTimers();
  });

  it('Reconnect Device calls sameDevice.connect and does not call flashFactoryZip again', async () => {
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

  it('fastbootd is accepted after reconnect during flashFactoryZip', async () => {
    vi.useFakeTimers();
    const device = new LibraryReconnectFastbootDevice();
    device.isUserspaceAfterReconnect = true;
    const installer = new Installer({ createDevice: async () => device, store: new MemoryStore() });

    await connectInstaller(installer);
    await installer.downloadWormOs();
    await installer.verifyRelease();
    const flashing = installer.flashWormOs();
    await vi.advanceTimersByTimeAsync(1);
    await installer.reconnectManual();
    await flashing;

    expect(device.flashCalls).toBe(1);
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().logs.some((entry) => entry.category === 'DEVICE' && entry.message === 'Mode: Fastbootd')).toBe(true);
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
