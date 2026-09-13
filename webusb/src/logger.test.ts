import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetLoggerForTests,
  __startLoggerSessionForTests,
  clearCurrentLogSession,
  createDiagnosticJson,
  createLogEntry,
  formatLogEntry,
  formatTextLog,
  getRamLogEntries,
  getStoredLogSession,
  maskSerial,
  restoreCurrentLogSession
} from './logger';
import { __resetStateForTests, addLog, clearInstallationLogs, getState, restoreLogsForCurrentSession, transitionInstallerState } from './state';
import type { AppState, ReleaseManifest } from './types';

const serial = 'ABCDEF1234567890';

const release: ReleaseManifest = {
  schema: 1,
  channel: 'stable',
  device: 'frankel',
  release: {
    id: '2026091301',
    file: '/releases/worm-frankel-2026091301.zip',
    sha256: 'a'.repeat(64),
    size: 123
  }
};

const stateForExport = (): AppState => ({
  ...getState(),
  release,
  deviceInfo: {
    device: 'Google Pixel 10',
    product: 'frankel',
    serial,
    bootloader: 'Unlocked'
  }
});

describe('installation logger', () => {
  beforeEach(() => {
    __resetLoggerForTests();
    __resetStateForTests();
  });

  it('formats timestamps with milliseconds and category', () => {
    const entry = createLogEntry('USB', 'Pixel connected', undefined, 'USB');
    expect(entry.category).toBe('USB');
    expect(formatLogEntry(entry)).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[USB\] Pixel connected$/);
  });

  it('masks full serials in details and diagnostic JSON export', async () => {
    createLogEntry('FASTBOOT', `getvar serialno -> ${maskSerial(serial)}`, { serial }, 'FASTBOOT');
    const json = await createDiagnosticJson(stateForExport());
    const serialized = JSON.stringify(json);

    expect(maskSerial(serial)).toBe('ABCDEF...7890');
    expect(json.device.serial).toBe('ABCDEF...7890');
    expect(serialized).not.toContain(serial);
  });

  it('does not log normal state transitions', () => {
    transitionInstallerState('CONNECTING');
    transitionInstallerState('CONNECTED');

    expect(getState().logs.some((entry) => entry.category === 'STATE')).toBe(false);
  });

  it('records essential download, verification, reconnect and error logs', () => {
    addLog('FASTBOOT', 'command -> flashing unlock', undefined, 'FASTBOOT');
    addLog('DOWNLOAD', 'Resuming from 1024 bytes', { existingBytes: 1024 }, 'DOWNLOAD');
    addLog('VERIFY', 'Image verified', undefined, 'VERIFY');
    addLog('RECONNECT', 'Pixel reconnected', undefined, 'RECONNECT');
    addLog('ERROR', 'Installation error', { stage: 'Flash', item: 'boot', mode: 'Bootloader', connection: 'connected', message: 'denied' }, 'ERROR');

    const text = formatTextLog(getState().logs);
    expect(text).not.toContain('[FASTBOOT] command -> flashing unlock');
    expect(text).toContain('[DOWNLOAD] Resuming from 1024 bytes');
    expect(text).toContain('[VERIFY] Image verified');
    expect(text).toContain('[RECONNECT] Pixel reconnected');
    expect(text).toContain('[ERROR] Installation error');
  });

  it('restores the current session and clears logs', async () => {
    const entry = createLogEntry('DOWNLOAD', 'Download started', undefined, 'DOWNLOAD');
    await restoreLogsForCurrentSession();
    expect(entry).not.toBeNull();
    expect(getRamLogEntries().map((item) => item.id)).toContain(entry?.id);

    await clearInstallationLogs();
    expect(getState().logs).toEqual([]);

    await clearCurrentLogSession();
    expect(await getStoredLogSession()).toBeNull();
  });

  it('keeps only the latest five persisted sessions', async () => {
    for (let index = 0; index < 6; index += 1) {
      __startLoggerSessionForTests(`worm-test-${index}`);
      createLogEntry('DOWNLOAD', `Download started ${index}`, undefined, 'DOWNLOAD');
    }

    expect(await getStoredLogSession('worm-test-0')).toBeNull();
    expect(await getStoredLogSession('worm-test-1')).not.toBeNull();
    expect(await getStoredLogSession('worm-test-5')).not.toBeNull();
  });

  it('caps the RAM ring buffer at 300 entries', () => {
    for (let index = 0; index < 305; index += 1) {
      createLogEntry('DOWNLOAD', `Download event ${index}`, undefined, 'DOWNLOAD');
    }

    expect(getRamLogEntries()).toHaveLength(300);
    expect(getRamLogEntries()[0].message).toBe('Download event 5');
  });

  it('exports readable text and diagnostic JSON', async () => {
    createLogEntry('COMPLETE', 'Worm OS installation complete', undefined, 'COMPLETE');
    const text = formatTextLog(getRamLogEntries());
    const json = await createDiagnosticJson(stateForExport());

    expect(text).toContain('[COMPLETE] Worm OS installation complete');
    expect(json.schemaVersion).toBe(1);
    expect(json.release?.release.id).toBe(release.release.id);
    expect(json.entries.at(-1)?.message).toBe('Worm OS installation complete');
    expect(json.summary).toMatchObject({
      device: 'frankel',
      releaseId: release.release.id,
      installResult: 'complete'
    });
  });

  it('does not serialize obvious secrets', () => {
    const entry = createLogEntry('ERROR', 'Installation error', {
      token: 'token-value',
      password: 'password-value',
      nested: { privateKey: 'private-key-value' }
    }, 'ERROR');

    expect(JSON.stringify(entry)).not.toContain('token-value');
    expect(JSON.stringify(entry)).not.toContain('password-value');
    expect(JSON.stringify(entry)).not.toContain('private-key-value');
    expect(JSON.stringify(entry)).toContain('[redacted]');
  });

  it('deduplicates repeated logs for ten seconds', () => {
    addLog('RECONNECT', 'Waiting for Pixel', undefined, 'RECONNECT');
    addLog('RECONNECT', 'Waiting for Pixel', undefined, 'RECONNECT');

    expect(getState().logs.filter((entry) => entry.category === 'RECONNECT' && entry.message === 'Waiting for Pixel')).toHaveLength(1);
  });

  it('current log session count excludes older archived sessions', async () => {
    __startLoggerSessionForTests('worm-old');
    createLogEntry('FLASH', 'Installation started', undefined, 'FLASH');
    createLogEntry('FLASH', 'Installation complete', undefined, 'FLASH');

    __startLoggerSessionForTests('worm-current');
    __resetStateForTests();
    addLog('FLASH', 'Installation started', undefined, 'FLASH');

    expect(getState().logCount).toBe(1);
    expect(getState().logs.map((entry) => entry.sessionId)).toEqual(['worm-current']);
  });

  it('drops polling and getvar spam', () => {
    addLog('RECONNECT', 'getDevices scan', undefined, 'RECONNECT');
    addLog('RECONNECT', 'Reconnect attempt 1', undefined, 'RECONNECT');
    addLog('FASTBOOT', 'getvar product -> frankel', undefined, 'FASTBOOT');

    expect(formatTextLog(getState().logs)).not.toMatch(/getDevices|Reconnect attempt|getvar product/);
  });

  it('export contains the essential timeline without credentials or full serial', async () => {
    addLog('USB', 'Pixel connected', { serial }, 'USB');
    addLog('VERIFY', 'Image verified', undefined, 'VERIFY');
    addLog('ERROR', 'Installation error', {
      stage: 'Preparing files',
      item: 'bootloader',
      mode: 'Bootloader',
      connection: 'connected',
      message: 'ZIP worker stopped responding',
      authorization: 'Basic dXNlcjpwYXNz'
    }, 'ERROR');

    const json = await createDiagnosticJson(stateForExport());
    const serialized = JSON.stringify(json);
    expect(json.entries.map((entry) => entry.message)).toEqual(['Pixel connected', 'Image verified', 'Installation error']);
    expect(json.summary.imageVerificationResult).toBe('verified');
    expect(serialized).not.toContain(serial);
    expect(serialized).not.toContain('dXNlcjpwYXNz');
    expect(serialized).not.toContain('Basic dXNlcjpwYXNz');
  });
});
