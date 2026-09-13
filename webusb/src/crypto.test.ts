import { describe, expect, it } from 'vitest';
import { assertSha256Matches, sha256Blob } from './crypto';
import { ReleaseVerificationError } from './types';

const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('sha256', () => {
  it('returns lowercase hex digest', async () => {
    await expect(sha256Blob(new Blob())).resolves.toBe(emptySha256);
  });

  it('rejects hash mismatch', async () => {
    await expect(assertSha256Matches(new Blob(['worm']), emptySha256)).rejects.toThrow(ReleaseVerificationError);
  });

  it('returns the correct file size through Blob metadata', () => {
    expect(new Blob(['worm']).size).toBe(4);
  });
});
