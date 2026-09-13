#!/usr/bin/env node
import { open } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_SENTINEL = 0xffffffff;

const methodName = (method) => {
  if (method === 0) return 'store';
  if (method === 8) return 'deflate';
  return `method-${method}`;
};

const isImportantEntry = (filename) => {
  const base = path.posix.basename(filename);
  return base.startsWith('bootloader') || base.startsWith('radio') || /^image-.*\.zip$/.test(base);
};

const readExact = async (handle, position, length) => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new Error(`Could not read ${length} bytes at offset ${position}.`);
  }
  return buffer;
};

export const analyzeInstallZip = async (zipPath) => {
  const handle = await open(zipPath, 'r');
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 66_000);
    const tail = await readExact(handle, size - tailLength, tailLength);
    let eocdOffset = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) === EOCD_SIGNATURE) {
        eocdOffset = size - tailLength + offset;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error('ZIP end of central directory not found.');
    }

    const eocd = await readExact(handle, eocdOffset, 22);
    const entryCount = eocd.readUInt16LE(10);
    const centralDirectorySize = eocd.readUInt32LE(12);
    const centralDirectoryOffset = eocd.readUInt32LE(16);
    if (entryCount === 0xffff || centralDirectorySize === ZIP64_SENTINEL || centralDirectoryOffset === ZIP64_SENTINEL) {
      throw new Error('ZIP64 central directories are not supported by this diagnostic script.');
    }

    const centralDirectory = await readExact(handle, centralDirectoryOffset, centralDirectorySize);
    const entries = [];
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (centralDirectory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new Error(`Invalid central directory signature at offset ${centralDirectoryOffset + offset}.`);
      }
      const method = centralDirectory.readUInt16LE(offset + 10);
      const compressedSize = centralDirectory.readUInt32LE(offset + 20);
      const uncompressedSize = centralDirectory.readUInt32LE(offset + 24);
      const filenameLength = centralDirectory.readUInt16LE(offset + 28);
      const extraLength = centralDirectory.readUInt16LE(offset + 30);
      const commentLength = centralDirectory.readUInt16LE(offset + 32);
      const filename = centralDirectory.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8');
      entries.push({ filename, compressedSize, uncompressedSize, method, important: isImportantEntry(filename) });
      offset += 46 + filenameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
};

const printEntry = (entry) => {
  const marker = entry.important ? 'IMPORTANT ' : '';
  console.log(
    `${marker}${entry.filename}\tcompressed=${entry.compressedSize}\tuncompressed=${entry.uncompressedSize}\tmethod=${entry.method} (${methodName(entry.method)})`
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error('Usage: node scripts/analyze-install-zip.mjs public/releases/frankel-install-2026091100.zip');
    process.exit(1);
  }
  const entries = await analyzeInstallZip(zipPath);
  for (const entry of entries) {
    printEntry(entry);
  }
}
