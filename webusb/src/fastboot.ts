import * as fastboot from './vendor/graphene-fastboot.mjs';
import { FASTBOOT_PACKAGE_NAME } from './config';
import type { FastbootInspection } from './types';

const fastbootPackage = {
  version: 'grapheneos-ffe7e270-worm'
};

export const ZIP_WORKER_BASE_URL = '/fastboot/zip';
export const ZIP_INFLATE_WORKER_URL = `${ZIP_WORKER_BASE_URL}/z-worker-pako.js`;
export const ZIP_PAKO_INFLATE_URL = `${ZIP_WORKER_BASE_URL}/pako_inflate.min.js`;
export const ZIP_INFLATE_WORKER_SCRIPTS = [ZIP_INFLATE_WORKER_URL, ZIP_PAKO_INFLATE_URL] as const;
export const ZIP_WORKER_CONFIGURATION = {
  workerScripts: {
    inflate: [...ZIP_INFLATE_WORKER_SCRIPTS]
  }
};

fastboot.configureZip(ZIP_WORKER_CONFIGURATION);

fastboot.setDebugLevel?.(0);

export type FastbootProgressCallback = (progress: number) => void;
export type FactoryFlashCallback = (action: string | null | undefined, item: string | null | undefined, progress: number | null | undefined) => void;
export type ReconnectCallback = () => void | Promise<void>;

export type FastbootCommandResponse = {
  text: string;
  dataSize?: string | null;
};

export interface FastbootDeviceLike {
  readonly isConnected?: boolean;
  readonly device?: USBDevice | null;
  connect(): Promise<void>;
  getVariable(varName: string): Promise<string | null | undefined>;
  runCommand(command: string): Promise<FastbootCommandResponse>;
  waitForDisconnect(): Promise<void>;
  waitForConnect(onReconnect?: ReconnectCallback): Promise<void>;
  reboot(target?: string, wait?: boolean, onReconnect?: ReconnectCallback): Promise<void>;
  flashBlob(partition: string, blob: Blob, onProgress?: FastbootProgressCallback): Promise<void>;
  flashFactoryZip(blob: Blob, wipe: boolean, onReconnect: ReconnectCallback, onProgress?: FactoryFlashCallback): Promise<void>;
}

type FastbootConstructor = new () => FastbootDeviceLike;

export type NormalizedUnlockedState = 'yes' | 'no' | 'unknown';

export const normalizeUnlockedState = (value: string | null | undefined): NormalizedUnlockedState => {
  if (!value) {
    return 'unknown';
  }
  const normalized = value.trim().toLowerCase();
  if (['yes', 'true', '1', 'unlocked'].includes(normalized)) {
    return 'yes';
  }
  if (['no', 'false', '0', 'locked'].includes(normalized)) {
    return 'no';
  }
  return 'unknown';
};

const moduleKeys = (value: unknown): string[] => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return [];
  }
  return Object.getOwnPropertyNames(value).sort();
};

export const inspectAndroidFastboot = async (): Promise<FastbootInspection> => {
  const api = moduleKeys(fastboot.FastbootDevice.prototype);
  return {
    packageName: FASTBOOT_PACKAGE_NAME,
    version: fastbootPackage.version,
    exports: Object.keys(fastboot).sort(),
    fastbootDeviceApi: api,
    flashFactoryZipSignature: 'FastbootDevice.flashFactoryZip(blob, wipe, onReconnect, onProgress)',
    configureZip: ZIP_WORKER_CONFIGURATION,
    zipWorkers: [...ZIP_INFLATE_WORKER_SCRIPTS],
    source: 'runtime-module'
  };
};

export const createFastbootDevice = async (): Promise<FastbootDeviceLike> => {
  return new fastboot.FastbootDevice();
};
