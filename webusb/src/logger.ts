import packageJson from '../package.json';
import type { AppState, LogCategory, LogEntry, LogLevel, ReleaseManifest } from './types';

export const LOG_SCHEMA_VERSION = 1;
export const INSTALLATION_LOG_STORE = 'installationLogs';

const DB_NAME = 'worm-os-installer';
const DB_VERSION = 3;
const CURRENT_SESSION_KEY = 'worm-os-installer:current-log-session';
const RING_BUFFER_SIZE = 300;
const DEDUPE_WINDOW_MS = 10_000;
const SECRET_KEYS = /authorization|auth|private|token|password|secret|credential|keyMaterial|passphrase/i;
const SERIAL_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,}$/;
const TECHNICAL_LEVELS = new Set<LogLevel>([
  'FASTBOOT',
  'USB',
  'DOWNLOAD',
  'VERIFY',
  'DEVICE',
  'ZIP',
  'FLASH',
  'RECONNECT',
  'BOOTLOADER',
  'COMPLETE',
  'STATE',
  'BROWSER'
]);
const NOISY_MESSAGE_PATTERNS = [
  /fastboot engine version/i,
  /application starting/i,
  /build (version|timestamp)/i,
  /browser capability|user agent|secure context|WebUSB available|OPFS available|IndexedDB available|Wake Lock available|storage estimate|storage quota|hardwareConcurrency|deviceMemory/i,
  /configureZip|worker configuration|worker scripts|inflate worker URL|asset reachable: yes/i,
  /visibility ->|pagehide|pageshow|WakeLock (acquired|released)|IndexedDB initialized|OPFS initialized/i,
  /Cache lookup|Cached file not found|Complete release found|Cached release reused|Existing bytes|Checkpoint metadata|HTTP (Range|status)|Download requested/i,
  /getDevices scan|Reconnect attempt|Authorized Google devices found|Candidate accepted|Expected device|Expected masked serial|Disconnect detected/i,
  /getvar .*->|getvar .*completed|getvar .*unsupported|Current unlocked state|snapshot-update-status none|snapshot-update-status unsupported/i,
  /STATE|->|prerequisites|Raw flash progress sample|raw progress|last activity|USB transfer (started|completed)|command (start|complete)|configuration selected|interface claimed|USB open completed/i,
  /Factory ZIP selected|release file source|file\.size|expected size|file\.type|release id|SHA verified|device connected|current-slot|is-userspace|max-download-size/i
];
const ESSENTIAL_MESSAGE_PATTERNS = [
  /^Pixel connected$/,
  /^Device verified$/,
  /^Download started$/,
  /^Download (25|50|75)%$/,
  /^Download complete$/,
  /^Verifying image$/,
  /^(50|100)%$/,
  /^Image verified$/,
  /^Installation started$/,
  /^Unpacking bootloader$/,
  /^Bootloader (25|50|75|100)%$/,
  /^Preparing .+/,
  /^Flashing .+ (0|25|50|75|100)%$/,
  /^radio start$/,
  /^radio (0|25|50|75|100)%$/,
  /^radio complete$/,
  /^Lock requested$/,
  /^Waiting for confirmation$/,
  /^Bootloader locked$/,
  /^Rebooting$/,
  /^Complete$/,
  /^Pixel restarted$/,
  /^Waiting for manual reconnect$/,
  /^Reconnect Pixel clicked$/,
  /^requested after radio$/,
  /^waiting for manual click$/,
  /^connect\(\) start$/,
  /^connect\(\) success$/,
  /^Pixel reconnected$/,
  /^Installation resumed$/,
  /^Verified Boot key$/,
  /^Installation complete$/,
  /^Mode: (Bootloader|Fastbootd)$/,
  /^Worm OS installation complete$/
];

type StoredLogSession = {
  sessionId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  entries: LogEntry[];
};

export type BrowserCapabilities = {
  version: string;
  buildVersion: string;
  buildTimestamp: string;
  userAgent: string;
  secureContext: boolean;
  webUsb: boolean;
  opfs: boolean;
  indexedDb: boolean;
  wakeLock: boolean;
  persistentStorageGranted: boolean | null;
  storageQuota: number | null;
  storageUsage: number | null;
  manifestUrl: string;
};

export type DiagnosticLogExport = {
  schemaVersion: typeof LOG_SCHEMA_VERSION;
  session: {
    sessionId: string;
    createdAt: string;
    updatedAt: string;
  };
  release: ReleaseManifest | null;
  device: {
    product: string;
    serial: string;
    bootloader: string;
  };
  browser: BrowserCapabilities | null;
  summary: {
    device: string;
    releaseId: string | null;
    imageVerificationResult: string;
    installResult: string;
    durationMs: number | null;
  };
  entries: LogEntry[];
};

let nextLogId = 1;
let activeSessionId: string | null = null;
let activeCreatedAt: string | null = null;
let ramEntries: LogEntry[] = [];
let totalEntryCount = 0;
let browserCapabilities: BrowserCapabilities | null = null;
let activeSessionPersistent = true;
const memorySessions = new Map<string, StoredLogSession>();
const recentMessages = new Map<string, number>();

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')));
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')));
  });

const openLogDb = async (): Promise<IDBDatabase> => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.addEventListener('upgradeneeded', () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('releases')) {
      db.createObjectStore('releases', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('metadata')) {
      db.createObjectStore('metadata');
    }
    if (!db.objectStoreNames.contains(INSTALLATION_LOG_STORE)) {
      db.createObjectStore(INSTALLATION_LOG_STORE, { keyPath: 'sessionId' });
    }
  });
  return requestToPromise(request);
};

const withLogStore = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T> | T): Promise<T> => {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available.');
  }
  const db = await openLogDb();
  try {
    const transaction = db.transaction(INSTALLATION_LOG_STORE, mode);
    const result = await work(transaction.objectStore(INSTALLATION_LOG_STORE));
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
};

const datePart = (date: Date): string =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

const timePart = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

const randomPart = (): string => {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const createInstallationSessionId = (date = new Date()): string => `worm-${datePart(date)}-${timePart(date)}-${randomPart()}`;
export const createTestInstallationSessionId = (date = new Date()): string => `test-${datePart(date)}-${timePart(date)}-${randomPart()}`;

export const maskSerial = (serial: string | null | undefined): string => {
  if (!serial || serial === 'Unavailable' || serial === 'Not connected') {
    return serial ?? 'Unavailable';
  }
  if (serial.length <= 10) {
    return `${serial.slice(0, 2)}...${serial.slice(-2)}`;
  }
  return `${serial.slice(0, 6)}...${serial.slice(-4)}`;
};

const sanitizeValue = (value: unknown, key = ''): unknown => {
  if (SECRET_KEYS.test(key)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    if (/basic\s+[a-z0-9+/=]+/i.test(value)) {
      return value.replace(/basic\s+[a-z0-9+/=]+/gi, 'Basic [redacted]');
    }
    return SERIAL_VALUE.test(value) && key.toLowerCase().includes('serial') ? maskSerial(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]));
  }
  return value;
};

const normalizeLevel = (level: LogLevel | Lowercase<Extract<LogLevel, 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'>>): LogLevel => {
  const upper = level.toUpperCase() as LogLevel;
  return TECHNICAL_LEVELS.has(upper) ? 'INFO' : upper;
};

const normalizeCategory = (level: LogLevel, category?: LogCategory): LogCategory => {
  if (category) return category;
  const upper = level.toUpperCase() as LogLevel;
  return TECHNICAL_LEVELS.has(upper) ? upper : level;
};

const isNoisyEntry = (level: LogLevel, category: LogCategory, message: string): boolean => {
  if (level === 'DEBUG') return true;
  if (level === 'ERROR' || level === 'WARN' || level === 'SUCCESS') return false;
  if (ESSENTIAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) return false;
  if (category === 'INFO') return true;
  if (category === 'STATE' || category === 'BROWSER') return true;
  return NOISY_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
};

const isDuplicateEntry = (category: LogCategory, message: string, details?: unknown, nowMs = Date.now()): boolean => {
  const reconnectSequence =
    category === 'RECONNECT' && details && typeof details === 'object' && 'reconnectSequence' in details
      ? String((details as { reconnectSequence?: unknown }).reconnectSequence ?? '')
      : '';
  const key = `${category}\n${message}\n${reconnectSequence}`;
  const lastSeen = recentMessages.get(key);
  recentMessages.set(key, nowMs);
  for (const [entryKey, timestamp] of recentMessages) {
    if (nowMs - timestamp > DEDUPE_WINDOW_MS) {
      recentMessages.delete(entryKey);
    }
  }
  return lastSeen !== undefined && nowMs - lastSeen < DEDUPE_WINDOW_MS;
};

const getSessionId = (): string => {
  if (!activeSessionId) {
    const restored = typeof localStorage === 'undefined' ? null : localStorage.getItem(CURRENT_SESSION_KEY);
    activeSessionId = restored || createInstallationSessionId();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CURRENT_SESSION_KEY, activeSessionId);
    }
  }
  return activeSessionId;
};

const retainFiveSessions = async (): Promise<void> => {
  if (typeof indexedDB === 'undefined') {
    const sessions = Array.from(memorySessions.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    sessions.slice(0, Math.max(0, sessions.length - 5)).forEach((session) => memorySessions.delete(session.sessionId));
    return;
  }
  await withLogStore('readwrite', async (store) => {
    const sessions = await requestToPromise<StoredLogSession[]>(store.getAll());
    sessions
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, sessions.length - 5))
      .forEach((session) => store.delete(session.sessionId));
  });
};

const persistEntry = async (entry: LogEntry): Promise<void> => {
  if (!activeSessionPersistent) {
    return;
  }
  if (typeof indexedDB === 'undefined') {
    const existing = memorySessions.get(entry.sessionId);
    const createdAt = existing?.createdAt ?? activeCreatedAt ?? entry.timestamp;
    memorySessions.set(entry.sessionId, {
      sessionId: entry.sessionId,
      schemaVersion: LOG_SCHEMA_VERSION,
      createdAt,
      updatedAt: entry.timestamp,
      entries: [...(existing?.entries ?? []), entry].slice(-RING_BUFFER_SIZE)
    });
    activeCreatedAt = createdAt;
    await retainFiveSessions();
    return;
  }
  await withLogStore('readwrite', async (store) => {
    const existing = await requestToPromise<StoredLogSession | undefined>(store.get(entry.sessionId));
    const createdAt = existing?.createdAt ?? activeCreatedAt ?? entry.timestamp;
    const session: StoredLogSession = {
      sessionId: entry.sessionId,
      schemaVersion: LOG_SCHEMA_VERSION,
      createdAt,
      updatedAt: entry.timestamp,
      entries: [...(existing?.entries ?? []), entry].slice(-RING_BUFFER_SIZE)
    };
    store.put(session);
    activeCreatedAt = createdAt;
  });
  await retainFiveSessions();
};

export const createLogEntry = (
  level: LogLevel | 'debug' | 'info' | 'warn' | 'error',
  message: string,
  details?: unknown,
  category?: LogCategory
): LogEntry | null => {
  const normalizedLevel = normalizeLevel(level);
  const normalizedCategory = normalizeCategory((level.toUpperCase() as LogLevel), category);
  if (isNoisyEntry(normalizedLevel, normalizedCategory, message) || isDuplicateEntry(normalizedCategory, message, details)) {
    return null;
  }
  const entry: LogEntry = {
    id: nextLogId++,
    sessionId: getSessionId(),
    level: normalizedLevel,
    category: normalizedCategory,
    message,
    timestamp: new Date().toISOString(),
    details: details === undefined ? undefined : sanitizeValue(details)
  };
  ramEntries = [...ramEntries, entry].slice(-RING_BUFFER_SIZE);
  totalEntryCount += 1;
  void persistEntry(entry).catch(() => undefined);
  return entry;
};

export const getSessionInfo = (): { sessionId: string; createdAt: string | null; logCount: number } => ({
  sessionId: getSessionId(),
  createdAt: activeCreatedAt,
  logCount: totalEntryCount
});

export const getRamLogEntries = (): LogEntry[] => ramEntries;

export const getLogCount = (): number => totalEntryCount;

export const beginRamOnlyLogSession = (sessionId: string): void => {
  activeSessionId = sessionId;
  activeCreatedAt = new Date().toISOString();
  activeSessionPersistent = false;
  ramEntries = [];
  totalEntryCount = 0;
  nextLogId = 1;
  recentMessages.clear();
};

export const restorePersistentLogSession = (): void => {
  activeSessionId = null;
  activeCreatedAt = null;
  activeSessionPersistent = true;
  ramEntries = [];
  totalEntryCount = 0;
  nextLogId = 1;
  recentMessages.clear();
};

export const restoreCurrentLogSession = async (): Promise<LogEntry[]> => {
  const sessionId = getSessionId();
  try {
    if (typeof indexedDB === 'undefined') {
      const session = memorySessions.get(sessionId);
      const entries = session?.entries ?? [];
      activeCreatedAt = session?.createdAt ?? activeCreatedAt;
      ramEntries = entries.slice(-RING_BUFFER_SIZE);
      totalEntryCount = entries.length;
      const maxId = entries.reduce((max, entry) => Math.max(max, entry.id), 0);
      nextLogId = Math.max(nextLogId, maxId + 1);
      return ramEntries;
    }
    const session = await withLogStore('readonly', (store) => requestToPromise<StoredLogSession | undefined>(store.get(sessionId)));
    const entries = session?.entries ?? [];
    activeCreatedAt = session?.createdAt ?? activeCreatedAt;
    ramEntries = entries.slice(-RING_BUFFER_SIZE);
    totalEntryCount = entries.length;
    const maxId = entries.reduce((max, entry) => Math.max(max, entry.id), 0);
    nextLogId = Math.max(nextLogId, maxId + 1);
    return ramEntries;
  } catch {
    return ramEntries;
  }
};

export const clearCurrentLogSession = async (): Promise<void> => {
  const sessionId = getSessionId();
  ramEntries = [];
  totalEntryCount = 0;
  if (typeof indexedDB === 'undefined') {
    memorySessions.delete(sessionId);
  } else {
    await withLogStore('readwrite', (store) => {
      store.delete(sessionId);
    }).catch(() => undefined);
  }
};

export const getStoredLogSession = async (sessionId = getSessionId()): Promise<StoredLogSession | null> => {
  try {
    if (typeof indexedDB === 'undefined') {
      return memorySessions.get(sessionId) ?? null;
    }
    return await withLogStore('readonly', (store) => requestToPromise<StoredLogSession | undefined>(store.get(sessionId))).then((value) => value ?? null);
  } catch {
    return null;
  }
};

const timeWithMilliseconds = (timestamp: string): string => {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(
    date.getMilliseconds()
  ).padStart(3, '0')}`;
};

export const formatLogEntry = (entry: LogEntry): string => `[${timeWithMilliseconds(entry.timestamp)}] [${entry.category}] ${entry.message}`;

export const formatTextLog = (entries: LogEntry[]): string => entries.map(formatLogEntry).join('\n');

const installResultFromEntries = (entries: LogEntry[]): string => {
  if (entries.some((entry) => ['SUCCESS', 'COMPLETE'].includes(entry.category) && entry.message === 'Worm OS installation complete')) return 'complete';
  if (entries.some((entry) => entry.level === 'ERROR')) return 'failed';
  return 'incomplete';
};

const verificationResultFromEntries = (entries: LogEntry[], state: AppState): string => {
  if (state.releaseVerified || entries.some((entry) => entry.category === 'VERIFY' && entry.message === 'Image verified')) return 'verified';
  if (entries.some((entry) => entry.category === 'VERIFY' && entry.message === 'Verification failed')) return 'failed';
  return 'not_verified';
};

const durationFromEntries = (entries: LogEntry[]): number | null => {
  const first = entries[0]?.timestamp;
  const last = entries.at(-1)?.timestamp;
  if (!first || !last) return null;
  const duration = new Date(last).getTime() - new Date(first).getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
};

export const setBrowserCapabilities = (capabilities: BrowserCapabilities): void => {
  browserCapabilities = capabilities;
};

export const getBrowserCapabilities = (): BrowserCapabilities | null => browserCapabilities;

export const collectBrowserCapabilities = async (manifestUrl: string): Promise<BrowserCapabilities> => {
  const nav = navigator as Navigator & { userAgent?: string; storage?: StorageManager };
  const storageEstimate = await nav.storage?.estimate?.().catch(() => null);
  const persistentStorageGranted = await nav.storage?.persisted?.().catch(() => null);
  return {
    version: packageJson.version,
    buildVersion: import.meta.env.VITE_BUILD_VERSION || packageJson.version,
    buildTimestamp: import.meta.env.VITE_BUILD_TIMESTAMP || new Date().toISOString(),
    userAgent: (nav.userAgent ?? 'unknown').replace(/\s+/g, ' ').slice(0, 160),
    secureContext: globalThis.isSecureContext === true,
    webUsb: 'usb' in nav,
    opfs: Boolean(nav.storage && 'getDirectory' in nav.storage),
    indexedDb: typeof indexedDB !== 'undefined',
    wakeLock: 'wakeLock' in nav,
    persistentStorageGranted,
    storageQuota: typeof storageEstimate?.quota === 'number' ? storageEstimate.quota : null,
    storageUsage: typeof storageEstimate?.usage === 'number' ? storageEstimate.usage : null,
    manifestUrl
  };
};

export const createDiagnosticJson = async (state: AppState): Promise<DiagnosticLogExport> => {
  const stored = await getStoredLogSession(state.sessionId);
  const entries = stored?.entries ?? state.logs;
  const sanitizedEntries = entries.map((entry) => ({
    ...entry,
    details: entry.details === undefined ? undefined : sanitizeValue(entry.details)
  }));
  return {
    schemaVersion: LOG_SCHEMA_VERSION,
    session: {
      sessionId: state.sessionId,
      createdAt: stored?.createdAt ?? state.logs[0]?.timestamp ?? new Date().toISOString(),
      updatedAt: stored?.updatedAt ?? state.logs.at(-1)?.timestamp ?? new Date().toISOString()
    },
    release: state.release,
    device: {
      product: state.deviceInfo.product,
      serial: maskSerial(state.deviceInfo.serial),
      bootloader: state.deviceInfo.bootloader
    },
    browser: null,
    summary: {
      device: state.deviceInfo.product === 'Unknown' ? state.release?.device ?? 'frankel' : state.deviceInfo.product,
      releaseId: state.release?.release.id ?? null,
      imageVerificationResult: verificationResultFromEntries(sanitizedEntries, state),
      installResult: installResultFromEntries(sanitizedEntries),
      durationMs: durationFromEntries(sanitizedEntries)
    },
    entries: sanitizedEntries
  };
};

export const __resetLoggerForTests = (): void => {
  nextLogId = 1;
  activeSessionId = null;
  activeCreatedAt = null;
  ramEntries = [];
  totalEntryCount = 0;
  browserCapabilities = null;
  activeSessionPersistent = true;
  memorySessions.clear();
  recentMessages.clear();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(CURRENT_SESSION_KEY);
  }
};

export const __startLoggerSessionForTests = (sessionId: string): void => {
  activeSessionId = sessionId;
  activeCreatedAt = null;
  ramEntries = [];
  totalEntryCount = 0;
  nextLogId = 1;
  activeSessionPersistent = true;
  recentMessages.clear();
};
