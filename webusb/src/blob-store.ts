import type { CachedRelease, ReleaseManifest, ReleaseMetadata } from './types';
import { InstallerError } from './types';
import { releaseFilename, releaseKey } from './release';

const DB_NAME = 'worm-os-installer';
const DB_VERSION = 3;
const LEGACY_RELEASES_STORE = 'releases';
const METADATA_STORE = 'metadata';
const INSTALLATION_LOG_STORE = 'installationLogs';

type StorageManagerWithOpfs = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

const persistentStorageMessage = 'Not enough persistent browser storage for the Worm OS release.';

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new InstallerError('IndexedDB request failed.')));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new InstallerError('IndexedDB transaction aborted.')));
    transaction.addEventListener('error', () => reject(transaction.error ?? new InstallerError('IndexedDB transaction failed.')));
  });

export class BlobStore {
  private db: IDBDatabase | null = null;
  private opfsRoot: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    if (this.db) {
      return;
    }

    await this.requestPersistentStorage();
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_RELEASES_STORE)) {
        db.createObjectStore(LEGACY_RELEASES_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE);
      }
      if (!db.objectStoreNames.contains(INSTALLATION_LOG_STORE)) {
        db.createObjectStore(INSTALLATION_LOG_STORE, { keyPath: 'sessionId' });
      }
    });

    this.db = await requestToPromise(request);
  }

  async inspect(manifest: ReleaseManifest): Promise<CachedRelease | null> {
    const metadata = await this.getMetadata(releaseKey(manifest));
    const file = await this.getReleaseFile(manifest);
    if (!file || !metadata) {
      return null;
    }
    return { blob: file, metadata };
  }

  async getRelease(key: string): Promise<CachedRelease | null> {
    const metadata = await this.getMetadata(key);
    if (!metadata) {
      return null;
    }
    const file = await this.getFileByName(this.filenameFromMetadata(metadata));
    if (!file) {
      return null;
    }
    return { blob: file, metadata };
  }

  async getReleaseFile(manifest: ReleaseManifest): Promise<File | null> {
    return this.getFileByName(releaseFilename(manifest));
  }

  async getWritable(manifest: ReleaseManifest): Promise<FileSystemWritableFileStream> {
    const handle = await this.getFileHandle(manifest, true);
    return handle.createWritable({ keepExistingData: true });
  }

  async saveMetadata(key: string, metadata: ReleaseMetadata): Promise<void> {
    const db = this.requireDb();
    const transaction = db.transaction(METADATA_STORE, 'readwrite');
    transaction.objectStore(METADATA_STORE).put(metadata, key);
    await transactionDone(transaction);
  }

  async getMetadata(key: string): Promise<ReleaseMetadata | null> {
    const db = this.requireDb();
    const transaction = db.transaction(METADATA_STORE, 'readonly');
    const record = await requestToPromise<ReleaseMetadata | undefined>(transaction.objectStore(METADATA_STORE).get(key));
    await transactionDone(transaction);
    return record ?? null;
  }

  async saveRelease(key: string, blob: Blob, metadata: ReleaseMetadata): Promise<void> {
    const manifest = this.manifestFromMetadata(metadata);
    const writable = await this.getWritable(manifest);
    await writable.truncate(0);
    await writable.write(blob);
    await writable.close();
    await this.saveMetadata(key, {
      ...metadata,
      downloadedBytes: blob.size,
      complete: blob.size === metadata.expectedSize,
      updatedAt: new Date().toISOString()
    });
  }

  async deleteRelease(key: string): Promise<void> {
    const metadata = await this.getMetadata(key);
    if (metadata) {
      await this.deleteFile(this.filenameFromMetadata(metadata));
    }
    const db = this.requireDb();
    const transaction = db.transaction([LEGACY_RELEASES_STORE, METADATA_STORE], 'readwrite');
    transaction.objectStore(LEGACY_RELEASES_STORE).delete(key);
    transaction.objectStore(METADATA_STORE).delete(key);
    await transactionDone(transaction);
  }

  async deleteManifestRelease(manifest: ReleaseManifest): Promise<void> {
    await this.deleteFile(releaseFilename(manifest));
    await this.deleteRelease(releaseKey(manifest));
  }

  async clear(): Promise<void> {
    const db = this.requireDb();
    const readTransaction = db.transaction(METADATA_STORE, 'readonly');
    const metadata = await requestToPromise<ReleaseMetadata[]>(readTransaction.objectStore(METADATA_STORE).getAll());
    await transactionDone(readTransaction);

    for (const record of metadata) {
      await this.deleteFile(this.filenameFromMetadata(record));
    }

    const transaction = db.transaction([LEGACY_RELEASES_STORE, METADATA_STORE], 'readwrite');
    transaction.objectStore(LEGACY_RELEASES_STORE).clear();
    transaction.objectStore(METADATA_STORE).clear();
    await transactionDone(transaction);
  }

  async ensureEnoughStorage(requiredBytes: number, existingBytes = 0): Promise<void> {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || typeof estimate.quota !== 'number') {
      return;
    }
    const usage = typeof estimate.usage === 'number' ? estimate.usage : 0;
    const available = Math.max(0, estimate.quota - usage);
    const remaining = Math.max(0, requiredBytes - existingBytes);
    const buffer = Math.min(256 * 1024 * 1024, Math.max(32 * 1024 * 1024, Math.ceil(requiredBytes * 0.03)));
    if (available < remaining + buffer) {
      throw new InstallerError(persistentStorageMessage);
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.opfsRoot = null;
  }

  private async requestPersistentStorage(): Promise<void> {
    await navigator.storage?.persist?.().catch(() => false);
  }

  private async getFileByName(filename: string): Promise<File | null> {
    try {
      const root = await this.requireOpfsRoot();
      const handle = await root.getFileHandle(filename);
      return handle.getFile();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return null;
      }
      throw error;
    }
  }

  private async getFileHandle(manifest: ReleaseManifest, create: boolean): Promise<FileSystemFileHandle> {
    const root = await this.requireOpfsRoot();
    return root.getFileHandle(releaseFilename(manifest), { create });
  }

  private async deleteFile(filename: string): Promise<void> {
    const root = await this.requireOpfsRoot();
    await root.removeEntry(filename).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
        throw error;
      }
    });
  }

  private async requireOpfsRoot(): Promise<FileSystemDirectoryHandle> {
    if (this.opfsRoot) {
      return this.opfsRoot;
    }
    const storage = navigator.storage as StorageManagerWithOpfs | undefined;
    if (!storage?.getDirectory) {
      throw new InstallerError('Persistent browser file storage is not available in this browser.');
    }
    this.opfsRoot = await storage.getDirectory();
    return this.opfsRoot;
  }

  private requireDb(): IDBDatabase {
    if (!this.db) {
      throw new InstallerError('BlobStore has not been initialized.');
    }
    return this.db;
  }

  private filenameFromMetadata(metadata: ReleaseMetadata): string {
    return `worm-${metadata.device}-${metadata.releaseId}.zip`;
  }

  private manifestFromMetadata(metadata: ReleaseMetadata): ReleaseManifest {
    return {
      schema: 1,
      channel: 'stable',
      device: metadata.device,
      release: {
        id: metadata.releaseId,
        file: `/releases/${this.filenameFromMetadata(metadata)}`,
        sha256: metadata.expectedSha256,
        size: metadata.expectedSize
      }
    };
  }
}
