declare module 'android-fastboot' {
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

  export class FastbootDevice {
    readonly isConnected?: boolean;
    readonly device?: USBDevice | null;
    connect(): Promise<void>;
    getVariable(varName: string): Promise<string | null | undefined>;
    runCommand(command: string): Promise<FastbootCommandResponse>;
    waitForDisconnect(): Promise<void>;
    waitForConnect(onReconnect?: ReconnectCallback): Promise<void>;
    reboot(target?: string, wait?: boolean, onReconnect?: ReconnectCallback): Promise<void>;
    flashFactoryZip(blob: Blob, wipe: boolean, onReconnect: ReconnectCallback, onProgress?: FactoryProgressCallback): Promise<void>;
  }

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

  export function setDebugLevel(level: number): void;
}

declare module 'android-fastboot/package.json' {
  const packageJson: {
    version: string;
  };
  export default packageJson;
}
