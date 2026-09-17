export const INSTALLER_STATES = [
  'IDLE',
  'CONNECTING',
  'CONNECTED',
  'DEVICE_VERIFIED',
  'UNLOCK_REQUIRED',
  'UNLOCKING',
  'WAITING_USER_UNLOCK',
  'UNLOCKED',
  'DOWNLOADING',
  'DOWNLOAD_PAUSED',
  'DOWNLOADED',
  'VERIFYING',
  'VERIFIED',
  'FLASHING',
  'WAITING_FOR_RECONNECT',
  'WAITING_FOR_FLASH_RESUME',
  'RECONNECTING',
  'WAITING_MANUAL_RECONNECT',
  'FLASH_COMPLETE',
  'LOCK_READY',
  'LOCKING',
  'WAITING_USER_LOCK',
  'LOCKED',
  'REBOOTING',
  'COMPLETE',
  'ERROR'
] as const;

export type InstallerState = (typeof INSTALLER_STATES)[number];

export type SafeStage =
  | 'IDLE'
  | 'CONNECTED'
  | 'DEVICE_VERIFIED'
  | 'UNLOCK_REQUIRED'
  | 'UNLOCKED'
  | 'DOWNLOAD_PAUSED'
  | 'DOWNLOADED'
  | 'VERIFIED'
  | 'FLASH_COMPLETE'
  | 'LOCK_READY'
  | 'LOCKED'
  | 'COMPLETE';

export type DeviceInfo = {
  device: string;
  product: string;
  serial: string;
  bootloader: string;
};

export type ReleaseManifest = {
  schema?: 1;
  channel: string;
  device: 'frankel';
  build?: string;
  android?: string;
  install_url?: string;
  ota_url?: string;
  sha256?: string;
  build_timestamp?: string;
  release: {
    id: string;
    file: string;
    sha256: string;
    size: number;
  };
};

export type ReleaseMetadata = {
  key: string;
  device: 'frankel';
  releaseId: string;
  expectedSha256: string;
  expectedSize: number;
  downloadedBytes: number;
  complete: boolean;
  verified: boolean;
  etag?: string;
  lastModified?: string;
  updatedAt: string;
};

export type CachedRelease = {
  blob: Blob;
  metadata: ReleaseMetadata;
};

export type PersistedInstallerMetadata = {
  releaseId?: string;
  expectedProduct?: string;
  expectedSerial?: string;
  lastSafeStage?: SafeStage;
  installerStage?: InstallerState;
  flashStepIndex?: number;
};

export type LogLevel =
  | 'DEBUG'
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  | 'SUCCESS'
  | 'FASTBOOT'
  | 'USB'
  | 'DOWNLOAD'
  | 'VERIFY'
  | 'DEVICE'
  | 'ZIP'
  | 'FLASH'
  | 'RECONNECT'
  | 'BOOTLOADER'
  | 'COMPLETE'
  | 'STATE'
  | 'BROWSER';

export type LogCategory = LogLevel;

export type LogEntry = {
  id: number;
  sessionId: string;
  category: LogCategory;
  level: LogLevel;
  message: string;
  timestamp: string;
  details?: unknown;
};

export type FastbootInspection = {
  packageName: string;
  version: string;
  exports: string[];
  fastbootDeviceApi: string[];
  flashFactoryZipSignature: string;
  configureZip: unknown;
  zipWorkers: string[];
  source: 'runtime-module' | 'documentation' | 'unavailable';
};

export type DownloadProgress = {
  releaseId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  storedLocally: boolean;
  verified: boolean;
  status: string;
};

export type VerifyProgress = {
  state: 'idle' | 'checking-cache' | 'verifying' | 'verified' | 'failed';
  verifiedBytes: number;
  totalBytes: number;
  percent: number;
  expectedSha256: string | null;
  actualSha256: string | null;
  metadataVerified: boolean;
  fileAvailable: boolean;
  fileSize: number | null;
};

export type FlashProgress = {
  operation: string;
  item: string | null;
  itemPercent: number;
  overallPercent: number | null;
  rawProgress: number | null;
  overallIndeterminate: boolean;
};

export type AppState = {
  sessionId: string;
  testMode: boolean;
  testReconnectSequence: number;
  installerState: InstallerState;
  deviceInfo: DeviceInfo;
  release: ReleaseManifest | null;
  download: DownloadProgress | null;
  flash: FlashProgress | null;
  progress: number;
  statusMessage: string;
  errorMessage: string | null;
  logs: LogEntry[];
  logCount: number;
  fastbootInspection: FastbootInspection | null;
  unlockAcknowledged: boolean;
  lockAcknowledged: boolean;
  verifiedDigest: string | null;
  cacheKey: string | null;
  expectedSerial: string | null;
  releaseComplete: boolean;
  releaseVerified: boolean;
  releaseFileAvailable: boolean;
  verify: VerifyProgress;
};

export type StateListener = (state: AppState) => void;

export class InstallerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallerError';
  }
}

export class InstallerStateError extends InstallerError {
  constructor(from: InstallerState, to: InstallerState) {
    super(`Illegal installer state transition: ${from} -> ${to}`);
    this.name = 'InstallerStateError';
  }
}

export class UnsupportedDeviceError extends InstallerError {
  constructor(message = 'This device is not supported by the web installer.') {
    super(message);
    this.name = 'UnsupportedDeviceError';
  }
}

export class WrongDeviceError extends InstallerError {
  constructor(message = 'The reconnected Pixel does not match the expected device.') {
    super(message);
    this.name = 'WrongDeviceError';
  }
}

export class ReleaseVerificationError extends InstallerError {
  constructor(message = 'Release verification failed. Firmware will not be flashed.') {
    super(message);
    this.name = 'ReleaseVerificationError';
  }
}

export class ReconnectTimeoutError extends InstallerError {
  constructor(message = 'Reconnect wait expired.') {
    super(message);
    this.name = 'ReconnectTimeoutError';
  }
}

export class WebUsbUnavailableError extends InstallerError {
  constructor(message = 'WebUSB is not available in this browser.') {
    super(message);
    this.name = 'WebUsbUnavailableError';
  }
}
