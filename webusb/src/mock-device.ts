import { metadataFromManifest, releaseKey } from './release';
import type { BlobStore } from './blob-store';
import type { DownloadProgress, ReleaseManifest } from './types';

export const MOCK_RELEASE_TEXT = 'worm-os-mock-release\n';
export const MOCK_RELEASE_SHA256 = '1111111111111111111111111111111111111111111111111111111111111111';

export const MOCK_RELEASE_MANIFEST: ReleaseManifest = {
  schema: 1,
  channel: 'mock',
  device: 'frankel',
  release: {
    id: 'MOCK RELEASE',
    file: '/mock/frankel-test.zip',
    sha256: MOCK_RELEASE_SHA256,
    size: MOCK_RELEASE_TEXT.length
  }
};

export const isMockModeEnabled = (): boolean => {
  if (!import.meta.env.DEV) {
    return false;
  }
  const envEnabled = import.meta.env.VITE_MOCK_DEVICE === 'true';
  const queryEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock') === '1';
  return envEnabled || queryEnabled;
};

export const createMockReleaseBlob = (): Blob => new Blob([MOCK_RELEASE_TEXT], { type: 'application/zip' });

export const mockDownloadProgress = (percent: number): DownloadProgress => ({
  releaseId: MOCK_RELEASE_MANIFEST.release.id,
  downloadedBytes: Math.round((MOCK_RELEASE_MANIFEST.release.size * percent) / 100),
  totalBytes: MOCK_RELEASE_MANIFEST.release.size,
  percent,
  storedLocally: true,
  verified: false,
  status: percent === 100 ? 'Mock release downloaded.' : 'Downloading mock release.'
});

export const saveMockRelease = async (store: BlobStore): Promise<Blob> => {
  const blob = createMockReleaseBlob();
  await store.saveRelease(releaseKey(MOCK_RELEASE_MANIFEST), blob, metadataFromManifest(MOCK_RELEASE_MANIFEST, blob.size, true, false));
  return blob;
};

export const markMockReleaseVerified = async (store: BlobStore): Promise<void> => {
  const blob = createMockReleaseBlob();
  await store.saveRelease(releaseKey(MOCK_RELEASE_MANIFEST), blob, metadataFromManifest(MOCK_RELEASE_MANIFEST, blob.size, true, true));
};
