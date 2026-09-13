import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeInstallZip } from './analyze-install-zip.mjs';
import { isSafeReleaseId, makeManifestObject, sha256File } from './make-manifest.mjs';
import { resolveReleaseFile, validateManifest } from './verify-release.mjs';

let tempDir;

const makeTempDir = async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'worm-release-test-'));
  return tempDir;
};

const makeTinyZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.filename);
    const data = Buffer.alloc(entry.compressedSize, 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(entry.compressedSize, 18);
    local.writeUInt32LE(entry.uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(entry.compressedSize, 20);
    central.writeUInt32LE(entry.uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
};

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('release scripts', () => {
  it('calculates SHA-256', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'sample.zip');
    await writeFile(file, 'worm');
    await expect(sha256File(file)).resolves.toBe('b9af17af4fc5708e9ba636512213b9d0cf6f894c0c3ba6e1d970c13a921c5db9');
  });

  it('builds a valid manifest object', () => {
    const manifest = makeManifestObject({
      releaseId: '2026091200',
      filename: 'frankel-install-2026091200.zip',
      sha256: 'a'.repeat(64),
      size: 123
    });
    expect(validateManifest(manifest).release.size).toBe(123);
  });

  it('rejects invalid schema', () => {
    expect(() => validateManifest({ schema: 2 })).toThrow('schema');
  });

  it('rejects non-frankel releases', () => {
    expect(() =>
      validateManifest({
        schema: 1,
        channel: 'stable',
        device: 'other',
        release: { id: '2026091200', file: '/releases/a.zip', sha256: 'a'.repeat(64), size: 1 }
      })
    ).toThrow('frankel');
  });

  it('keeps release files inside public/releases', () => {
    expect(() => resolveReleaseFile('/releases/../secret.zip')).toThrow('safe');
  });

  it('checks safe and unsafe release ids', () => {
    expect(isSafeReleaseId('2026091200')).toBe(true);
    expect(isSafeReleaseId('frankel_2026-09-12.00')).toBe(true);
    expect(isSafeReleaseId('../2026091200')).toBe(false);
    expect(isSafeReleaseId('2026/091200')).toBe(false);
  });

  it('detects wrong file size data before reporting success', () => {
    expect(() =>
      validateManifest({
        schema: 1,
        channel: 'stable',
        device: 'frankel',
        release: { id: '2026091200', file: '/releases/a.zip', sha256: 'a'.repeat(64), size: -1 }
      })
    ).toThrow('size');
  });

  it('can create a local release directory for test fixtures', async () => {
    const dir = await makeTempDir();
    const releases = path.join(dir, 'public', 'releases');
    await mkdir(releases, { recursive: true });
    expect(releases.endsWith(path.join('public', 'releases'))).toBe(true);
  });

  it('analyzes important install ZIP entries', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'sample.zip');
    await writeFile(
      file,
      makeTinyZip([
        { filename: 'bootloader-frankel.img', compressedSize: 10, uncompressedSize: 100, method: 8 },
        { filename: 'image-frankel.zip', compressedSize: 20, uncompressedSize: 200, method: 0 }
      ])
    );

    const entries = await analyzeInstallZip(file);

    expect(entries).toEqual([
      { filename: 'bootloader-frankel.img', compressedSize: 10, uncompressedSize: 100, method: 8, important: true },
      { filename: 'image-frankel.zip', compressedSize: 20, uncompressedSize: 200, method: 0, important: true }
    ]);
  });
});
