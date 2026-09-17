#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, opendir, readFile, realpath, stat, lstat, writeFile } from "node:fs/promises";
import path from "node:path";

const portalRoot = path.resolve(new URL("..", import.meta.url).pathname);
const publicDataDir = path.join(portalRoot, "public-data");
const privateDataDir = path.join(portalRoot, ".private-data");

const configuredRoots = [
  "/opt/worm/releases",
  "/opt/worm/grapheneos/releases",
  "/opt/worm/artifacts",
  "/opt/worm/webusb/public/releases",
  "/opt/worm/webusb/dist/releases",
];

const deviceNames = new Map([
  ["frankel", "Pixel 10"],
  ["caiman", "Pixel 9 Pro"],
  ["komodo", "Pixel 9 Pro XL"],
  ["tokay", "Pixel 9"],
  ["akita", "Pixel 8a"],
  ["husky", "Pixel 8 Pro"],
  ["shiba", "Pixel 8"],
  ["felix", "Pixel Fold"],
  ["tangorpro", "Pixel Tablet"],
  ["cheetah", "Pixel 7 Pro"],
  ["panther", "Pixel 7"],
  ["lynx", "Pixel 7a"],
  ["raven", "Pixel 6 Pro"],
  ["oriole", "Pixel 6"],
  ["bluejay", "Pixel 6a"],
]);

const blockedName = /(?:target_files|otatools|ota-tools|\.tmp|\.temp|partial|unfinished|\.part|\.crdownload|testdata|private|secret|key|auth\.env|id_rsa|id_ed25519|avb.*key)/i;
const releaseName = /^([a-z0-9]+)-(?:install|factory|img)-([0-9]{8,})\.zip$/i;
const otaName = /^([a-z0-9]+)-(?:ota_update|ota)-([0-9]{8,})\.zip$/i;

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function classify(filename) {
  if (!filename.endsWith(".zip") || blockedName.test(filename)) return null;
  const ota = filename.match(otaName);
  if (ota) return { kind: "ota", codename: ota[1], buildId: ota[2] };
  const release = filename.match(releaseName);
  if (release) return { kind: "release", codename: release[1], buildId: release[2] };
  return null;
}

function humanSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(2)} ${units[unit]}`;
}

function isoDate(mtime) {
  return mtime.toISOString().slice(0, 10);
}

function safeLinkName(kind, codename, buildId, filename) {
  const hash = createHash("sha256").update(`${kind}:${codename}:${buildId}:${filename}`).digest("hex").slice(0, 12);
  return `${kind}-${codename}-${buildId}-${hash}-${filename}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

async function readSidecarHash(file, filename) {
  const candidates = [
    `${file}.sha256`,
    `${file}.sha256sum`,
    path.join(path.dirname(file), "SHA256SUMS"),
    path.join(path.dirname(file), "sha256sums.txt"),
  ];
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/\b([a-fA-F0-9]{64})\b(?:\s+\*?(.+))?/);
        if (!match) continue;
        const lineName = match[2]?.trim();
        if (!lineName || path.basename(lineName) === filename) return match[1].toLowerCase();
      }
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EACCES") throw error;
    }
  }
  return sha256File(file);
}

async function* walk(root, realRoot) {
  let dir;
  try {
    dir = await opendir(root);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES") return;
    throw error;
  }

  for await (const entry of dir) {
    const full = path.join(root, entry.name);
    if (entry.name.startsWith(".") || blockedName.test(full)) continue;

    let lst;
    try {
      lst = await lstat(full);
    } catch (error) {
      if (error.code === "EACCES" || error.code === "ENOENT") continue;
      throw error;
    }

    if (lst.isSymbolicLink()) {
      let resolved;
      try {
        resolved = await realpath(full);
      } catch {
        continue;
      }
      if (!inside(resolved, realRoot)) continue;
      const resolvedStat = await stat(resolved);
      if (resolvedStat.isDirectory()) yield* walk(resolved, realRoot);
      if (resolvedStat.isFile()) yield { displayPath: full, realPath: resolved, stats: resolvedStat };
      continue;
    }

    if (lst.isDirectory()) {
      yield* walk(full, realRoot);
    } else if (lst.isFile()) {
      yield { displayPath: full, realPath: full, stats: lst };
    }
  }
}

async function main() {
  const roots = [];
  for (const root of configuredRoots) {
    try {
      const realRoot = await realpath(root);
      roots.push({ root, realRoot });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const seen = new Set();
  const seenPackages = new Set();
  const releases = [];
  const ota = [];
  const manifest = [];

  for (const { realRoot } of roots) {
    for await (const item of walk(realRoot, realRoot)) {
      if (seen.has(item.realPath)) continue;
      seen.add(item.realPath);

      const filename = path.basename(item.displayPath);
      const kind = classify(filename);
      if (!kind) continue;

      const sha256 = await readSidecarHash(item.realPath, filename);
      const packageKey = `${kind.kind}:${filename}:${item.stats.size}:${sha256}`;
      if (seenPackages.has(packageKey)) continue;
      seenPackages.add(packageKey);

      const linkName = safeLinkName(kind.kind, kind.codename, kind.buildId, filename);
      const record = {
        device: deviceNames.get(kind.codename) || kind.codename,
        codename: kind.codename,
        buildId: kind.buildId,
        filename,
        size: item.stats.size,
        sizeHuman: humanSize(item.stats.size),
        sha256,
        date: isoDate(item.stats.mtime),
        url: `/files/${linkName}`,
      };

      if (kind.kind === "release") releases.push(record);
      else ota.push(record);

      manifest.push({ ...record, kind: kind.kind, sourcePath: item.realPath, linkName });
    }
  }

  const sortRecords = (a, b) => b.buildId.localeCompare(a.buildId) || a.filename.localeCompare(b.filename);
  releases.sort(sortRecords);
  ota.sort(sortRecords);
  manifest.sort((a, b) => b.buildId.localeCompare(a.buildId) || a.kind.localeCompare(b.kind) || a.filename.localeCompare(b.filename));

  await mkdir(publicDataDir, { recursive: true });
  await mkdir(privateDataDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(publicDataDir, "releases.json"), `${JSON.stringify(releases, null, 2)}\n`);
  await writeFile(path.join(publicDataDir, "ota.json"), `${JSON.stringify(ota, null, 2)}\n`);
  await writeFile(path.join(privateDataDir, "manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), roots: configuredRoots, files: manifest }, null, 2)}\n`, { mode: 0o600 });

  console.log(`Release packages: ${releases.length}`);
  console.log(`OTA packages: ${ota.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
