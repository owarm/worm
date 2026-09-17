import { DEVICE_TARGET } from './config';
import { InstallerError } from './types';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from './vendor/graphene-fastboot.mjs';

type ZipEntry = Awaited<ReturnType<ZipReader['getEntries']>>[number];

export type FlashPlanStep =
  | { type: 'flash'; partition: string; filename: string; item: string; source: 'outer' | 'nested'; nestedZip?: string }
  | { type: 'erase'; partition: string; item: string }
  | { type: 'command'; command: string; action: string; item: string | null }
  | { type: 'reboot'; target: 'bootloader' | 'fastboot'; item: string };

export type FlashPlan = {
  build: string;
  device: 'frankel';
  script: string;
  bat: string;
  steps: FlashPlanStep[];
  requiredFiles: string[];
  avbKeyFilename: string;
};

const BOOT_CRITICAL_IMAGES = [
  'boot',
  'dt',
  'dtbo',
  'init_boot',
  'pvmfw',
  'recovery',
  'vbmeta_system',
  'vbmeta_vendor',
  'vbmeta',
  'vendor_boot',
  'vendor_kernel_boot'
];

const SYSTEM_IMAGES = ['odm', 'odm_dlkm', 'product', 'system_ext', 'system', 'vendor_dlkm', 'vendor'];
const REQUIRED_TOP_LEVEL = ['flash-all.sh', 'flash-all.bat', 'avb_pkmd.bin'];
const REQUIRED_IMAGES = ['boot.img', 'init_boot.img', 'vendor_boot.img', 'vendor_kernel_boot.img', 'vbmeta.img'];

const baseName = (path: string): string => path.split('/').pop() ?? path;
const stripQuotes = (value: string): string => value.replace(/^["']|["']$/g, '');

const findEntry = (entries: ZipEntry[], filename: string): ZipEntry | undefined =>
  entries.find((entry) => entry.filename === filename || baseName(entry.filename) === filename);

const requireEntry = (entries: ZipEntry[], filename: string): ZipEntry => {
  const entry = findEntry(entries, filename);
  if (!entry) {
    throw new InstallerError(`Release package is missing ${filename}.`);
  }
  return entry;
};

const readText = async (entries: ZipEntry[], filename: string): Promise<string> => {
  const value = await requireEntry(entries, filename).getData(new TextWriter());
  return String(value);
};

export const readEntryBlob = async (entries: ZipEntry[], filename: string): Promise<Blob> => {
  const value = await requireEntry(entries, filename).getData(new BlobWriter('application/octet-stream'));
  if (!(value instanceof Blob)) {
    throw new InstallerError(`Unable to extract ${filename}.`);
  }
  return value;
};

export const openZipEntries = async (blob: Blob): Promise<{ reader: ZipReader; entries: ZipEntry[] }> => {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  return { reader, entries };
};

const scriptLines = (text: string): string[] =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('if ') && !line.startsWith('exit '));

const batLines = (text: string): string[] =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('::') && !line.toLowerCase().startsWith('rem '));

const tokens = (line: string): string[] => line.match(/"[^"]+"|'[^']+'|\S+/g)?.map(stripQuotes) ?? [];

const itemForFlash = (partition: string, filename: string): string => {
  if (partition === 'avb_custom_key' || filename === 'avb_pkmd.bin') return 'avb_custom_key';
  const base = baseName(filename).replace(/\.(img|bin|zip)$/i, '');
  if (/^super_\d+$/.test(base)) return base.replace('_', ' ');
  return partition;
};

const parseFastbootLine = (line: string): FlashPlanStep | { type: 'update'; filename: string; wipe: boolean } | null => {
  let parts = tokens(line).filter((part) => !/^2?>/.test(part) && part !== '||' && part !== '&&');
  if (parts[0]?.toLowerCase() === 'fastboot') parts = parts.slice(1);
  if (parts[0]?.toLowerCase().endsWith('fastboot')) parts = parts.slice(1);
  const wipe = parts.includes('-w');
  while (parts[0]?.startsWith('--slot') || parts[0] === '--disable-super-optimization' || parts[0] === '--skip-reboot' || parts[0] === '-w') {
    if (parts[0] === '-w' && parts[1] === 'update') {
      parts = parts.slice(1);
      break;
    }
    parts = parts.slice(1);
  }
  const first = parts[0];
  if (!first) return null;
  if (first === 'reboot-bootloader') return { type: 'reboot', target: 'bootloader', item: 'bootloader' };
  if (first === 'reboot' && parts[1] === 'fastboot') return { type: 'reboot', target: 'fastboot', item: 'fastbootd' };
  if (first === 'erase' && parts[1]) return { type: 'erase', partition: parts[1], item: parts[1] };
  if (first === 'flash') {
    const flashArgs = parts.slice(1).filter((part) => !part.startsWith('--slot'));
    if (flashArgs[0] && flashArgs[1]) {
      return { type: 'flash', partition: flashArgs[0], filename: flashArgs[1], item: itemForFlash(flashArgs[0], flashArgs[1]), source: 'outer' };
    }
  }
  if (first === 'update' && parts.at(-1)?.endsWith('.zip')) {
    const filename = parts.at(-1) as string;
    if (filename === 'android-info.zip') {
      return { type: 'command', command: 'check:android-info.zip', action: 'check', item: 'android-info' };
    }
    return { type: 'update', filename, wipe };
  }
  const inlineActive = /^(?:--)?set-active=(.+)$/.exec(first);
  if (inlineActive) return { type: 'command', command: `set_active:${inlineActive[1]}`, action: 'set-active', item: inlineActive[1] };
  if ((first === 'set-active' || first === '--set-active') && parts[1]) {
    return { type: 'command', command: `set_active:${parts[1]}`, action: 'set-active', item: parts[1] };
  }
  if (first === 'oem' && parts.length > 1) return { type: 'command', command: `oem ${parts.slice(1).join(' ')}`, action: 'oem', item: parts.slice(1).join(' ') };
  if (first === 'snapshot-update' && parts[1] === 'cancel') return { type: 'command', command: 'snapshot-update:cancel', action: 'snapshot-update', item: 'cancel' };
  if (['update-super', 'create-logical-partition', 'delete-logical-partition', 'resize-logical-partition'].includes(first)) {
    return { type: 'command', command: `${first}:${parts.slice(1).join(':')}`, action: 'update', item: parts[1] ?? first };
  }
  return null;
};

const imageStep = (partition: string, filename: string, nestedZip: string): FlashPlanStep => ({
  type: 'flash',
  partition,
  filename,
  item: itemForFlash(partition, filename),
  source: 'nested',
  nestedZip
});

const addUpdateZipSteps = async (outerEntries: ZipEntry[], nestedZip: string, steps: FlashPlanStep[], requiredFiles: Set<string>): Promise<void> => {
  const nestedBlob = await readEntryBlob(outerEntries, nestedZip);
  const nested = await openZipEntries(nestedBlob);
  try {
    for (const required of REQUIRED_IMAGES) {
      requireEntry(nested.entries, required);
      requiredFiles.add(`${nestedZip}!${required}`);
    }
    for (const name of [...BOOT_CRITICAL_IMAGES, ...SYSTEM_IMAGES]) {
      const entry = nested.entries.find((candidate) => new RegExp(`^${name}(?:-.+)?\\.img$`).test(baseName(candidate.filename)));
      if (entry) {
        const filename = baseName(entry.filename);
        steps.push(imageStep(name, filename, nestedZip));
        requiredFiles.add(`${nestedZip}!${filename}`);
      }
    }
    const superEmpty = findEntry(nested.entries, 'super_empty.img');
    if (superEmpty) {
      steps.push({ type: 'reboot', target: 'fastboot', item: 'fastbootd' });
      steps.push({ type: 'command', command: 'update-super:super:wipe', action: 'wipe', item: 'super' });
      requiredFiles.add(`${nestedZip}!super_empty.img`);
    }
  } finally {
    await nested.reader.close();
  }
};

const equivalentBatCommands = (bat: string): string[] =>
  batLines(bat)
    .filter((line) => /fastboot/i.test(line))
    .map((line) => line.replace(/^@?/, '').replace(/\s+\|\|\s+.+$/i, '').trim().toLowerCase());

export const buildFlashPlan = async (blob: Blob, build: string): Promise<FlashPlan> => {
  const { reader, entries } = await openZipEntries(blob);
  try {
    for (const required of REQUIRED_TOP_LEVEL) requireEntry(entries, required);
    const script = await readText(entries, 'flash-all.sh');
    const bat = await readText(entries, 'flash-all.bat');
    const batCommands = equivalentBatCommands(bat);
    if (batCommands.length === 0) {
      throw new InstallerError('flash-all.bat does not contain fastboot commands.');
    }

    const steps: FlashPlanStep[] = [];
    const requiredFiles = new Set<string>(REQUIRED_TOP_LEVEL);
    for (const line of scriptLines(script)) {
      const parsed = parseFastbootLine(line);
      if (!parsed) continue;
      if (parsed.type === 'update') {
        requireEntry(entries, parsed.filename);
        requiredFiles.add(parsed.filename);
        await addUpdateZipSteps(entries, parsed.filename, steps, requiredFiles);
        if (parsed.wipe) {
          steps.push({ type: 'erase', partition: 'userdata', item: 'userdata' });
        }
        continue;
      }
      if (parsed.type === 'flash') {
        requireEntry(entries, parsed.filename);
        requiredFiles.add(parsed.filename);
      } else if (parsed.type === 'command' && parsed.command === 'check:android-info.zip') {
        requireEntry(entries, 'android-info.zip');
        requiredFiles.add('android-info.zip');
      }
      steps.push(parsed);
    }

    if (!steps.some((step) => step.type === 'flash' && step.partition === 'avb_custom_key')) {
      steps.push({ type: 'erase', partition: 'avb_custom_key', item: 'avb_custom_key' });
      steps.push({ type: 'flash', partition: 'avb_custom_key', filename: 'avb_pkmd.bin', item: 'avb_custom_key', source: 'outer' });
    }
    if (!steps.some((step) => step.type === 'flash' && step.partition === 'avb_custom_key')) {
      throw new InstallerError('AVB custom key flash step is missing.');
    }
    if (steps.length === 0) {
      throw new InstallerError('flash-all.sh did not produce any flash steps.');
    }

    return {
      build,
      device: DEVICE_TARGET.codename,
      script,
      bat,
      steps,
      requiredFiles: [...requiredFiles].sort(),
      avbKeyFilename: 'avb_pkmd.bin'
    };
  } finally {
    await reader.close();
  }
};

export const formatFlashPlan = (plan: FlashPlan): string =>
  plan.steps
    .map((step, index) => {
      const prefix = `${String(index + 1).padStart(2, '0')}.`;
      if (step.type === 'flash') return `${prefix} flash ${step.partition} ${step.filename}`;
      if (step.type === 'erase') return `${prefix} erase ${step.partition}`;
      if (step.type === 'reboot') return `${prefix} reboot ${step.target}`;
      return `${prefix} ${step.command}`;
    })
    .join('\n');
