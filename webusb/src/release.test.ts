import { describe, expect, it } from 'vitest';
import { isSafeReleaseId, validateReleaseManifest } from './release';

const validManifest = {
  schema: 1,
  channel: 'stable',
  device: 'frankel',
  release: {
    id: '2026091200',
    file: '/releases/frankel-install-2026091200.zip',
    sha256: 'a'.repeat(64),
    size: 123
  }
};

describe('release manifest', () => {
  it('accepts a valid manifest', () => {
    expect(validateReleaseManifest(validManifest, 'https://installer.example').release.id).toBe('2026091200');
  });

  it('rejects a non-frankel device', () => {
    expect(() =>
      validateReleaseManifest({ ...validManifest, device: 'other' }, 'https://installer.example')
    ).toThrow('not supported');
  });

  it('rejects invalid schema', () => {
    expect(() => validateReleaseManifest({ ...validManifest, schema: 2 }, 'https://installer.example')).toThrow('schema');
  });

  it('rejects unsafe release path', () => {
    expect(() =>
      validateReleaseManifest(
        { ...validManifest, release: { ...validManifest.release, file: '/releases/../evil.zip' } },
        'https://installer.example'
      )
    ).toThrow('safe');
  });

  it('accepts safe release ids', () => {
    expect(isSafeReleaseId('2026091200')).toBe(true);
    expect(isSafeReleaseId('frankel-install_2026.09.12')).toBe(true);
  });

  it('rejects unsafe release ids', () => {
    expect(isSafeReleaseId('../2026091200')).toBe(false);
    expect(isSafeReleaseId('2026/091200')).toBe(false);
    expect(isSafeReleaseId('2026\\091200')).toBe(false);
  });
});
