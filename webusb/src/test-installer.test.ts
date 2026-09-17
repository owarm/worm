import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getState, __resetStateForTests } from './state';
import { __resetLoggerForTests } from './logger';
import { TestInstaller } from './test-installer';

const runDownload = async (installer: TestInstaller): Promise<void> => {
  const promise = installer.download();
  await vi.advanceTimersByTimeAsync(3_000);
  await promise;
};

const runVerify = async (installer: TestInstaller): Promise<void> => {
  const promise = installer.verify();
  await vi.advanceTimersByTimeAsync(2_000);
  await promise;
};

const runInstallToReconnect = async (installer: TestInstaller): Promise<void> => {
  const promise = installer.install();
  await vi.advanceTimersByTimeAsync(1_200);
  await promise;
};

describe('Test Installer simulation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      })
    });
    __resetLoggerForTests();
    __resetStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Start Test uses no WebUSB and no real FastbootDevice', async () => {
    const usb = {
      requestDevice: vi.fn(),
      getDevices: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    vi.stubGlobal('navigator', { usb });

    const installer = new TestInstaller();
    installer.start();

    expect(getState().testMode).toBe(true);
    expect(getState().sessionId).toMatch(/^test-\d{8}-\d{6}-[a-f0-9]{6}$/);
    expect(usb.requestDevice).not.toHaveBeenCalled();
    expect(usb.getDevices).not.toHaveBeenCalled();
    expect(installer.device.flashFactoryZipCalls).toBe(0);
    expect(installer.device.runCommandCalls).toBe(0);
  });

  it('simulates download progress 0/25/50/75/100 without production cache', async () => {
    localStorage.setItem('worm-os-installer:metadata', JSON.stringify({ releaseId: 'production-release' }));
    const installer = new TestInstaller();
    installer.start();
    await installer.connect();

    await runDownload(installer);

    expect(getState().download?.percent).toBe(100);
    expect(getState().logs.map((entry) => entry.message)).toEqual(expect.arrayContaining(['Download started', 'Download 25%', 'Download 50%', 'Download 75%', 'Download complete']));
    expect(localStorage.getItem('worm-os-installer:metadata')).toContain('production-release');
  });

  it('simulates verify complete', async () => {
    const installer = new TestInstaller();
    installer.start();
    await installer.connect();
    await runDownload(installer);

    await runVerify(installer);

    expect(getState().installerState).toBe('VERIFIED');
    expect(getState().releaseVerified).toBe(true);
    expect(getState().logs.map((entry) => entry.message)).toEqual(expect.arrayContaining(['Verifying image', '50%', '100%', 'Image verified']));
  });

  it('pauses at reconnect #1, resumes only on click, then pauses at reconnect #2', async () => {
    const installer = new TestInstaller();
    installer.start();
    await installer.connect();
    await runDownload(installer);
    await runVerify(installer);

    await runInstallToReconnect(installer);

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(getState().testReconnectSequence).toBe(1);

    const reconnect = installer.reconnect();
    await vi.advanceTimersByTimeAsync(1_600);
    await reconnect;

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(getState().testReconnectSequence).toBe(2);
    expect(getState().logs.map((entry) => entry.message)).toEqual(expect.arrayContaining(['Pixel reconnected', 'Mode: Fastbootd', 'Installation resumed', 'Flashing device 100%']));
  });

  it('pauses at reconnect #3 and final reconnect reaches LOCK_READY after exactly 3 clicks', async () => {
    const installer = new TestInstaller();
    installer.start();
    await installer.connect();
    await runDownload(installer);
    await runVerify(installer);
    await runInstallToReconnect(installer);
    let reconnect = installer.reconnect();
    await vi.advanceTimersByTimeAsync(1_600);
    await reconnect;
    reconnect = installer.reconnect();
    await vi.advanceTimersByTimeAsync(1_600);
    await reconnect;

    expect(getState().installerState).toBe('WAITING_FOR_RECONNECT');
    expect(getState().testReconnectSequence).toBe(3);

    reconnect = installer.reconnect();
    await vi.advanceTimersByTimeAsync(500);
    await reconnect;

    expect(installer.reconnectClicks).toBe(3);
    expect(getState().installerState).toBe('LOCK_READY');
    expect(getState().logs.map((entry) => entry.message)).toEqual(expect.arrayContaining(['Mode: Bootloader', 'Flashing firmware 100%', 'Verified Boot key', 'Installation complete']));
  });

  it('mock lock and reboot reach COMPLETE', async () => {
    const installer = new TestInstaller();
    installer.start();
    await installer.connect();
    await runDownload(installer);
    await runVerify(installer);
    await runInstallToReconnect(installer);
    for (let index = 0; index < 3; index += 1) {
      const reconnect = installer.reconnect();
      await vi.advanceTimersByTimeAsync(index < 2 ? 1_600 : 500);
      await reconnect;
    }

    const lock = installer.lock();
    await vi.advanceTimersByTimeAsync(500);
    await lock;
    expect(getState().installerState).toBe('LOCKED');
    expect(getState().deviceInfo.bootloader).toBe('Locked');
    expect(installer.device.runCommandCalls).toBe(0);

    const reboot = installer.reboot();
    await vi.advanceTimersByTimeAsync(500);
    await reboot;
    expect(getState().installerState).toBe('COMPLETE');
    expect(getState().statusMessage).toBe('Installation complete.');
  });

  it('Exit Test cancels timers and reload does not resume test', async () => {
    const installer = new TestInstaller();
    installer.start();
    await installer.connect();
    const download = installer.download().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(750);

    installer.exit();
    await vi.advanceTimersByTimeAsync(10_000);
    await download;

    expect(getState().testMode).toBe(false);
    expect(getState().installerState).toBe('IDLE');

    installer.start();
    expect(getState().testMode).toBe(true);
    __resetStateForTests();
    expect(getState().testMode).toBe(false);
    expect(getState().installerState).toBe('IDLE');
  });
});
