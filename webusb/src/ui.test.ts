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
  testMode: false,
  testReconnectSequence: 0,
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
  statusMessage: 'Web installer ready.',
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
  const uiPath = fileURLToPath(new URL('./ui.ts', import.meta.url));
  const uiSource = readFileSync(uiPath, 'utf8');

  it('maps connected and ready-to-flash state without weakening flash preconditions', () => {
    const state = baseState('VERIFIED', { statusMessage: 'Release SHA-256 verified.' });

    expect(__uiTest.connectionTone(state)).toBe('connected');
    expect(__uiTest.headerStateLabel(state)).toBe('Release SHA-256 verified.');
    expect(canFlash(state)).toBe(true);
    expect(isEnabled('flash', state)).toBe(true);
  });

  it('uses generic main UI text before connection and detected device text after connection', () => {
    const disconnected = baseState('IDLE', {
      deviceInfo: {
        device: 'Not connected',
        product: 'Not connected',
        serial: 'Not connected',
        bootloader: 'Unknown'
      },
      expectedSerial: null
    });

    expect(__uiTest.headerStateLabel(disconnected)).toBe('Ready to connect your device');
    expect(__uiTest.displayDeviceName(disconnected)).toBe('Device');
    expect(__uiTest.connectionTone(disconnected)).toBe('disconnected');
    expect(__uiTest.displayDeviceName(baseState('DEVICE_VERIFIED'))).toBe('Pixel 10');
    expect(uiSource).toContain('<h1>WebUSB</h1>');
    expect(uiSource).toContain('<h2 id="device-name">Device</h2>');
    expect(uiSource).not.toContain('Secure Web Installer');
    expect(uiSource).not.toContain('Ready to connect your Pixel');
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
    expect(__uiTest.renderCurrentCard(state)).toContain('Reconnect Pixel');
    expect(__uiTest.renderCurrentCard(state)).toContain('Stage');
    expect(__uiTest.renderCurrentCard(state)).toContain('Item');
    expect(__uiTest.renderCurrentCard(state)).toContain('Mode');
    expect(__uiTest.renderCurrentCard(state)).toContain('Connection');
    expect(__uiTest.renderCurrentCard(state)).toContain('Progress');
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
    expect(html).toContain('Progress');
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

    expect(html).toContain('Install');
    expect(html).toContain('Current operation');
    expect(html).toContain('Progress');
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
    expect(__uiTest.renderCurrentCard(complete)).toContain('Installation Complete');
    expect(__uiTest.renderCurrentCard(complete)).toContain('Download Installation Log');
  });

  it('keeps paused downloads recoverable without enabling install actions', () => {
    const paused = baseState('DOWNLOAD_PAUSED', {
      progress: 40,
      verifiedDigest: null,
      releaseComplete: false,
      releaseVerified: false,
      releaseFileAvailable: true
    });

    expect(__uiTest.headerStateLabel(paused)).toBe('Download paused');
    expect(__uiTest.currentStepIndex(paused.installerState)).toBe(2);
    expect(isEnabled('download', paused)).toBe(true);
    expect(isEnabled('flash', paused)).toBe(false);
  });

  it('keeps Recent Activity compact and removes the technical log toggle from the UI source', () => {
    const logs = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      sessionId: 'worm-test',
      level: 'INFO' as const,
      category: 'FLASH' as const,
      message: `Preparing item-${index}`,
      timestamp: `2026-09-13T12:00:0${index}.000Z`
    }));

    expect(__uiTest.recentActivity(logs)).toHaveLength(6);
    expect(uiSource).toContain('id="debug-button"');
    expect(uiSource).toContain('id="debug-panel-host"');
    expect(uiSource).toContain('Debug');
    expect(uiSource).not.toContain('Show technical log');
    expect(uiSource).not.toContain('Hide technical log');
    expect(uiSource).not.toContain('log-filters');
    expect(uiSource).not.toContain('console-panel');
  });

  it('builds masked debug diagnostics with only essential recent events', () => {
    const state = baseState('FLASHING', {
      flash: {
        operation: 'flash',
        item: 'bootloader',
        itemPercent: 75,
        overallPercent: null,
        rawProgress: 0.75,
        overallIndeterminate: true
      },
      logs: [
        {
          id: 1,
          sessionId: 'worm-test',
          level: 'INFO',
          category: 'USB',
          message: 'getDevices scan',
          timestamp: '2026-09-13T12:00:00.000Z'
        },
        {
          id: 2,
          sessionId: 'worm-test',
          level: 'INFO',
          category: 'FLASH',
          message: 'Installation started',
          timestamp: '2026-09-13T12:00:01.000Z'
        },
        {
          id: 3,
          sessionId: 'worm-test',
          level: 'INFO',
          category: 'FLASH',
          message: 'Flashing bootloader 75%',
          timestamp: '2026-09-13T12:00:02.000Z'
        }
      ]
    });

    const debug = __uiTest.createDebugSnapshot(state);
    const debugPanel = __uiTest.renderDebugPanel(state);

    expect(debug.device.serial).toBe('ABCDEF...7890');
    expect(debug.device.serial).not.toBe('ABCDEF1234567890');
    expect(debug.state).toBe('FLASHING');
    expect(debug.stage).toBe('FLASHING');
    expect(debug.item).toBe('bootloader');
    expect(debug.progress).toBe('75%');
    expect(debug.recentEvents).toHaveLength(2);
    expect(debugPanel).toContain('Debug details');
    expect(debugPanel).toContain('Serial masked');
    expect(debugPanel).toContain('Recent debug events');
    expect(debugPanel).toContain('Copy Debug');
    expect(debugPanel).toContain('Download Debug');
    expect(debugPanel).toContain('data-debug-action="close"');
    expect(debugPanel).not.toContain('Authentication');
    expect(debugPanel).not.toContain('Sign out');
    expect(__uiTest.debugEvents(Array.from({ length: 24 }, (_, index) => ({
      id: index + 1,
      sessionId: 'worm-test',
      level: 'INFO' as const,
      category: 'FLASH' as const,
      message: `Preparing item-${index}`,
      timestamp: `2026-09-13T12:00:${String(index).padStart(2, '0')}.000Z`
    })))).toHaveLength(10);
  });

  it('keeps footer debug closed by default and opens/closes inline from the footer', () => {
    expect(uiSource).toContain('let debugOpen = false');
    expect(uiSource).toContain('<button type="button" class="utility-button" id="debug-button">Debug</button>');
    expect(uiSource).toContain('debugOpen = true');
    expect(uiSource).toContain("debugAction.dataset.debugAction === 'close'");
    expect(uiSource).toContain('debugOpen = false');
    expect(uiSource).toContain('debugPanelHost.innerHTML = debugOpen ? renderDebugPanel(state, options) :');
    expect(uiSource).not.toContain("modalKind = 'debug'");
  });

  it('includes Test Installer footer controls and the TEST MODE badge contract', () => {
    expect(uiSource).toContain('<span class="mock-mode-badge" aria-label="Test mode active">TEST MODE</span>');
    expect(uiSource).toContain('id="test-installer-button"');
    expect(uiSource).toContain('id="exit-test-button"');
    expect(uiSource).toContain('root.dataset.testMode = state.testMode ?');
  });
});

describe('Catalina UI stylesheet contract', () => {
  const cssPath = fileURLToPath(new URL('./style.css', import.meta.url));
  const css = readFileSync(cssPath, 'utf8');

  it('defines the finalized smartphone Catalina contract without technical log UI', () => {
    expect(css).toContain('.mac-window');
    expect(css).toContain('--font-xs: 12px');
    expect(css).toContain('--font-sm: 13px');
    expect(css).toContain('--font-base: 15px');
    expect(css).toContain('--font-button: 16px');
    expect(css).toContain('--font-section: 18px');
    expect(css).toContain('--font-step: 22px');
    expect(css).toContain('--font-title: 30px');
    expect(css).toContain('max(8px, env(safe-area-inset-left))');
    expect(css).toContain('grid-template-columns: repeat(6, 1fr)');
    expect(css).toContain('max-width: none');
    expect(css).toContain('min-height: 100dvh');
    expect(css).toContain('border-radius: 18px');
    expect(css).toContain('height: 50px');
    expect(css).toContain('min-height: 50px');
    expect(css).toContain('font-size: var(--font-button)');
    expect(css).toContain('.utility-button');
    expect(css).toContain('height: 36px');
    expect(css).toContain('backdrop-filter: blur(14px) saturate(130%)');
    expect(css).toContain('.traffic-lights');
    expect(css).toContain('.connection-dot.is-reconnecting');
    expect(css).toContain('.recent-activity-card');
    expect(css).toContain('.debug-panel');
    expect(css).toContain('height: 36px');
    expect(css).toContain('font-size: 13px');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('.modal');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(css).toContain('width: 40px');
    expect(css).not.toContain('.technical-log');
    expect(css).not.toContain('.log-toggle');
    expect(css).not.toContain('.console-panel');
    expect(css).not.toContain('.log-filters');
    expect(css).not.toContain('.filter-button');
    expect(css).not.toContain('100vw');
    expect(css).not.toContain('font-size: 4vw');
    expect(css).not.toContain('.sidebar');
    expect(css).not.toContain('width: calc(100% - 12px)');
    expect(css).not.toContain('920px');
    expect(css).not.toContain('@media (max-width: 880px)');
  });

  it('keeps footer debug naturally expanding without nested or horizontal scrolling', () => {
    const debugPanelBlock = css.match(/\.debug-panel \{[\s\S]*?\n\}/)?.[0] ?? '';
    const debugEventsListBlock = css.match(/\.debug-events ol \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(css).toContain('.debug-panel,\n.debug-panel *');
    expect(css).toContain('max-width: 100%');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('box-sizing: border-box');
    expect(css).toContain('height: auto');
    expect(css).toContain('max-height: none');
    expect(css).toContain('overflow: visible');
    expect(css).toContain('.debug-value,\n.debug-event');
    expect(css).toContain('word-break: break-word');
    expect(debugPanelBlock).not.toContain('overflow-y: auto');
    expect(debugPanelBlock).not.toContain('overflow: scroll');
    expect(debugEventsListBlock).not.toContain('overflow-y: auto');
    expect(debugEventsListBlock).not.toContain('overflow: scroll');
    expect(debugEventsListBlock).not.toContain('max-height: 190px');
  });

  it('keeps reduced motion and critical-operation animation throttling in place', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('[data-activity="critical"] .mac-window');
  });
});
