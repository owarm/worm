import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const RELEASES_DIR = path.join(PUBLIC_DIR, 'releases');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.json');
const SAFE_RELEASE_ID = /^[A-Za-z0-9._-]+$/;

export const isSafeReleaseId = (releaseId) =>
  typeof releaseId === 'string' &&
  releaseId.length > 0 &&
  SAFE_RELEASE_ID.test(releaseId) &&
  !releaseId.includes('..') &&
  !releaseId.includes('/') &&
  !releaseId.includes('\\') &&
  !releaseId.includes('\0');

export const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });

export const makeManifestObject = ({ releaseId, filename, sha256, size }) => ({
  schema: 1,
  channel: 'stable',
  device: 'frankel',
  release: {
    id: releaseId,
    file: `/releases/${filename}`,
    sha256,
    size
  }
});

const readExistingManifest = async () => {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

export const createManifest = async ({ sourceZip, releaseId, force = false }) => {
  if (!sourceZip || !releaseId) {
    throw new Error('Usage: node scripts/make-manifest.mjs /path/to/frankel-install.zip <release-id> [--force]');
  }
  if (!isSafeReleaseId(releaseId)) {
    throw new Error('Unsafe release id. Use only letters, numbers, dot, underscore, or hyphen.');
  }

  const sourcePath = path.resolve(sourceZip);
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`Source is not a regular file: ${sourceZip}`);
  }

  const filename = path.basename(sourcePath);
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(filename) || filename.includes('..')) {
    throw new Error('Unsafe ZIP filename.');
  }

  await mkdir(RELEASES_DIR, { recursive: true });
  const sha256 = await sha256File(sourcePath);
  const destinationPath = path.join(RELEASES_DIR, filename);

  try {
    const destinationStat = await stat(destinationPath);
    if (!destinationStat.isFile()) {
      throw new Error(`Destination exists and is not a regular file: ${destinationPath}`);
    }
    const destinationSha256 = await sha256File(destinationPath);
    if (destinationSha256 !== sha256 && !force) {
      throw new Error('Destination release ZIP exists with a different SHA-256. Re-run with --force to overwrite.');
    }
    if (destinationSha256 !== sha256 && force) {
      await copyFile(sourcePath, destinationPath);
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      await copyFile(sourcePath, destinationPath);
    } else {
      throw error;
    }
  }

  const existing = await readExistingManifest();
  if (existing?.release && (existing.release.id !== releaseId || existing.release.file !== `/releases/${filename}`) && !force) {
    throw new Error('A different release manifest already exists. Re-run with --force to replace it.');
  }

  const manifest = makeManifestObject({ releaseId, filename, sha256, size: sourceStat.size });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, destinationPath };
};

const main = async () => {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const positional = args.filter((arg) => arg !== '--force');
  const result = await createManifest({ sourceZip: positional[0], releaseId: positional[1], force });
  console.log('WORM RELEASE MANIFEST CREATED');
  console.log(`Device: ${result.manifest.device}`);
  console.log(`Release: ${result.manifest.release.id}`);
  console.log(`File: ${result.manifest.release.file}`);
  console.log(`SHA-256: ${result.manifest.release.sha256}`);
  console.log(`Size: ${result.manifest.release.size}`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
