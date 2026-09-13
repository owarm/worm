import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobStore } from './blob-store';
import { sha256Blob } from './crypto';
import { downloadRelease, inspectStoredRelease, metadataFromManifest, releaseFilename, releaseKey } from './release';
import type { CachedRelease, ReleaseManifest, ReleaseMetadata } from './types';

const manifest: ReleaseManifest = {
  schema: 1,
  channel: 'stable',
  device: 'frankel',
  release: {
    id: '2026091200',
    file: '/releases/frankel-install-2026091200.zip',
    sha256: 'a'.repeat(64),
    size: 10
  }
};

class MemoryReleaseStore extends BlobStore {
  metadata = new Map<string, ReleaseMetadata>();
  files = new Map<string, Uint8Array>();
  writes: string[] = [];

  constructor(seed?: { data: string; metadata: ReleaseMetadata }) {
    super();
    if (seed) {
      this.files.set(releaseFilename(manifest), new TextEncoder().encode(seed.data));
      this.metadata.set(releaseKey(manifest), seed.metadata);
    }
  }

  override async init(): Promise<void> {}

  override async inspect(releaseManifest: ReleaseManifest): Promise<CachedRelease | null> {
    const file = await this.getReleaseFile(releaseManifest);
    const metadata = await this.getMetadata(releaseKey(releaseManifest));
    return file && metadata ? { blob: file, metadata } : null;
  }

  override async getMetadata(key: string): Promise<ReleaseMetadata | null> {
    return this.metadata.get(key) ?? null;
  }

  override async saveMetadata(key: string, metadata: ReleaseMetadata): Promise<void> {
    this.metadata.set(key, metadata);
  }

  override async getReleaseFile(releaseManifest: ReleaseManifest): Promise<File | null> {
    const data = this.files.get(releaseFilename(releaseManifest));
    if (!data) {
      return null;
    }
    return new File([data], releaseFilename(releaseManifest), { type: 'application/zip' });
  }

  override async getWritable(releaseManifest: ReleaseManifest): Promise<FileSystemWritableFileStream> {
    const name = releaseFilename(releaseManifest);
    let data = this.files.get(name) ?? new Uint8Array();
    let position = 0;
    return {
      locked: false,
      abort: async () => undefined,
      close: async () => {
        this.files.set(name, data);
      },
      getWriter: (() => {
        throw new Error('not used');
      }) as FileSystemWritableFileStream['getWriter'],
      seek: async (offset: number) => {
        position = offset;
        this.writes.push(`seek:${offset}`);
      },
      truncate: async (size: number) => {
        data = data.slice(0, size);
        position = size;
        this.writes.push(`truncate:${size}`);
      },
      write: async (chunk: FileSystemWriteChunkType) => {
        const bytes =
          typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : chunk instanceof Blob
              ? new Uint8Array(await chunk.arrayBuffer())
              : chunk instanceof ArrayBuffer
                ? new Uint8Array(chunk)
                : ArrayBuffer.isView(chunk)
                  ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
                  : new Uint8Array();
        const next = new Uint8Array(Math.max(data.length, position + bytes.length));
        next.set(data.slice(0, position), 0);
        next.set(bytes, position);
        if (data.length > position + bytes.length) {
          next.set(data.slice(position + bytes.length), position + bytes.length);
        }
        data = next;
        position += bytes.length;
      }
    };
  }

  override async ensureEnoughStorage(): Promise<void> {}
}

const response = (body: BodyInit, status = 200, headers: HeadersInit = {}): Response =>
  new Response(body, { status, headers: { 'content-length': String(body instanceof Blob ? body.size : String(body).length), ...headers } });

describe('resumable release download', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts a fresh download at byte 0 without Range', async () => {
    const store = new MemoryReleaseStore();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('range')).toBeNull();
      return response('0123456789');
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = await downloadRelease(manifest, store, new AbortController().signal, () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(file.size).toBe(10);
    expect(store.writes).toContain('truncate:0');
  });

  it('resumes a partial file with Range and validates Content-Range', async () => {
    const store = new MemoryReleaseStore({ data: '0123', metadata: metadataFromManifest(manifest, 4, false, false, { etag: '"v1"' }) });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('range')).toBe('bytes=4-');
        expect(headers.get('if-range')).toBe('"v1"');
        return response('456789', 206, { 'content-range': 'bytes 4-9/10', etag: '"v1"' });
      })
    );

    const file = await downloadRelease(manifest, store, new AbortController().signal, () => undefined);

    expect(await file.text()).toBe('0123456789');
    expect(store.writes).toContain('seek:4');
  });

  it('rejects incompatible Content-Range without appending', async () => {
    const store = new MemoryReleaseStore({ data: '0123', metadata: metadataFromManifest(manifest, 4, false, false) });
    vi.stubGlobal('fetch', vi.fn(async () => response('456789', 206, { 'content-range': 'bytes 5-9/10' })));

    await expect(downloadRelease(manifest, store, new AbortController().signal, () => undefined)).rejects.toThrow('Content-Range');
    expect(await (await store.getReleaseFile(manifest))?.text()).toBe('0123');
  });

  it('truncates and restarts when server returns 200 to a Range request', async () => {
    const store = new MemoryReleaseStore({ data: 'old-', metadata: metadataFromManifest(manifest, 4, false, false) });
    vi.stubGlobal('fetch', vi.fn(async () => response('abcdefghij', 200)));

    const file = await downloadRelease(manifest, store, new AbortController().signal, () => undefined);

    expect(await file.text()).toBe('abcdefghij');
    expect(store.writes).toContain('truncate:0');
  });

  it('does not redownload a complete cached release', async () => {
    const store = new MemoryReleaseStore({ data: '0123456789', metadata: metadataFromManifest(manifest, 10, true, false) });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const file = await downloadRelease(manifest, store, new AbortController().signal, () => undefined);

    expect(file.size).toBe(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throttles download progress logs to essential milestones', async () => {
    const store = new MemoryReleaseStore();
    vi.stubGlobal('fetch', vi.fn(async () => response('0123456789')));
    const messages: string[] = [];

    await downloadRelease(manifest, store, new AbortController().signal, () => undefined, (_level, message, _details, category) => {
      if (category === 'DOWNLOAD') {
        messages.push(message);
      }
    });

    expect(messages).toEqual(['Download started', '25%', '50%', '75%', '100%', 'Download complete']);
  });

  it('reuses only verified cache matching the current manifest', async () => {
    const store = new MemoryReleaseStore({ data: '0123456789', metadata: metadataFromManifest(manifest, 10, true, true) });
    const matching = await inspectStoredRelease(manifest, store, () => undefined);
    const changedManifest = { ...manifest, release: { ...manifest.release, sha256: 'b'.repeat(64) } };
    const changed = await inspectStoredRelease(changedManifest, store, () => undefined);

    expect(matching.verified).toBe(true);
    expect(changed.verified).toBe(false);
    expect(changed.complete).toBe(false);
  });

  it('hashes Blob streams without reading the whole file as an ArrayBuffer', async () => {
    const blob = new Blob(['worm']);
    const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');

    await expect(sha256Blob(blob)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
