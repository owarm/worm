import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const RELEASES_DIR = path.join(PUBLIC_DIR, 'releases');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.json');
const SHA256_HEX = /^[a-f0-9]{64}$/i;

export const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });

export const resolveReleaseFile = (releaseFile) => {
  if (typeof releaseFile !== 'string' || !releaseFile.startsWith('/releases/') || releaseFile.includes('..') || releaseFile.includes('\\')) {
    throw new Error('Release file path is not safe.');
  }
  const resolved = path.resolve(PUBLIC_DIR, `.${releaseFile}`);
  const releasesRoot = `${path.resolve(RELEASES_DIR)}${path.sep}`;
  if (!resolved.startsWith(releasesRoot)) {
    throw new Error('Release file escapes public/releases.');
  }
  return resolved;
};

export const validateManifest = (manifest) => {
  if (manifest?.schema !== 1) throw new Error('Invalid manifest schema.');
  if (manifest.device !== 'frankel') throw new Error('Manifest device must be frankel.');
  if (manifest.channel !== 'stable') throw new Error('Manifest channel must be stable.');
  if (!manifest.release || typeof manifest.release !== 'object') throw new Error('Manifest release is missing.');
  if (typeof manifest.release.id !== 'string' || manifest.release.id.length === 0) throw new Error('Manifest release id is missing.');
  if (!SHA256_HEX.test(String(manifest.release.sha256))) throw new Error('Manifest SHA-256 is invalid.');
  if (!Number.isFinite(manifest.release.size) || manifest.release.size < 0) throw new Error('Manifest size is invalid.');
  return manifest;
};

export const verifyRelease = async () => {
  const manifest = validateManifest(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')));
  const releasePath = resolveReleaseFile(manifest.release.file);
  const releaseStat = await stat(releasePath);
  if (!releaseStat.isFile()) {
    throw new Error('Release path is not a regular file.');
  }
  const actualSha256 = await sha256File(releasePath);
  if (actualSha256 !== manifest.release.sha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch: expected ${manifest.release.sha256}, got ${actualSha256}`);
  }
  if (manifest.release.size !== 0 && releaseStat.size !== manifest.release.size) {
    throw new Error(`Size mismatch: expected ${manifest.release.size}, got ${releaseStat.size}`);
  }
  return { manifest, sha256: actualSha256, size: releaseStat.size };
};

const main = async () => {
  const result = await verifyRelease();
  console.log('WORM RELEASE VERIFIED');
  console.log(`Device: ${result.manifest.device}`);
  console.log(`Release: ${result.manifest.release.id}`);
  console.log('SHA-256: OK');
  console.log('Size: OK');
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
