import { DEVICE_TARGET } from './config';
import { clearCurrentLogSession, createLogEntry, getLogCount, getRamLogEntries, getSessionInfo, restoreCurrentLogSession } from './logger';
import type {
  AppState,
  DeviceInfo,
  DownloadProgress,
  FastbootInspection,
  FlashProgress,
  InstallerState,
  LogLevel,
  LogCategory,
  PersistedInstallerMetadata,
  ReleaseManifest,
  SafeStage,
  StateListener
} from './types';
import { InstallerStateError } from './types';

const STORAGE_KEY = 'worm-os-installer:metadata';

const safeStages = new Set<SafeStage>([
  'IDLE',
  'CONNECTED',
  'DEVICE_VERIFIED',
  'UNLOCK_REQUIRED',
  'UNLOCKED',
  'DOWNLOADED',
  'VERIFIED',
  'FLASH_COMPLETE',
  'LOCK_READY',
  'LOCKED',
  'COMPLETE'
]);

const legalTransitions: Record<InstallerState, InstallerState[]> = {
  IDLE: ['CONNECTING', 'DOWNLOADING', 'DOWNLOADED', 'VERIFIED', 'ERROR'],
  CONNECTING: ['IDLE', 'CONNECTED', 'ERROR'],
  CONNECTED: ['DEVICE_VERIFIED', 'DOWNLOADING', 'DOWNLOADED', 'VERIFIED', 'ERROR'],
  DEVICE_VERIFIED: ['UNLOCK_REQUIRED', 'UNLOCKED', 'DOWNLOADING', 'DOWNLOADED', 'VERIFIED', 'ERROR'],
  UNLOCK_REQUIRED: ['UNLOCKING', 'DOWNLOADING', 'DOWNLOADED', 'VERIFIED', 'ERROR'],
  UNLOCKING: ['WAITING_USER_UNLOCK', 'UNLOCKED', 'RECONNECTING', 'ERROR'],
  WAITING_USER_UNLOCK: ['RECONNECTING', 'UNLOCKED', 'ERROR'],
  UNLOCKED: ['DOWNLOADING', 'DOWNLOADED', 'VERIFYING', 'VERIFIED', 'ERROR'],
  DOWNLOADING: ['DOWNLOADED', 'ERROR'],
  DOWNLOADED: ['CONNECTING', 'VERIFYING', 'DOWNLOADING', 'VERIFIED', 'ERROR'],
  VERIFYING: ['VERIFIED', 'DOWNLOADING', 'ERROR'],
  VERIFIED: ['CONNECTING', 'FLASHING', 'ERROR'],
  FLASHING: ['WAITING_FOR_RECONNECT', 'RECONNECTING', 'FLASH_COMPLETE', 'ERROR'],
  WAITING_FOR_RECONNECT: ['FLASHING', 'FLASH_COMPLETE', 'ERROR'],
  RECONNECTING: ['WAITING_MANUAL_RECONNECT', 'CONNECTED', 'DEVICE_VERIFIED', 'UNLOCKED', 'FLASHING', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKED', 'ERROR'],
  WAITING_MANUAL_RECONNECT: ['FLASHING', 'ERROR'],
  FLASH_COMPLETE: ['RECONNECTING', 'LOCK_READY', 'ERROR'],
  LOCK_READY: ['LOCKING', 'REBOOTING', 'ERROR'],
  LOCKING: ['WAITING_USER_LOCK', 'LOCKED', 'RECONNECTING', 'ERROR'],
  WAITING_USER_LOCK: ['RECONNECTING', 'LOCKED', 'ERROR'],
  LOCKED: ['REBOOTING', 'COMPLETE', 'ERROR'],
  REBOOTING: ['COMPLETE', 'ERROR'],
  COMPLETE: ['IDLE'],
  ERROR: ['IDLE', 'CONNECTING']
};

const emptyDeviceInfo: DeviceInfo = {
  device: DEVICE_TARGET.name,
  product: 'Unknown',
  serial: 'Not connected',
  bootloader: 'Unknown'
};

const readPersistedMetadata = (): PersistedInstallerMetadata => {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<PersistedInstallerMetadata>;
    return {
      releaseId: typeof parsed.releaseId === 'string' ? parsed.releaseId : undefined,
      expectedProduct: typeof parsed.expectedProduct === 'string' ? parsed.expectedProduct : undefined,
      expectedSerial: typeof parsed.expectedSerial === 'string' ? parsed.expectedSerial : undefined,
      lastSafeStage: parsed.lastSafeStage && safeStages.has(parsed.lastSafeStage) ? parsed.lastSafeStage : undefined
    };
  } catch {
    return {};
  }
};

const writePersistedMetadata = (metadata: PersistedInstallerMetadata): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const safe: PersistedInstallerMetadata = {
    releaseId: metadata.releaseId,
    expectedProduct: metadata.expectedProduct,
    expectedSerial: metadata.expectedSerial,
    lastSafeStage: metadata.lastSafeStage
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
};

const persisted = readPersistedMetadata();

const initialState: AppState = {
  sessionId: getSessionInfo().sessionId,
  installerState: 'IDLE',
  deviceInfo: emptyDeviceInfo,
  release: null,
  download: null,
  flash: null,
  progress: 0,
  statusMessage: 'Worm OS installer ready.',
  errorMessage: null,
  logs: [],
  logCount: getLogCount(),
  fastbootInspection: null,
  unlockAcknowledged: false,
  lockAcknowledged: false,
  verifiedDigest: null,
  cacheKey: null,
  expectedSerial: persisted.expectedSerial ?? null,
  releaseComplete: false,
  releaseVerified: false,
  releaseFileAvailable: false
};

let currentState = initialState;
let persistedMetadata: PersistedInstallerMetadata = persisted;
const listeners = new Set<StateListener>();

export const getState = (): AppState => currentState;

export const getPersistedMetadata = (): PersistedInstallerMetadata => persistedMetadata;

export const updatePersistedMetadata = (metadata: Partial<PersistedInstallerMetadata>): void => {
  persistedMetadata = { ...persistedMetadata, ...metadata };
  writePersistedMetadata(persistedMetadata);
  if ('expectedSerial' in metadata) {
    currentState = { ...currentState, expectedSerial: metadata.expectedSerial ?? null };
    publish();
  }
};

export const subscribe = (listener: StateListener): (() => void) => {
  listeners.add(listener);
  listener(currentState);
  return () => listeners.delete(listener);
};

const publish = (): void => {
  for (const listener of listeners) {
    listener(currentState);
  }
};

export const canTransition = (from: InstallerState, to: InstallerState): boolean => legalTransitions[from].includes(to);

export const transitionInstallerState = (installerState: InstallerState, message?: string): void => {
  if (installerState !== currentState.installerState && !canTransition(currentState.installerState, installerState)) {
    const error = new InstallerStateError(currentState.installerState, installerState);
    const entry = createLogEntry('ERROR', error.message, { from: currentState.installerState, to: installerState, reason: error.message }, 'STATE');
    currentState = {
      ...currentState,
      installerState: 'ERROR',
      errorMessage: error.message,
      statusMessage: error.message,
      logs: entry ? [...currentState.logs, entry].slice(-300) : currentState.logs,
      logCount: getLogCount()
    };
    publish();
    throw error;
  }

  const messageEntry = message ? createLogEntry('INFO', message) : null;
  const logs = [...currentState.logs, ...[messageEntry].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))].slice(-300);
  currentState = {
    ...currentState,
    installerState,
    statusMessage: message ?? currentState.statusMessage,
    errorMessage: installerState === 'ERROR' ? currentState.errorMessage : null,
    logs,
    logCount: getLogCount()
  };

  if (safeStages.has(installerState as SafeStage)) {
    updatePersistedMetadata({ lastSafeStage: installerState as SafeStage });
  }

  publish();
};

export const setInstallerState = transitionInstallerState;

export const setProgress = (progress: number): void => {
  const safeProgress = Math.min(100, Math.max(0, Math.round(progress)));
  currentState = { ...currentState, progress: safeProgress };
  publish();
};

export const setStatusMessage = (statusMessage: string): void => {
  currentState = { ...currentState, statusMessage };
  publish();
};

export const setErrorMessage = (errorMessage: string): void => {
  currentState = { ...currentState, errorMessage, statusMessage: errorMessage };
  publish();
};

export const setDeviceInfo = (deviceInfo: Partial<DeviceInfo>): void => {
  currentState = {
    ...currentState,
    deviceInfo: {
      ...currentState.deviceInfo,
      ...deviceInfo
    }
  };
  publish();
};

export const setRelease = (release: ReleaseManifest | null): void => {
  currentState = { ...currentState, release };
  if (release) {
    updatePersistedMetadata({ releaseId: release.release.id, expectedProduct: release.device });
  }
  publish();
};

export const setDownloadProgress = (download: DownloadProgress | null): void => {
  currentState = { ...currentState, download };
  publish();
};

export const setFlashProgress = (flash: FlashProgress | null): void => {
  currentState = { ...currentState, flash };
  publish();
};

export const setFastbootInspection = (fastbootInspection: FastbootInspection): void => {
  currentState = { ...currentState, fastbootInspection };
  publish();
};

export const setUnlockAcknowledged = (unlockAcknowledged: boolean): void => {
  currentState = { ...currentState, unlockAcknowledged };
  publish();
};

export const setLockAcknowledged = (lockAcknowledged: boolean): void => {
  currentState = { ...currentState, lockAcknowledged };
  publish();
};

export const setVerifiedDigest = (verifiedDigest: string | null): void => {
  currentState = { ...currentState, verifiedDigest, releaseVerified: Boolean(verifiedDigest) };
  publish();
};

export const setCacheKey = (cacheKey: string | null): void => {
  currentState = { ...currentState, cacheKey };
  publish();
};

export const setReleaseStorageState = (storageState: Partial<Pick<AppState, 'releaseComplete' | 'releaseVerified' | 'releaseFileAvailable'>>): void => {
  currentState = { ...currentState, ...storageState };
  publish();
};

export const addLog = (
  level: LogLevel | 'debug' | 'info' | 'warn' | 'error',
  message: string,
  details?: unknown,
  category?: LogCategory
): void => {
  const entry = createLogEntry(level, message, details, category);
  if (!entry) {
    return;
  }
  currentState = {
    ...currentState,
    logs: [...currentState.logs, entry].slice(-300),
    logCount: getLogCount()
  };
  publish();
};

export const enterErrorState = (message: string): void => {
  const entry = createLogEntry('ERROR', message, { currentState: currentState.installerState }, 'ERROR');
  currentState = {
    ...currentState,
    installerState: 'ERROR',
    errorMessage: message,
    statusMessage: message,
    logs: entry ? [...currentState.logs, entry].slice(-300) : currentState.logs,
    logCount: getLogCount()
  };
  publish();
};

export const returnToIdle = (message: string): void => {
  transitionInstallerState('IDLE', message);
};

export const resetSession = (): void => {
  const entry = createLogEntry('INFO', 'Session reset. Reconnect Pixel to continue.');
  currentState = {
    ...initialState,
    sessionId: getSessionInfo().sessionId,
    logs: entry ? [...currentState.logs, entry].slice(-300) : currentState.logs,
    logCount: getLogCount()
  };
  publish();
};

export const restoreLogsForCurrentSession = async (): Promise<void> => {
  const entries = await restoreCurrentLogSession();
  currentState = {
    ...currentState,
    sessionId: getSessionInfo().sessionId,
    logs: entries,
    logCount: getLogCount()
  };
  publish();
};

export const clearInstallationLogs = async (): Promise<void> => {
  await clearCurrentLogSession();
  currentState = {
    ...currentState,
    logs: [],
    logCount: 0
  };
  publish();
};

export const __resetStateForTests = (): void => {
  currentState = {
    ...initialState,
    sessionId: getSessionInfo().sessionId,
    logs: getRamLogEntries(),
    logCount: getLogCount()
  };
  persistedMetadata = {};
  publish();
};
