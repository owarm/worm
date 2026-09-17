import { describe, expect, it, vi } from 'vitest';
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

  it('streams large Blob-like input without buffering the whole file', async () => {
    const chunk = new Uint8Array(1024);
    let reads = 0;
    const blob = {
      size: 2 * 1024 * 1024 * 1024,
      arrayBuffer: vi.fn(async () => {
        throw new Error('arrayBuffer must not be used for verification');
      }),
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (reads >= 3) {
              controller.close();
              return;
            }
            reads += 1;
            controller.enqueue(chunk);
          }
        })
    } as unknown as Blob;

    await expect(sha256Blob(blob)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(reads).toBe(3);
    expect(blob.arrayBuffer).not.toHaveBeenCalled();
  });
});
