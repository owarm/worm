export type FastbootCommandResponse = {
  text: string;
  dataSize?: string | null;
};

export type FactoryProgressCallback = (action: string, item: string | null, progress: number | null) => void;
export type FlashProgressCallback = (progress: number) => void;
export type ReconnectCallback = () => void | Promise<void>;

export class FastbootError extends Error {
  readonly status: string;
  readonly bootloaderMessage: string;
  constructor(status: string, message: string);
}

export class InstallerError extends Error {
  constructor(message: string);
}

export class FastbootDevice {
  readonly isConnected?: boolean;
  readonly device?: USBDevice | null;
  connect(): Promise<void>;
  getVariable(varName: string): Promise<string | null | undefined>;
  runCommand(command: string): Promise<FastbootCommandResponse>;
  waitForDisconnect(): Promise<void>;
  waitForConnect(onReconnect?: ReconnectCallback): Promise<void>;
  reboot(target?: string, wait?: boolean, onReconnect?: ReconnectCallback): Promise<void>;
  flashBlob(partition: string, blob: Blob, onProgress?: FlashProgressCallback): Promise<void>;
  flashFactoryZip(blob: Blob, wipe: boolean, onReconnect: ReconnectCallback, onProgress?: FactoryProgressCallback): Promise<void>;
}

export const FactoryImageLayout: {
  readonly OLD_FACTORY_IMAGE_ZIP: 'OLD_FACTORY_IMAGE_ZIP';
  readonly NEW_GRAPHENEOS_INSTALL_LAYOUT: 'NEW_GRAPHENEOS_INSTALL_LAYOUT';
  readonly UNSUPPORTED: 'UNSUPPORTED';
};

export const USER_ACTION_MAP: Record<string, string>;

export function configureZip(configuration: {
  chunkSize?: number;
  maxWorkers?: number;
  useWebWorkers?: boolean;
  workerScripts?: {
    deflate?: string[];
    inflate?: string[];
  };
}): void;

export function detectFactoryImageLayout(blob: Blob): Promise<
  | typeof FactoryImageLayout.OLD_FACTORY_IMAGE_ZIP
  | typeof FactoryImageLayout.NEW_GRAPHENEOS_INSTALL_LAYOUT
  | typeof FactoryImageLayout.UNSUPPORTED
>;

export function setDebugLevel(level: number): void;

export class BlobReader {
  constructor(blob: Blob);
}

export class BlobWriter {
  constructor(contentType?: string);
}

export class TextWriter {
  constructor();
}

export class ZipReader<TReader = BlobReader> {
  constructor(reader: TReader);
  getEntries(): Promise<Array<{
    filename: string;
    getData<TWriter>(writer: TWriter, options?: { onprogress?: (bytes: number, total: number) => void }): Promise<unknown>;
  }>>;
  close(): Promise<void>;
}
