import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { __uiTest, canFlash, isEnabled } from './ui';
import type { AppState, InstallerState } from './types';

const release = {
  schema: 1,
  channel: 'secure',
  device: 'frankel',
  release: {
    id: '2026091100',
    file: 'worm-os-frankel.zip',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    size: 2_244_801_536
  }
} as const;

const baseState = (installerState: InstallerState, overrides: Partial<AppState> = {}): AppState => ({
  sessionId: 'worm-test',
  installerState,
  deviceInfo: {
    device: 'Google Pixel 10',
    product: 'frankel',
    serial: 'ABCDEF1234567890',
    bootloader: 'Unlocked'
  },
  release,
  download: null,
  flash: null,
  progress: 0,
  statusMessage: 'Worm OS installer ready.',
  errorMessage: null,
  logs: [],
  logCount: 0,
  fastbootInspection: null,
  unlockAcknowledged: false,
  lockAcknowledged: false,
  verifiedDigest: release.release.sha256,
  cacheKey: 'secure/frankel/2026091100',
  expectedSerial: 'ABCDEF1234567890',
  releaseComplete: true,
  releaseVerified: true,
  releaseFileAvailable: true,
  ...overrides
});

describe('Catalina WebUSB UI rendering helpers', () => {
  it('maps connected and ready-to-flash state without weakening flash preconditions', () => {
    const state = baseState('VERIFIED', { statusMessage: 'Release SHA-256 verified.' });

    expect(__uiTest.connectionTone(state)).toBe('connected');
    expect(__uiTest.headerStateLabel(state)).toBe('Release SHA-256 verified.');
    expect(canFlash(state)).toBe(true);
    expect(isEnabled('flash', state)).toBe(true);
  });

  it('renders the compact reconnect view without resetting installation context', () => {
    const state = baseState('RECONNECTING', {
      statusMessage: 'Waiting for Pixel 10...',
      progress: 44,
      flash: {
        operation: 'reboot',
        item: 'fastbootd',
        itemPercent: 44,
        overallPercent: null,
        rawProgress: 0.44,
        overallIndeterminate: true
      }
    });

    expect(__uiTest.currentStepIndex(state.installerState)).toBe(4);
    expect(__uiTest.headerStateLabel(state)).toBe('Waiting for Pixel');
    expect(__uiTest.renderCurrentCard(state)).toContain('Pixel restarted');
    expect(__uiTest.renderCurrentCard(state)).toContain('Reconnect Device');
    expect(__uiTest.renderCurrentCard(state)).not.toContain('Current stage');
  });

  it('renders unpack as indeterminate preparation, not a fake overall installation percent', () => {
    const state = baseState('FLASHING', {
      statusMessage: 'Preparing installation files.',
      flash: {
        operation: 'unpack',
        item: 'bootloader',
        itemPercent: 25,
        overallPercent: null,
        rawProgress: 0.25,
        overallIndeterminate: true
      }
    });

    const html = __uiTest.renderCurrentCard(state);

    expect(html).toContain('Preparing installation files');
    expect(html).toContain('Unpacking bootloader');
    expect(html).toContain('Indeterminate');
    expect(html).toContain('bootloader');
    expect(html).toContain('Current progress');
    expect(html).toContain('25%');
  });

  it('renders per-item flash progress without presenting it as global progress', () => {
    const state = baseState('FLASHING', {
      statusMessage: 'Flashing bootloader...',
      flash: {
        operation: 'flash',
        item: 'bootloader',
        itemPercent: 80,
        overallPercent: null,
        rawProgress: 0.8,
        overallIndeterminate: true
      }
    });

    const html = __uiTest.renderCurrentCard(state);

    expect(html).toContain('Installing Worm OS');
    expect(html).toContain('Current operation');
    expect(html).toContain('Current progress');
    expect(html).toContain('80%');
  });

  it('renders download, verification, and complete cards with abbreviated sensitive details', () => {
    const downloading = baseState('DOWNLOADING', {
      progress: 67.8,
      verifiedDigest: null,
      releaseComplete: false,
      releaseVerified: false,
      download: {
        releaseId: '2026091100',
        downloadedBytes: 1_524_711_424,
        totalBytes: 2_244_801_536,
        percent: 67.8,
        storedLocally: true,
        verified: false,
        status: 'Server accepted resume from byte 1048576.'
      }
    });
    const verifying = baseState('VERIFYING', { progress: 52, releaseVerified: false });
    const complete = baseState('COMPLETE', { deviceInfo: { device: 'Google Pixel 10', product: 'frankel', serial: 'ABCDEF1234567890', bootloader: 'Locked' } });

    expect(__uiTest.renderReleaseCard(downloading)).toContain('Resuming cached download');
    expect(__uiTest.renderReleaseCard(downloading)).toContain('1.42 GB / 2.09 GB');
    expect(__uiTest.renderCurrentCard(verifying)).toContain('0123456789ab...89abcdef');
    expect(__uiTest.renderCurrentCard(verifying)).not.toContain(release.release.sha256);
    expect(__uiTest.renderCurrentCard(complete)).toContain('Worm OS is ready');
    expect(__uiTest.renderCurrentCard(complete)).toContain('Download Installation Log');
  });
});

describe('Catalina UI stylesheet contract', () => {
  const cssPath = fileURLToPath(new URL('./style.css', import.meta.url));
  const css = readFileSync(cssPath, 'utf8');

  it('defines the mobile-only Catalina window, titlebar, log toggle, and modal classes', () => {
    expect(css).toContain('.mac-window');
    expect(css).toContain('width: min(100% - 20px, 430px)');
    expect(css).toContain('min-height: 100dvh');
    expect(css).toContain('display: flex');
    expect(css).toContain('justify-content: center');
    expect(css).toContain('backdrop-filter: blur(18px) saturate(140%)');
    expect(css).toContain('.traffic-lights');
    expect(css).toContain('.connection-dot.is-reconnecting');
    expect(css).toContain('.technical-log.is-expanded .console-panel');
    expect(css).toContain('max-height: 240px');
    expect(css).toContain('.modal');
    expect(css).toContain('grid-template-columns: repeat(6, 1fr)');
    expect(css).not.toContain('.sidebar');
    expect(css).not.toContain('920px');
    expect(css).not.toContain('@media (max-width: 880px)');
  });

  it('keeps reduced motion and critical-operation animation throttling in place', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('[data-activity="critical"] .mac-window');
  });
});
