import { DEVICE_TARGET } from './config';
import type { DownloadProgress, ReleaseManifest, ReleaseMetadata } from './types';
import { InstallerError } from './types';
import type { BlobStore } from './blob-store';
import type { LogCategory, LogLevel } from './types';

export const MANIFEST_URL = '/releases/stable/frankel.json';
export const LEGACY_MANIFEST_URL = '/manifest.json';
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const SAFE_RELEASE_PATH = /^\/releases\/(?:[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+\.zip$/;
const SAFE_RELEASE_ID = /^[A-Za-z0-9._-]+$/;
const CHECKPOINT_BYTES = 8 * 1024 * 1024;
const CHECKPOINT_MS = 2_000;

type ReleaseLog = (level: LogLevel | 'debug' | 'info' | 'warn' | 'error', message: string, details?: unknown, category?: LogCategory) => void;

type RawManifest = {
  schema?: unknown;
  channel?: unknown;
  device?: unknown;
  build?: unknown;
  android?: unknown;
  install_url?: unknown;
  ota_url?: unknown;
  sha256?: unknown;
  size?: unknown;
  build_timestamp?: unknown;
  release?: {
    id?: unknown;
    file?: unknown;
    sha256?: unknown;
    size?: unknown;
  };
};

const getReleaseBaseUrl = (): string | undefined => {
  const env = import.meta.env.VITE_RELEASE_BASE_URL as string | undefined;
  return env && env.trim().length > 0 ? env : undefined;
};

const currentOrigin = (): string => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost';
};

export const releaseKey = (manifest: ReleaseManifest): string => `${manifest.device}:${manifest.release.id}`;
export const releaseFilename = (manifest: ReleaseManifest): string => `worm-${manifest.device}-${manifest.release.id}.zip`;

export const isSafeReleaseId = (id: string): boolean =>
  SAFE_RELEASE_ID.test(id) && !id.includes('..') && !id.includes('/') && !id.includes('\\') && !id.includes('\0');

export const validateReleaseManifest = (value: unknown, locationOrigin = currentOrigin()): ReleaseManifest => {
  const raw = value as RawManifest;
  if (raw.schema !== undefined && raw.schema !== 1) {
    throw new InstallerError('Unsupported release manifest schema.');
  }
  if (raw.device !== DEVICE_TARGET.codename) {
    throw new InstallerError(`Release device ${String(raw.device)} is not supported.`);
  }
  const descriptorStyle = typeof raw.build === 'string' || typeof raw.install_url === 'string';
  const release = descriptorStyle
    ? {
        id: raw.build,
        file: raw.install_url,
        sha256: raw.sha256,
        size: raw.size
      }
    : raw.release;
  if (!release || typeof release !== 'object') {
    throw new InstallerError('Release manifest is missing release details.');
  }

  const { id, file, sha256, size } = release as RawManifest['release'] & { size?: unknown };
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new InstallerError('Release manifest is missing release id.');
  }
  if (!isSafeReleaseId(id)) {
    throw new InstallerError('Release manifest release id is not safe.');
  }
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new InstallerError('Release manifest is missing release file.');
  }
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    throw new InstallerError('Release manifest SHA-256 must be 64 hexadecimal characters.');
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new InstallerError('Release manifest size is invalid.');
  }
  if (typeof raw.channel !== 'string' || raw.channel.trim().length === 0) {
    throw new InstallerError('Release manifest channel is invalid.');
  }

  const base = getReleaseBaseUrl();
  const url = new URL(file, base ?? locationOrigin);
  const allowedOrigin = base ? new URL(base).origin : locationOrigin;
  const isReleaseHost = url.origin === 'https://releases.coffee.pm';
  if (url.origin !== allowedOrigin && !isReleaseHost) {
    throw new InstallerError('Release URL cross-origin is not authorized.');
  }
  if (!base && url.origin === locationOrigin && !SAFE_RELEASE_PATH.test(file)) {
    throw new InstallerError('Release file path is not safe.');
  }
  if (file.includes('..') || file.includes('\\')) {
    throw new InstallerError('Release file path is not safe.');
  }

  return {
    schema: 1,
    channel: raw.channel,
    device: DEVICE_TARGET.codename,
    build: typeof raw.build === 'string' ? raw.build : id,
    android: typeof raw.android === 'string' ? raw.android : undefined,
    install_url: file,
    ota_url: typeof raw.ota_url === 'string' ? raw.ota_url : undefined,
    sha256: sha256.toLowerCase(),
    build_timestamp: typeof raw.build_timestamp === 'string' ? raw.build_timestamp : undefined,
    release: {
      id,
      file,
      sha256: sha256.toLowerCase(),
      size
    }
  };
};

export const fetchReleaseManifest = async (log?: ReleaseLog): Promise<ReleaseManifest> => {
  let response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok && response.status === 404) {
    response = await fetch(LEGACY_MANIFEST_URL, { cache: 'no-store' });
  }
  if (!response.ok) {
    log?.('ERROR', `Manifest loading failed: HTTP ${response.status}`, { status: response.status });
    throw new InstallerError(`Unable to fetch release manifest: HTTP ${response.status}.`);
  }
  try {
    const manifest = validateReleaseManifest(await response.json());
    return manifest;
  } catch (error) {
    if (response.url.endsWith(MANIFEST_URL) || response.url === '' || response.url.endsWith('/releases/stable/frankel.json')) {
      const legacy = await fetch(LEGACY_MANIFEST_URL, { cache: 'no-store' });
      if (legacy.ok) {
        return validateReleaseManifest(await legacy.json());
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    log?.('ERROR', `Manifest validation failed: ${message}`, { validation: 'invalid', reason: message });
    throw error;
  }
};

export const releaseDownloadUrl = (manifest: ReleaseManifest): string => {
  const base = getReleaseBaseUrl();
  return new URL(manifest.release.file, base ?? currentOrigin()).toString();
};

export const metadataFromManifest = (
  manifest: ReleaseManifest,
  downloadedBytes = 0,
  complete = false,
  verified = false,
  headers: Pick<ReleaseMetadata, 'etag' | 'lastModified'> = {}
): ReleaseMetadata => ({
  key: releaseKey(manifest),
  device: manifest.device,
  releaseId: manifest.release.id,
  expectedSha256: manifest.release.sha256,
  expectedSize: manifest.release.size,
  downloadedBytes,
  complete,
  verified,
  etag: headers.etag,
  lastModified: headers.lastModified,
  updatedAt: new Date().toISOString()
});

const parseContentRange = (value: string | null): { start: number; end: number; total: number } | null => {
  if (!value) {
    return null;
  }
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    start: Number.parseInt(match[1], 10),
    end: Number.parseInt(match[2], 10),
    total: match[3] === '*' ? Number.NaN : Number.parseInt(match[3], 10)
  };
};

const sameReleaseMetadata = (metadata: ReleaseMetadata | null, manifest: ReleaseManifest): metadata is ReleaseMetadata =>
  Boolean(
    metadata &&
      metadata.releaseId === manifest.release.id &&
      metadata.device === manifest.device &&
      metadata.expectedSha256 === manifest.release.sha256 &&
      metadata.expectedSize === manifest.release.size
  );

const progressFromBytes = (manifest: ReleaseManifest, downloadedBytes: number, status: string, verified = false): DownloadProgress => ({
  releaseId: manifest.release.id,
  downloadedBytes,
  totalBytes: manifest.release.size,
  percent: manifest.release.size ? Math.min(100, Math.round((downloadedBytes / manifest.release.size) * 1000) / 10) : null,
  storedLocally: true,
  verified,
  status
});

const responseMetadataHeaders = (response: Response): Pick<ReleaseMetadata, 'etag' | 'lastModified'> => ({
  etag: response.headers.get('etag') ?? undefined,
  lastModified: response.headers.get('last-modified') ?? undefined
});

export const inspectStoredRelease = async (
  manifest: ReleaseManifest,
  store: BlobStore,
  onProgress: (progress: DownloadProgress) => void,
  log?: ReleaseLog
): Promise<{ file: File | null; metadata: ReleaseMetadata | null; complete: boolean; verified: boolean }> => {
  const key = releaseKey(manifest);
  const metadata = await store.getMetadata(key);
  const file = await store.getReleaseFile(manifest);
  if (!file || !sameReleaseMetadata(metadata, manifest)) {
    if (file && metadata) {
      log?.('WARN', 'Manifest changed', { cachedReleaseId: metadata.releaseId, currentReleaseId: manifest.release.id }, 'DOWNLOAD');
      log?.('WARN', 'Cache invalidated', { key }, 'DOWNLOAD');
    }
    return { file: null, metadata, complete: false, verified: false };
  }

  const complete = file.size === manifest.release.size && metadata.complete;
  const verified = complete && metadata.verified;
  if (verified) {
    onProgress(progressFromBytes(manifest, file.size, 'Downloaded release found in persistent storage.', true));
  } else if (complete) {
    onProgress(progressFromBytes(manifest, file.size, 'Release already downloaded.', false));
  } else if (file.size > 0) {
    onProgress(progressFromBytes(manifest, file.size, 'Partial installation image found.', false));
  }
  return { file, metadata, complete, verified };
};

export const downloadRelease = async (
  manifest: ReleaseManifest,
  store: BlobStore,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void,
  log?: ReleaseLog
): Promise<File> => {
  const startedAt = performance.now();
  log?.('DOWNLOAD', 'Download started', { releaseId: manifest.release.id, expectedSize: manifest.release.size }, 'DOWNLOAD');
  const key = releaseKey(manifest);
  const cached = await inspectStoredRelease(manifest, store, onProgress, log);
  if (cached.file && cached.complete) {
    return cached.file;
  }

  const existingSize = cached.file && cached.file.size < manifest.release.size ? cached.file.size : 0;
  await store.ensureEnoughStorage(manifest.release.size, existingSize);

  const headers = new Headers();
  if (existingSize > 0) {
    headers.set('Range', `bytes=${existingSize}-`);
    if (cached.metadata?.etag) {
      headers.set('If-Range', cached.metadata.etag);
    } else if (cached.metadata?.lastModified) {
      headers.set('If-Range', cached.metadata.lastModified);
    }
    log?.('DOWNLOAD', `Resuming from ${existingSize} bytes`, { existingBytes: existingSize }, 'DOWNLOAD');
    onProgress(progressFromBytes(manifest, existingSize, `Resuming download from ${existingSize} bytes`));
  }

  const response = await fetch(releaseDownloadUrl(manifest), { signal, headers });
  if (!response.ok) {
    throw new InstallerError(`Unable to download release ${manifest.release.id}: HTTP ${response.status}.`);
  }

  let writeOffset = existingSize;
  let responseStatus = 'Downloading release.';
  if (existingSize > 0 && response.status === 206) {
    const range = parseContentRange(response.headers.get('content-range'));
    if (!range || range.start !== existingSize || (!Number.isNaN(range.total) && range.total !== manifest.release.size)) {
      throw new InstallerError('Server returned an incompatible Content-Range for the partial release.');
    }
  } else if (existingSize > 0 && response.status === 200) {
    writeOffset = 0;
    responseStatus = 'Server did not resume; restarting download from byte 0.';
  } else if (existingSize > 0) {
    throw new InstallerError(`Server did not accept resumable download: HTTP ${response.status}.`);
  }

  if (!response.body) {
    throw new InstallerError('Release download stream is not available in this browser.');
  }

  const writable = await store.getWritable(manifest);
  if (writeOffset === 0) {
    await writable.truncate(0);
  } else {
    await writable.seek(writeOffset);
  }

  const reader = response.body.getReader();
  const responseMetadata = responseMetadataHeaders(response);
  let downloadedBytes = writeOffset;
  let lastCheckpointBytes = downloadedBytes;
  let lastCheckpointAt = Date.now();
  const loggedMilestones = new Set<number>();

  const checkpoint = async (complete = false): Promise<void> => {
    await store.saveMetadata(
      key,
      metadataFromManifest(manifest, downloadedBytes, complete, false, {
        etag: responseMetadata.etag ?? cached.metadata?.etag,
        lastModified: responseMetadata.lastModified ?? cached.metadata?.lastModified
      })
    );
    lastCheckpointBytes = downloadedBytes;
    lastCheckpointAt = Date.now();
  };

  const logProgress = (force = false): void => {
    const percent = manifest.release.size ? Math.floor((downloadedBytes / manifest.release.size) * 100) : 0;
    for (const milestone of [25, 50, 75, 100]) {
      if ((force || percent >= milestone || downloadedBytes === manifest.release.size) && !loggedMilestones.has(milestone)) {
        loggedMilestones.add(milestone);
        log?.('DOWNLOAD', `${milestone}%`, { downloadedBytes, totalBytes: manifest.release.size, percent: milestone }, 'DOWNLOAD');
      }
    }
  };

  try {
    onProgress(progressFromBytes(manifest, downloadedBytes, responseStatus));
    await checkpoint(false);

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        await writable.write(value);
        downloadedBytes += value.byteLength;
        onProgress(progressFromBytes(manifest, downloadedBytes, responseStatus));
        logProgress();
        if (downloadedBytes - lastCheckpointBytes >= CHECKPOINT_BYTES || Date.now() - lastCheckpointAt >= CHECKPOINT_MS) {
          await checkpoint(false);
        }
      }
    }

    if (downloadedBytes !== manifest.release.size) {
      throw new InstallerError('Downloaded release size does not match the manifest.');
    }
    await writable.close();
    await checkpoint(true);
    logProgress(true);
    log?.('DOWNLOAD', 'Download complete', { downloadedBytes, durationMs: Math.round(performance.now() - startedAt) }, 'DOWNLOAD');
    onProgress(progressFromBytes(manifest, downloadedBytes, 'Release already downloaded.'));
    const file = await store.getReleaseFile(manifest);
    if (!file) {
      throw new InstallerError('Downloaded release was not stored in persistent browser storage.');
    }
    return file;
  } catch (error) {
    log?.(signal.aborted ? 'DOWNLOAD' : 'WARN', signal.aborted ? 'Download paused because Pixel disconnected' : 'Download interrupted', { downloadedBytes }, 'DOWNLOAD');
    await reader.cancel().catch(() => undefined);
    await writable.close().catch(() => undefined);
    throw error;
  }
};
