import { DEVICE_TARGET } from './config';
import { createDiagnosticJson, formatTextLog, getStoredLogSession } from './logger';
import type { AppState, InstallerState, LogEntry } from './types';

export type UiActions = {
  startTest: () => void;
  exitTest: () => void;
  connect: () => void;
  unlock: () => void;
  download: () => void;
  verify: () => void;
  flash: () => void;
  lock: () => void;
  reboot: () => void;
  reconnect: () => void;
  clear: () => void;
  downloadLog: () => void;
  copyLog: () => void;
  clearLog: () => void;
  exportJson: () => void;
  acknowledgeUnlock: (checked: boolean) => void;
  acknowledgeLock: (checked: boolean) => void;
  signOut: () => void;
};

type ButtonAction = Exclude<keyof UiActions, 'startTest' | 'exitTest' | 'acknowledgeUnlock' | 'acknowledgeLock' | 'signOut'>;
type VisualStepStatus = 'pending' | 'active' | 'complete' | 'warning' | 'error';
type ConnectionTone = 'connected' | 'reconnecting' | 'disconnected' | 'error';
type ModalKind = 'unlock' | 'lock' | 'test' | null;
type UiOptions = {
  authenticated?: boolean;
};

const targetName = DEVICE_TARGET.name.replace('Google ', '');
const genericDeviceName = 'Device';

const displayDeviceName = (state: AppState): string => (isDeviceConnected(state) ? state.deviceInfo.device.replace('Google ', '') : genericDeviceName);

const buttonLabels: Record<ButtonAction, string> = {
  connect: 'Connect Pixel',
  unlock: 'Unlock Bootloader',
  download: 'Download Image',
  verify: 'Verify Image',
  flash: 'Install',
  lock: 'Lock Bootloader',
  reboot: 'Reboot Pixel',
  reconnect: 'Reconnect Pixel',
  clear: 'Clear Release',
  downloadLog: 'Download Installation Log',
  copyLog: 'Copy Installation Log',
  clearLog: 'Clear Installation Log',
  exportJson: 'Export Diagnostic JSON'
};

const destructiveBusyStates: InstallerState[] = [
  'UNLOCKING',
  'WAITING_USER_UNLOCK',
  'FLASHING',
  'WAITING_FOR_RECONNECT',
  'WAITING_FOR_FLASH_RESUME',
  'RECONNECTING',
  'WAITING_MANUAL_RECONNECT',
  'LOCKING',
  'WAITING_USER_LOCK',
  'REBOOTING'
];

const reconnectStates: InstallerState[] = ['WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT'];

const busyStates: InstallerState[] = ['CONNECTING', 'DOWNLOADING', 'VERIFYING', ...destructiveBusyStates];

const flowSteps: Array<{ label: string; completeStates: InstallerState[] }> = [
  { label: 'Download release', completeStates: ['DOWNLOADED', 'VERIFYING', 'VERIFIED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Verify release', completeStates: ['VERIFIED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Connect device', completeStates: ['CONNECTED', 'DEVICE_VERIFIED', 'UNLOCK_REQUIRED', 'UNLOCKING', 'WAITING_USER_UNLOCK', 'UNLOCKED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Verify Pixel 10', completeStates: ['DEVICE_VERIFIED', 'UNLOCK_REQUIRED', 'UNLOCKING', 'WAITING_USER_UNLOCK', 'UNLOCKED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Unlock bootloader', completeStates: ['UNLOCKED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Flash bootloader', completeStates: ['FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Reconnect', completeStates: ['FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Flash radio', completeStates: ['FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Reconnect', completeStates: ['FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Install AVB key', completeStates: ['FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Flash Worm OS', completeStates: ['FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Verify installation', completeStates: ['LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Lock bootloader', completeStates: ['LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Reboot', completeStates: ['COMPLETE'] }
];

const esc = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return 'unknown';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
};

const maskSerial = (serial: string): string => {
  if (!serial || serial === 'Not connected' || serial === 'Unavailable') return serial;
  if (serial.length <= 10) return `${serial.slice(0, 2)}...${serial.slice(-2)}`;
  return `${serial.slice(0, 6)}...${serial.slice(-4)}`;
};

const abbreviateHash = (hash: string | null | undefined): string => {
  if (!hash) return 'Not available';
  return hash.length > 18 ? `${hash.slice(0, 12)}...${hash.slice(-8)}` : hash;
};

const formatFlashItem = (item: string | null): string => {
  if (!item) return 'Waiting';
  if (item === 'avb_custom_key') return 'Verified Boot key';
  return item;
};

const formatFactoryDebugStage = (state: AppState): string => {
  const operation = state.flash?.operation ?? null;
  const item = state.flash?.item ?? null;
  if (state.installerState === 'WAITING_FOR_RECONNECT' && item === 'radio') return 'Restarting bootloader';
  if (operation === 'flash' && item === 'radio') return 'radio';
  if (operation === 'reboot' && item === 'bootloader') return 'reboot-bootloader after radio';
  if (operation === 'flash' && item === 'avb_custom_key') return 'Installing Verified Boot key';
  if (operation === 'oem' && item === 'uart disable') return 'uart disable';
  if ((operation === 'erase' || operation === 'wipe') && (item === 'dpm_a' || item === 'dpm_b')) return 'dpm erase';
  if ((operation === 'update' || operation === 'check') && item === 'android-info') return 'android-info check';
  if (operation === 'snapshot-update' && item === 'cancel') return 'snapshot cancel';
  if (operation === 'flash' && item && /^(boot|dtbo|vendor_boot|vendor_kernel_boot|init_boot)(?:_[ab])?(?:\.img)?$/.test(item)) return 'boot images';
  if ((operation === 'erase' || operation === 'wipe') && item === 'userdata') return 'userdata erase';
  if ((operation === 'erase' || operation === 'wipe') && item === 'metadata') return 'metadata erase';
  const superMatch = item?.match(/^super(?:[_ -](\d+))?(?:\.img)?$/);
  if (operation === 'flash' && superMatch) return `super ${superMatch[1] ?? '?'}/16`;
  return state.installerState.replaceAll('_', ' ');
};

const statusTone = (state: InstallerState): 'success' | 'warning' | 'error' | 'waiting' | 'neutral' => {
  if (state === 'ERROR') return 'error';
  if (['COMPLETE', 'LOCKED', 'LOCK_READY', 'VERIFIED'].includes(state)) return 'success';
  if (['UNLOCK_REQUIRED', 'WAITING_USER_UNLOCK', 'WAITING_USER_LOCK'].includes(state)) return 'warning';
  if (['CONNECTING', 'DOWNLOADING', 'VERIFYING', 'FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'LOCKING', 'REBOOTING'].includes(state)) return 'waiting';
  return 'neutral';
};

const serialMatches = (actual: string | null | undefined, expected: string | null | undefined): boolean => {
  if (!expected || expected === 'Unavailable') return true;
  if (!actual || actual === 'Unavailable') return false;
  return actual === expected;
};

const currentStepIndex = (state: InstallerState): number => {
  if (state === 'COMPLETE') return 13;
  if (['REBOOTING'].includes(state)) return 13;
  if (['LOCKING', 'WAITING_USER_LOCK', 'LOCKED'].includes(state)) return 12;
  if (state === 'LOCK_READY') return 11;
  if (['FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE'].includes(state)) return 10;
  if (['UNLOCKING', 'WAITING_USER_UNLOCK', 'UNLOCKED'].includes(state)) return 4;
  if (['DEVICE_VERIFIED', 'UNLOCK_REQUIRED'].includes(state)) return 3;
  if (['CONNECTED'].includes(state)) return 2;
  if (['VERIFYING', 'VERIFIED'].includes(state)) return 1;
  return 0;
};

const headerStateLabel = (state: AppState): string => {
  switch (state.installerState) {
    case 'IDLE':
    case 'CONNECTING':
    case 'CONNECTED':
      return 'Ready to connect your device';
    case 'DOWNLOADING':
      return 'Downloading image';
    case 'DOWNLOAD_PAUSED':
      return 'Download paused';
    case 'VERIFYING':
      return 'Verifying installation image';
    case 'FLASHING':
      return state.flash?.operation === 'unpack' || (state.flash?.operation === 'load' && state.flash.item === 'package')
        ? 'Preparing installation files'
        : 'Installing';
    case 'WAITING_FOR_RECONNECT':
    case 'WAITING_FOR_FLASH_RESUME':
    case 'RECONNECTING':
    case 'WAITING_MANUAL_RECONNECT':
      return 'Waiting for Pixel';
    case 'COMPLETE':
      return 'Installation complete';
    case 'ERROR':
      return 'Installation needs attention';
    default:
      return state.statusMessage || 'WebUSB';
  }
};

const connectionTone = (state: AppState): ConnectionTone => {
  if (state.installerState === 'ERROR') return 'error';
  if (reconnectStates.includes(state.installerState)) return 'reconnecting';
  return state.deviceInfo.serial !== 'Not connected' ? 'connected' : 'disconnected';
};

const connectionLabel = (tone: ConnectionTone): string => {
  if (tone === 'connected') return 'Connected';
  if (tone === 'reconnecting') return 'Reconnecting';
  if (tone === 'error') return 'Error';
  return 'Disconnected';
};

const isModalTriggerEnabled = (action: ButtonAction, state: AppState): boolean => {
  if (action === 'unlock') return state.installerState === 'UNLOCK_REQUIRED';
  if (state.testMode && action === 'lock') return state.installerState === 'LOCK_READY';
  if (action === 'lock') return state.installerState === 'LOCK_READY';
  return isEnabled(action, state);
};

const stepIcon = (status: VisualStepStatus): string => {
  switch (status) {
    case 'complete':
      return '✓';
    case 'warning':
    case 'error':
      return '!';
    case 'active':
    case 'pending':
      return '';
  }
};

const settingRow = (label: string, value: string): string => `
  <div class="setting-row info-row">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
  </div>
`;

const isDeviceConnected = (state: AppState): boolean => state.deviceInfo.serial !== 'Not connected';

const currentModeLabel = (state: AppState): string => {
  if (!isDeviceConnected(state)) return '-';
  if (state.testMode) {
    const mode = state.logs.findLast((entry) => entry.message === 'Mode: Fastbootd' || entry.message === 'Mode: Bootloader')?.message.replace('Mode: ', '');
    return mode ?? 'Bootloader';
  }
  if (reconnectStates.includes(state.installerState)) return 'Reconnecting';
  if (state.flash?.operation === 'reboot' && state.flash.item === 'fastbootd') return 'Fastbootd';
  return 'Bootloader';
};

export const canFlash = (state: AppState): boolean =>
  state.installerState === 'VERIFIED' &&
  state.deviceInfo.serial !== 'Not connected' &&
  state.deviceInfo.product === DEVICE_TARGET.codename &&
  serialMatches(state.deviceInfo.serial, state.expectedSerial) &&
  state.deviceInfo.bootloader === 'Unlocked' &&
  state.releaseVerified &&
  state.releaseComplete &&
  state.releaseFileAvailable &&
  Boolean(state.release) &&
  state.verifiedDigest === state.release?.release.sha256;

export const computeButtonStates = (state: AppState): Record<ButtonAction, boolean> => {
  const alwaysEnabledLogButtons = {
    downloadLog: true,
    copyLog: true,
    clearLog: true,
    exportJson: true
  };
  const disabledActions = {
    connect: false,
    unlock: false,
    download: false,
    verify: false,
    flash: false,
    lock: false,
    reboot: false,
    reconnect: false,
    clear: false
  };
  if (state.testMode) {
    return {
      connect: state.installerState === 'IDLE',
      unlock: false,
      download: ['UNLOCKED', 'DEVICE_VERIFIED', 'CONNECTED'].includes(state.installerState),
      verify: state.installerState === 'DOWNLOADED',
      flash: state.installerState === 'VERIFIED',
      lock: state.installerState === 'LOCK_READY',
      reboot: state.installerState === 'LOCKED',
      reconnect: state.installerState === 'WAITING_FOR_RECONNECT',
      clear: false,
      ...alwaysEnabledLogButtons
    };
  }
  if (state.installerState === 'WAITING_FOR_RECONNECT') {
    return { ...disabledActions, reconnect: true, ...alwaysEnabledLogButtons };
  }
  if (busyStates.includes(state.installerState)) {
    return { ...disabledActions, ...alwaysEnabledLogButtons };
  }
  return {
    connect: ['IDLE', 'DOWNLOADED', 'VERIFIED', 'ERROR'].includes(state.installerState),
    unlock: state.installerState === 'UNLOCK_REQUIRED' && state.unlockAcknowledged,
    download: ['IDLE', 'CONNECTED', 'DEVICE_VERIFIED', 'UNLOCK_REQUIRED', 'UNLOCKED', 'DOWNLOAD_PAUSED', 'DOWNLOADED', 'VERIFIED', 'ERROR'].includes(state.installerState),
    verify: state.installerState === 'DOWNLOADED',
    flash: canFlash(state),
    lock:
      state.installerState === 'LOCK_READY' &&
      state.lockAcknowledged &&
      state.deviceInfo.product === DEVICE_TARGET.codename &&
      Boolean(state.release) &&
      Boolean(state.verifiedDigest) &&
      state.verifiedDigest === state.release?.release.sha256,
    reboot: state.installerState === 'LOCKED',
    reconnect: false,
    clear: true,
    ...alwaysEnabledLogButtons
  };
};

export const isEnabled = (action: ButtonAction, state: AppState): boolean => {
  const states = computeButtonStates(state);
  if (action in states) {
    return states[action];
  }
  switch (action) {
    case 'downloadLog':
    case 'copyLog':
    case 'clearLog':
    case 'exportJson':
      return true;
    default:
      return false;
  }
};

export const createUi = (root: HTMLElement, actions: UiActions, options: UiOptions = {}): ((state: AppState) => void) => {
  let modalKind: ModalKind = null;
  let debugOpen = false;
  let latestState: AppState | null = null;

  root.innerHTML = `
    <section class="catalina-shell" aria-label="WebUSB Installer">
      <section class="mac-window">
        <header class="titlebar">
          <div class="traffic-lights" aria-hidden="true">
            <span class="traffic-light traffic-close"></span>
            <span class="traffic-light traffic-minimize"></span>
            <span class="traffic-light traffic-zoom"></span>
          </div>
          <div class="titlebar-center">
            <strong>Web Installer</strong>
            <span class="mock-mode-badge" aria-label="Test mode active">TEST MODE</span>
          </div>
          <div class="titlebar-status" aria-label="Connection status">
            <span id="connection-dot" class="connection-dot is-disconnected"></span>
          </div>
        </header>

        <div class="window-body">
          <main class="main-pane" aria-label="Main installation view">
            <header class="main-header">
              <h1>WebUSB</h1>
              <strong id="header-state" aria-live="polite">Ready to connect your device</strong>
            </header>

            <section class="setup-steps" id="setup-steps" aria-label="Installation steps"></section>

            <section class="step-card panel" id="current-card" aria-live="polite"></section>

            <section class="device-card panel" aria-label="Device information">
              <div class="card-heading">
                <div>
                  <h2 id="device-name">Device</h2>
                </div>
                <strong class="badge" id="device-status">Disconnected</strong>
              </div>
              <div class="settings-list" id="device-settings"></div>
            </section>

            <section class="release-card panel" id="release-card" aria-label="Installation image"></section>

            <section class="action-card panel">
              <div class="status-message" id="status-message" aria-live="polite"></div>
              <div class="error-message" id="error-message" aria-live="assertive"></div>
              <div class="button-grid" id="button-grid"></div>
            </section>

            <section class="recent-activity-card panel" aria-label="Recent Activity">
              <div class="card-heading">
                <h2>Recent Activity</h2>
              </div>
              <ol id="recent-activity-list"></ol>
              <div class="footer-tools">
                <button type="button" class="utility-button" id="debug-button">Debug</button>
                <button type="button" class="utility-button" id="test-installer-button">Test Installer</button>
                <button type="button" class="utility-button" id="exit-test-button">Exit Test</button>
              </div>
              <div id="debug-panel-host"></div>
            </section>
          </main>
        </div>

        <div class="modal-layer" id="modal-layer" hidden></div>
      </section>
    </section>
  `;

  const buttonGrid = root.querySelector<HTMLDivElement>('#button-grid');
  const debugButton = root.querySelector<HTMLButtonElement>('#debug-button');
  const testInstallerButton = root.querySelector<HTMLButtonElement>('#test-installer-button');
  const exitTestButton = root.querySelector<HTMLButtonElement>('#exit-test-button');
  const modalLayer = root.querySelector<HTMLDivElement>('#modal-layer');

  if (!buttonGrid || !debugButton || !testInstallerButton || !exitTestButton || !modalLayer) {
    throw new Error('Installer controls were not mounted.');
  }

  const rerender = (): void => {
    if (latestState) render(latestState);
  };

  debugButton.addEventListener('click', () => {
    debugOpen = true;
    rerender();
  });

  testInstallerButton.addEventListener('click', () => {
    modalKind = 'test';
    rerender();
  });

  exitTestButton.addEventListener('click', () => {
    actions.exitTest();
  });

  root.addEventListener('click', (event) => {
    const debugAction = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-debug-action]');
    if (debugAction && latestState) {
      if (debugAction.dataset.debugAction === 'copy') {
        void copyDebugInfo(latestState);
      }
      if (debugAction.dataset.debugAction === 'download') {
        downloadDebugJson(latestState);
      }
      if (debugAction.dataset.debugAction === 'close') {
        debugOpen = false;
        rerender();
      }
      return;
    }

    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.step-card button[data-action], .complete-actions button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action as ButtonAction;
    actions[action]();
  });

  modalLayer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.modalClose === 'true') {
      modalKind = null;
      rerender();
    }
    if (target.dataset.modalConfirm === 'unlock') {
      modalKind = null;
      actions.acknowledgeUnlock(true);
      actions.unlock();
      rerender();
    }
    if (target.dataset.modalConfirm === 'lock') {
      modalKind = null;
      actions.acknowledgeLock(true);
      actions.lock();
      rerender();
    }
    if (target.dataset.modalConfirm === 'test') {
      modalKind = null;
      actions.startTest();
      rerender();
    }
  });

  for (const key of ['connect', 'unlock', 'download', 'verify', 'flash', 'lock', 'reboot', 'reconnect', 'clear'] as ButtonAction[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = key;
    button.textContent = buttonLabels[key];
    button.addEventListener('click', () => {
      if (key === 'unlock') {
        modalKind = 'unlock';
        rerender();
        return;
      }
      if (key === 'lock') {
        modalKind = 'lock';
        rerender();
        return;
      }
      actions[key]();
    });
    buttonGrid.append(button);
  }

  const render = (state: AppState): void => {
    latestState = state;
    const setupSteps = root.querySelector<HTMLElement>('#setup-steps');
    const currentCard = root.querySelector<HTMLElement>('#current-card');
    const releaseCard = root.querySelector<HTMLElement>('#release-card');
    const actionCard = root.querySelector<HTMLElement>('.action-card');
    const deviceSettings = root.querySelector<HTMLElement>('#device-settings');
    const deviceName = root.querySelector<HTMLElement>('#device-name');
    const deviceStatus = root.querySelector<HTMLElement>('#device-status');
    const connectionDot = root.querySelector<HTMLElement>('#connection-dot');
    const headerState = root.querySelector<HTMLElement>('#header-state');
    const statusMessage = root.querySelector<HTMLElement>('#status-message');
    const errorMessage = root.querySelector<HTMLElement>('#error-message');
    const recentActivityList = root.querySelector<HTMLOListElement>('#recent-activity-list');
    const debugPanelHost = root.querySelector<HTMLElement>('#debug-panel-host');

    if (
      !setupSteps ||
      !currentCard ||
      !releaseCard ||
      !actionCard ||
      !deviceSettings ||
      !deviceName ||
      !deviceStatus ||
      !connectionDot ||
      !headerState ||
      !statusMessage ||
      !errorMessage ||
      !recentActivityList ||
      !debugPanelHost
    ) {
      throw new Error('Installer UI is missing required elements.');
    }

    const tone = connectionTone(state);
    const connected = tone === 'connected';
    const hasDevice = isDeviceConnected(state);
    const activeStep = currentStepIndex(state.installerState);

    root.dataset.tone = statusTone(state.installerState);
    root.dataset.activity = ['DOWNLOADING', 'VERIFYING', 'FLASHING', 'WAITING_FOR_FLASH_RESUME', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT'].includes(state.installerState) ? 'critical' : 'idle';
    root.dataset.testMode = state.testMode ? 'true' : 'false';

    connectionDot.className = `connection-dot is-${tone}`;
    connectionDot.setAttribute('aria-label', connectionLabel(tone));
    headerState.textContent = headerStateLabel(state);
    deviceName.textContent = displayDeviceName(state);
    deviceStatus.textContent = connected ? 'Connected' : 'Disconnected';
    deviceStatus.classList.toggle('is-good', connected);
    actionCard.hidden = state.installerState === 'COMPLETE';

    setupSteps.innerHTML = flowSteps
      .map((step, index) => {
        const status: VisualStepStatus =
          state.installerState === 'ERROR' && index === activeStep
            ? 'error'
            : ['UNLOCK_REQUIRED', 'WAITING_USER_UNLOCK', 'WAITING_USER_LOCK'].includes(state.installerState) && index === activeStep
              ? 'warning'
              : step.completeStates.includes(state.installerState)
                ? 'complete'
                : index === activeStep
                  ? 'active'
                  : 'pending';
        return `<div class="flow-step is-${status}" aria-label="${esc(step.label)}">
          <span aria-hidden="true">${stepIcon(status) || index + 1}</span>
        </div>`;
      })
      .join('');

    deviceSettings.innerHTML = [
      settingRow('Product', hasDevice ? state.deviceInfo.product : '-'),
      settingRow('Bootloader', hasDevice ? state.deviceInfo.bootloader : 'Unknown'),
      settingRow('Mode', currentModeLabel(state)),
      settingRow('Connection', connectionLabel(tone)),
      settingRow('Release', state.release?.release.id ?? 'Not loaded')
    ].join('');

    releaseCard.innerHTML = renderReleaseCard(state);
    currentCard.innerHTML = renderCurrentCard(state);
    statusMessage.textContent = neutralizeBranding(state.statusMessage);
    errorMessage.textContent = state.errorMessage ? neutralizeBranding(state.errorMessage) : '';

    const primaryAction = (['connect', 'download', 'verify', 'flash', 'reconnect', 'reboot'] as ButtonAction[]).find((action) =>
      isModalTriggerEnabled(action, state)
    );
    const buttonStates = computeButtonStates(state);

    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      const action = button.dataset.action as ButtonAction;
      const logAction = ['downloadLog', 'copyLog', 'clearLog', 'exportJson'].includes(action);
      const enabled = logAction ? true : action === 'unlock' || action === 'lock' ? isModalTriggerEnabled(action, state) : buttonStates[action];
      button.disabled = !enabled;
      button.hidden = false;
      button.classList.toggle('is-primary', action === primaryAction || (state.installerState === 'COMPLETE' && action === 'reboot'));
      button.classList.toggle('is-danger', ['unlock', 'lock', 'clear', 'clearLog'].includes(action));
    }

    renderModal(modalLayer, modalKind, state, options);
    testInstallerButton.hidden = !options.authenticated || state.testMode;
    exitTestButton.hidden = !state.testMode;
    debugButton.setAttribute('aria-expanded', String(debugOpen));
    debugPanelHost.innerHTML = debugOpen ? renderDebugPanel(state, options) : '';
    recentActivityList.replaceChildren(
      ...recentActivity(state.logs).map((entry) => {
        const item = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = `activity-dot is-${activityTone(entry)}`;
        dot.setAttribute('aria-hidden', 'true');
        const message = document.createElement('span');
        message.textContent = compactLogMessage(entry);
        item.append(dot, message);
        return item;
      })
    );
  };

  return render;
};

const compactLogMessage = (entry: LogEntry): string => {
  if (entry.category === 'ERROR' && entry.details && typeof entry.details === 'object' && 'message' in entry.details) {
    return neutralizeBranding(String((entry.details as { message?: unknown }).message ?? entry.message));
  }
  if (entry.message === 'Waiting for manual reconnect') return 'Waiting for reconnect';
  if (entry.message === 'Reconnect Pixel clicked') return 'Waiting for reconnect';
  if (entry.message === 'Worm OS installation complete') return 'Installation complete';
  if (entry.message === 'Download complete') return 'Image downloaded';
  if (entry.message === 'Verified Boot key') return 'Preparing avb_custom_key';
  if (entry.message.startsWith('Mode: ')) return entry.message.replace('Mode: ', 'Pixel restarted ');
  return neutralizeBranding(entry.message);
};

const neutralizeBranding = (message: string): string =>
  message
    .replaceAll('Worm OS installation complete', 'Installation complete')
    .replaceAll('Worm OS release', 'installation image')
    .replaceAll('Worm OS installer', 'web installer')
    .replaceAll('Worm OS factory ZIP', 'factory ZIP')
    .replaceAll('Worm OS installation', 'installation')
    .replaceAll('Worm OS', 'installation image');

const allowedActivityPatterns = [
  /^Pixel connected$/,
  /^Pixel disconnected$/,
  /^Device verified$/,
  /^Download started$/,
  /^Download (25|50|75)%$/,
  /^Image verified$/,
  /^Image downloaded$/,
  /^Download complete$/,
  /^Verifying image$/,
  /^(50|100)%$/,
  /^Installation started$/,
  /^Unpacking bootloader$/,
  /^Bootloader (25|50|75|100)%$/,
  /^Preparing .+/,
  /^Flashing .+ (25|50|75|100)%$/,
  /^radio start$/,
  /^radio (0|25|50|75|100)%$/,
  /^radio complete$/,
  /^Lock requested$/,
  /^Waiting for confirmation$/,
  /^Bootloader locked$/,
  /^Rebooting$/,
  /^Complete$/,
  /^Pixel restarted$/,
  /^Waiting for manual reconnect$/,
  /^Reconnect Pixel clicked$/,
  /^requested after radio$/,
  /^waiting for manual click$/,
  /^connect\(\) start$/,
  /^connect\(\) success$/,
  /^Pixel reconnected$/,
  /^Installation resumed$/,
  /^Installation complete$/,
  /^Worm OS installation complete$/,
  /^Verified Boot key$/
];

const isEssentialEvent = (entry: LogEntry): boolean =>
  entry.level === 'ERROR' || entry.level === 'WARN' || allowedActivityPatterns.some((pattern) => pattern.test(entry.message));

const isRecentActivityEvent = (entry: LogEntry): boolean => {
  if (entry.level === 'ERROR') {
    return entry.message === 'Installation error' || entry.message === 'Installation stopped.';
  }
  return isEssentialEvent(entry);
};

const recentActivity = (entries: LogEntry[]): LogEntry[] => entries.filter(isRecentActivityEvent).slice(-6);

const debugEvents = (entries: LogEntry[]): LogEntry[] => entries.filter(isEssentialEvent).slice(-10);

const activityTone = (entry: LogEntry): 'good' | 'warning' | 'error' | 'waiting' | 'neutral' => {
  if (entry.level === 'ERROR') return 'error';
  if (entry.level === 'WARN') return 'warning';
  if (/complete|verified|connected|resumed/i.test(entry.message)) return 'good';
  if (/waiting|preparing|flashing|started|restarted/i.test(entry.message)) return 'waiting';
  return 'neutral';
};

const renderCurrentCard = (state: AppState): string => {
  const verify = state.verify ?? {
    state: 'idle',
    verifiedBytes: 0,
    totalBytes: 0,
    percent: 0,
    expectedSha256: null,
    actualSha256: null,
    metadataVerified: false,
    fileAvailable: false,
    fileSize: null
  };
  if (state.installerState === 'COMPLETE') {
    return `
      <div class="complete-view">
        <div class="complete-check" aria-hidden="true">✓</div>
        <h2>Installation Complete</h2>
        <p>${esc(targetName)}</p>
        <p>Release ${esc(state.release?.release.id ?? 'Not available')}</p>
        <div class="complete-actions">
          <button type="button" data-action="reboot">Reboot Pixel</button>
          <button type="button" data-action="downloadLog">Download Installation Log</button>
        </div>
      </div>
    `;
  }

  if (reconnectStates.includes(state.installerState)) {
    const postRadioReconnect = state.installerState === 'WAITING_FOR_RECONNECT' && state.flash?.item === 'radio';
    return `
      <div class="center-stage">
        <h2>${postRadioReconnect ? 'Radio installed' : 'Pixel restarted'}</h2>
        <p>${postRadioReconnect ? 'Pixel restarted into bootloader.' : esc(state.statusMessage || 'Reconnect the Pixel to continue installation.')}</p>
        <button type="button" class="is-primary" data-action="reconnect">Reconnect Pixel</button>
      </div>
      <div class="info-list">
        ${currentOperationRows(state)}
      </div>
    `;
  }

  if (state.installerState === 'VERIFYING') {
    const verificationPercent = verify.percent || state.progress;
    return `
      <div class="center-stage">
        <h2>Verify Image</h2>
        <p>Verifying image</p>
      </div>
      ${progressBar(verificationPercent, false, 'Verification progress')}
      <div class="info-list">
        ${settingRow('Expected', abbreviateHash(state.release?.release.sha256))}
        ${settingRow('Status', state.releaseVerified ? 'Image verified ✓' : `Verifying image ${Math.round(verificationPercent)}%`)}
      </div>
    `;
  }

  if (state.installerState === 'FLASHING') {
    const unpacking = state.flash?.operation === 'unpack' || (state.flash?.operation === 'load' && state.flash.item === 'package');
    const itemPercent = state.flash?.itemPercent ?? 0;
    return `
      <div class="center-stage">
        <h2>${unpacking ? 'Preparing installation files' : 'Install'}</h2>
        <span class="spinner" aria-hidden="true"></span>
        <p>${esc(formatFlashItem(state.flash?.item ?? null))}</p>
      </div>
      ${progressBar(itemPercent, Boolean(state.flash?.overallIndeterminate), unpacking ? 'Unpacking bootloader' : 'Current operation')}
      <div class="info-list">
        ${currentOperationRows(state)}
      </div>
      ${state.statusMessage.toLowerCase().includes('waiting') || state.statusMessage.toLowerCase().includes('time') ? `<div class="inline-warning">${esc(state.statusMessage)}</div>` : ''}
    `;
  }

  const currentStep = flowSteps[currentStepIndex(state.installerState)]?.label ?? 'Connect Pixel';
  return `
    <div class="center-stage">
      <p>Current step</p>
      <h2>${esc(currentStep)}</h2>
      <strong>${esc(state.installerState.replaceAll('_', ' '))}</strong>
    </div>
    <p class="card-copy">${esc(state.statusMessage)}</p>
  `;
};

const currentOperationRows = (state: AppState): string =>
  [
    settingRow('Stage', formatFactoryDebugStage(state)),
    settingRow('Item', formatFlashItem(state.flash?.item ?? null)),
    settingRow('Mode', currentModeLabel(state)),
    settingRow('Connection', connectionLabel(connectionTone(state))),
    settingRow('Progress', currentProgressLabel(state))
  ].join('');

const currentProgressLabel = (state: AppState): string => {
  if (state.flash) return `${Math.round(state.flash.itemPercent)}%`;
  if (state.download?.percent !== null && state.download?.percent !== undefined) return `${Math.round(state.download.percent)}%`;
  return `${Math.round(state.progress)}%`;
};

const renderReleaseCard = (state: AppState): string => {
  const download = state.download;
  const verify = state.verify ?? {
    state: 'idle',
    verifiedBytes: 0,
    totalBytes: 0,
    percent: 0,
    expectedSha256: null,
    actualSha256: null,
    metadataVerified: false,
    fileAvailable: false,
    fileSize: null
  };
  const status =
    state.releaseVerified || download?.verified
      ? 'Downloaded ✓'
      : download?.storedLocally && state.releaseComplete
        ? 'Release already available locally ✓'
        : download?.status?.toLowerCase().includes('resume') || download?.status?.toLowerCase().includes('partial')
          ? 'Resuming cached download'
          : download?.status ?? 'Not downloaded';
  const percent = download?.percent ?? state.progress;
  return `
    <div class="card-heading">
      <div>
        <h2>${esc(state.release?.release.id ?? 'Not loaded')}</h2>
        <p>Installation Image</p>
      </div>
      <strong class="badge ${state.releaseVerified || download?.verified ? 'is-good' : ''}">${esc(status)}</strong>
    </div>
    <div class="release-summary">
      <strong>${download ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(download.totalBytes)}` : 'Waiting'}</strong>
      <span>${download?.percent === null || download?.percent === undefined ? `${state.progress}%` : `${Math.round(download.percent)}%`}</span>
    </div>
    <div class="info-list">
      ${settingRow('Device', 'Pixel 10 / frankel')}
      ${settingRow('Build', state.release?.build ?? state.release?.release.id ?? '2026091500')}
      ${settingRow('Android', state.release?.android ?? '17')}
      ${settingRow('Release channel', state.release?.channel ?? 'stable')}
      ${settingRow('Install type', 'full WebUSB installation')}
      ${settingRow('Data wipe', 'REQUIRED')}
    </div>
    ${state.installerState === 'DOWNLOADING' || download ? progressBar(percent ?? 0, false, 'Download progress') : ''}
    ${verify.state === 'verifying' || verify.state === 'verified' || verify.state === 'failed' ? progressBar(verify.percent, false, 'Verification progress') : ''}
  `;
};

const progressBar = (percent: number, indeterminate: boolean, label = 'Progress'): string => {
  const safe = Math.min(100, Math.max(0, Math.round(percent)));
  return `
    <div class="progress-wrap">
      <div class="progress-meta">
        <span>${esc(label)}</span>
        <strong>${indeterminate ? 'Indeterminate' : `${safe}%`}</strong>
      </div>
      <div class="progress-track ${indeterminate ? 'is-indeterminate' : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" ${indeterminate ? '' : `aria-valuenow="${safe}"`}>
        <div class="progress-fill" style="width: ${indeterminate ? '42' : safe}%"></div>
      </div>
    </div>
  `;
};

const renderModal = (root: HTMLElement, kind: ModalKind, state: AppState, options: UiOptions = {}): void => {
  if (!kind) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  if (kind === 'test') {
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-backdrop" data-modal-close="true"></div>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">Test Installer</h2>
        <p>This mode simulates a complete installation. No device will be modified.</p>
        <div class="modal-actions">
          <button type="button" data-modal-close="true">Cancel</button>
          <button type="button" class="is-primary" data-modal-confirm="test">Start Test</button>
        </div>
      </section>
    `;
    return;
  }
  const isUnlock = kind === 'unlock';
  root.hidden = false;
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-close="true"></div>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">${isUnlock ? 'Unlock Bootloader' : 'Lock Bootloader'}</h2>
      <p>${isUnlock ? 'Unlocking the bootloader will erase all user data.' : 'Locking completes Verified Boot protection and erases user data again.'}</p>
      <div class="modal-actions">
        <button type="button" data-modal-close="true">Cancel</button>
        <button type="button" class="is-danger" data-modal-confirm="${isUnlock ? 'unlock' : 'lock'}">${isUnlock ? 'Unlock Bootloader' : 'Lock Bootloader'}</button>
      </div>
    </section>
  `;
};

const renderDebugPanel = (state: AppState, options: UiOptions = {}): string => {
  const snapshot = createDebugSnapshot(state, options);
  return `
    <section class="debug-panel" aria-labelledby="debug-title">
      <header class="debug-header">
        <h2 id="debug-title">Debug</h2>
        <button type="button" class="utility-button" data-debug-action="close">Close</button>
      </header>
      <h3>Debug details</h3>
      <div class="debug-grid">
        ${debugRow('Session', snapshot.session)}
        ${debugRow('Device', snapshot.device.name)}
        ${debugRow('Product', snapshot.device.product)}
        ${debugRow('Serial masked', snapshot.device.serial)}
        ${debugRow('Connection', snapshot.connection)}
        ${debugRow('Mode', snapshot.mode)}
        ${debugRow('Bootloader', snapshot.device.bootloader)}
        ${debugRow('Release', snapshot.release)}
        ${debugRow('Image', snapshot.image)}
        ${debugRow('Installer state', snapshot.state)}
        ${debugRow('Verify state', snapshot.verify.state)}
        ${debugRow('verifiedBytes', snapshot.verify.verifiedBytes)}
        ${debugRow('totalBytes', snapshot.verify.totalBytes)}
        ${debugRow('verifyPercent', snapshot.verify.percent)}
        ${debugRow('expectedSha256', snapshot.verify.expectedSha256)}
        ${debugRow('actualSha256', snapshot.verify.actualSha256)}
        ${debugRow('metadataVerified', snapshot.verify.metadataVerified)}
        ${debugRow('fileAvailable', snapshot.verify.fileAvailable)}
        ${debugRow('fileSize', snapshot.verify.fileSize)}
        ${debugRow('Current stage', snapshot.stage)}
        ${debugRow('Current item', snapshot.item)}
        ${debugRow('Progress', snapshot.progress)}
        ${debugRow('lastAction', snapshot.factory.lastAction)}
        ${debugRow('lastItem', snapshot.factory.lastItem)}
        ${debugRow('lastProgress', snapshot.factory.lastProgress)}
        ${debugRow('Last operation', snapshot.factory.lastOperation)}
        ${debugRow('Last successful operation', snapshot.factory.lastSuccessfulOperation)}
        ${debugRow('Test mode', snapshot.testMode)}
        ${debugRow('Mock device', snapshot.mockDevice)}
        ${debugRow('Factory flash active', snapshot.factoryFlashActive)}
        ${debugRow('error.name', snapshot.error.name)}
        ${debugRow('error.message', snapshot.error.message)}
        ${debugRow('error.constructor.name', snapshot.error.constructorName)}
        ${debugRow('Fastboot error', snapshot.error.fastbootStatus)}
        ${debugRow('bootloaderMessage', snapshot.error.bootloaderMessage)}
        ${debugRow('error.stack', snapshot.error.stack)}
        ${debugRow('Factory flash error', snapshot.factoryFlashError)}
        ${debugRow('Factory flash stack', snapshot.factoryFlashStack)}
        ${debugRow('Reconnect pending', snapshot.reconnect.pending)}
        ${debugRow('Reconnect sequence', String(snapshot.reconnect.sequence))}
        ${debugRow('lastConnectError', snapshot.reconnect.lastConnectError)}
        ${debugRow('ZIP worker', snapshot.zipWorker)}
        ${debugRow('Last warning', snapshot.lastWarning)}
        ${debugRow('Last error', snapshot.lastError)}
      </div>
      <section class="debug-events" aria-label="Recent debug events">
        <h3>Recent debug events</h3>
        <ol>
          ${snapshot.recentEvents.map((event) => `<li class="debug-event">${esc(event)}</li>`).join('')}
        </ol>
      </section>
      <div class="debug-actions">
        <button type="button" data-debug-action="copy">Copy Debug</button>
        <button type="button" data-debug-action="download">Download Debug</button>
        <button type="button" data-debug-action="close">Close</button>
      </div>
    </section>
  `;
};

const debugRow = (label: string, value: string): string => `
  <div class="debug-row">
    <span>${esc(label)}</span>
    <strong class="debug-value">${esc(value)}</strong>
  </div>
`;

const lastLogMessage = (entries: LogEntry[], level: 'WARN' | 'ERROR'): string => {
  const message = entries.findLast((entry) => entry.level === level)?.message;
  return message ? neutralizeBranding(message) : '-';
};

const reconnectSequence = (entries: LogEntry[]): number => {
  for (const entry of entries.toReversed()) {
    if (entry.details && typeof entry.details === 'object' && 'reconnectSequence' in entry.details) {
      const value = Number((entry.details as { reconnectSequence?: unknown }).reconnectSequence);
      return Number.isFinite(value) ? value : 0;
    }
  }
  return 0;
};

const detailString = (details: unknown, key: string): string | null => {
  if (!details || typeof details !== 'object' || !(key in details)) {
    return null;
  }
  const value = (details as Record<string, unknown>)[key];
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
};

const lastDetail = (entries: LogEntry[], key: string): string => {
  for (const entry of entries.toReversed()) {
    const value = detailString(entry.details, key);
    if (value !== null) {
      return value;
    }
  }
  return '-';
};

const lastErrorDetail = (entries: LogEntry[], key: string): string => {
  for (const entry of entries.toReversed()) {
    if (entry.level !== 'ERROR') {
      continue;
    }
    const value = detailString(entry.details, key);
    if (value !== null) {
      return value;
    }
  }
  return '-';
};

const createDebugSnapshot = (state: AppState, options: UiOptions = {}) => {
  const connected = isDeviceConnected(state);
  const events = debugEvents(state.logs).map((entry) => `${entry.timestamp} ${compactLogMessage(entry)}`);
  const verify = state.verify ?? {
    state: 'idle',
    verifiedBytes: 0,
    totalBytes: 0,
    percent: 0,
    expectedSha256: null,
    actualSha256: null,
    metadataVerified: false,
    fileAvailable: false,
    fileSize: null
  };
  return {
    schemaVersion: 1,
    session: state.sessionId,
    device: {
      name: displayDeviceName(state),
      product: connected ? state.deviceInfo.product : '-',
      serial: maskSerial(state.deviceInfo.serial),
      bootloader: connected ? state.deviceInfo.bootloader : 'Unknown'
    },
    connection: connectionLabel(connectionTone(state)),
    mode: currentModeLabel(state),
    release: state.release?.release.id ?? '-',
    image: state.releaseVerified ? 'Verified' : state.releaseComplete || state.releaseFileAvailable ? 'Downloaded' : '-',
    state: state.installerState,
    verify: {
      state: verify.state,
      verifiedBytes: String(verify.verifiedBytes),
      totalBytes: String(verify.totalBytes),
      percent: `${Math.round(verify.percent)}%`,
      expectedSha256: verify.expectedSha256 ?? '-',
      actualSha256: verify.actualSha256 ?? '-',
      metadataVerified: verify.metadataVerified ? 'Yes' : 'No',
      fileAvailable: verify.fileAvailable ? 'Yes' : 'No',
      fileSize: verify.fileSize === null ? '-' : String(verify.fileSize)
    },
    stage: formatFactoryDebugStage(state),
    item: formatFlashItem(state.flash?.item ?? null),
    progress: currentProgressLabel(state),
    factory: {
      lastAction: lastDetail(state.logs, 'action'),
      lastItem: lastDetail(state.logs, 'item'),
      lastProgress: lastDetail(state.logs, 'percent'),
      lastOperation: lastDetail(state.logs, 'lastOperation'),
      lastSuccessfulOperation: lastDetail(state.logs, 'lastSuccessfulOperation')
    },
    testMode: state.testMode ? 'Yes' : 'No',
    mockDevice: state.testMode ? 'Yes' : 'No',
    factoryFlashActive: ['FLASHING', 'WAITING_FOR_RECONNECT', 'WAITING_FOR_FLASH_RESUME'].includes(state.installerState) ? 'Yes' : 'No',
    error: {
      name: lastErrorDetail(state.logs, 'errorName'),
      message: lastErrorDetail(state.logs, 'errorMessage'),
      constructorName: lastErrorDetail(state.logs, 'errorConstructorName'),
      fastbootStatus: lastErrorDetail(state.logs, 'fastbootStatus'),
      bootloaderMessage: lastErrorDetail(state.logs, 'bootloaderMessage'),
      stack: lastErrorDetail(state.logs, 'errorStack')
    },
    factoryFlashError: lastErrorDetail(state.logs, 'errorMessage'),
    factoryFlashStack: lastErrorDetail(state.logs, 'stack') !== '-' ? lastErrorDetail(state.logs, 'stack') : lastErrorDetail(state.logs, 'errorStack'),
    reconnect: {
      pending: reconnectStates.includes(state.installerState) ? 'Yes' : 'No',
      sequence: state.testMode ? state.testReconnectSequence : reconnectSequence(state.logs),
      lastConnectError: lastDetail(state.logs, 'lastConnectError')
    },
    zipWorker: zipWorkerStatus(state),
    lastWarning: lastLogMessage(state.logs, 'WARN'),
    lastError: state.errorMessage ?? lastLogMessage(state.logs, 'ERROR'),
    recentEvents: events
  };
};

const zipWorkerStatus = (state: AppState): 'Ready' | 'Error' | 'Unknown' => {
  if (state.logs.some((entry) => entry.level === 'ERROR' && /zip|worker/i.test(entry.message))) return 'Error';
  if (state.fastbootInspection?.zipWorkers.length) return 'Ready';
  return 'Unknown';
};

const debugText = (state: AppState): string => {
  const snapshot = createDebugSnapshot(state);
  return [
    `session: ${snapshot.session}`,
    `device: ${snapshot.device.name}`,
    `product: ${snapshot.device.product}`,
    `serial: ${snapshot.device.serial}`,
    `release: ${snapshot.release}`,
    `state: ${snapshot.state}`,
    `verifyState: ${snapshot.verify.state}`,
    `verifiedBytes: ${snapshot.verify.verifiedBytes}`,
    `totalBytes: ${snapshot.verify.totalBytes}`,
    `verifyPercent: ${snapshot.verify.percent}`,
    `expectedSha256: ${snapshot.verify.expectedSha256}`,
    `actualSha256: ${snapshot.verify.actualSha256}`,
    `metadataVerified: ${snapshot.verify.metadataVerified}`,
    `fileAvailable: ${snapshot.verify.fileAvailable}`,
    `fileSize: ${snapshot.verify.fileSize}`,
    `stage: ${snapshot.stage}`,
    `item: ${snapshot.item}`,
    `progress: ${snapshot.progress}`,
    `lastAction: ${snapshot.factory.lastAction}`,
    `lastItem: ${snapshot.factory.lastItem}`,
    `lastProgress: ${snapshot.factory.lastProgress}`,
    `Last operation: ${snapshot.factory.lastOperation}`,
    `Last successful operation: ${snapshot.factory.lastSuccessfulOperation}`,
    `factoryFlashActive: ${snapshot.factoryFlashActive}`,
    `error.name: ${snapshot.error.name}`,
    `error.message: ${snapshot.error.message}`,
    `error.constructor.name: ${snapshot.error.constructorName}`,
    `Fastboot error: ${snapshot.error.fastbootStatus}`,
    `bootloaderMessage: ${snapshot.error.bootloaderMessage}`,
    `error.stack: ${snapshot.error.stack}`,
    `Factory flash error: ${snapshot.factoryFlashError}`,
    `Factory flash stack: ${snapshot.factoryFlashStack}`,
    `reconnect: ${snapshot.reconnect.pending} / ${snapshot.reconnect.sequence}`,
    `lastConnectError: ${snapshot.reconnect.lastConnectError}`,
    `zipWorker: ${snapshot.zipWorker}`,
    `lastWarning: ${snapshot.lastWarning}`,
    `lastError: ${snapshot.lastError}`,
    'recentEvents:',
    ...snapshot.recentEvents.map((event) => `- ${event}`)
  ].join('\n');
};

const copyDebugInfo = async (state: AppState): Promise<void> => {
  const text = debugText(state);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

const downloadDebugJson = (state: AppState): void => {
  downloadBlob(`worm-debug-${state.sessionId}.json`, new Blob([JSON.stringify(createDebugSnapshot(state), null, 2)], { type: 'application/json' }));
};

export const downloadTextLog = async (state: AppState): Promise<void> => {
  const session = await getStoredLogSession(state.sessionId);
  const text = formatTextLog(session?.entries ?? state.logs);
  downloadBlob(`worm-install-${state.sessionId}.log`, new Blob([text], { type: 'text/plain;charset=utf-8' }));
};

export const copyTextLog = async (state: AppState): Promise<void> => {
  const session = await getStoredLogSession(state.sessionId);
  const text = formatTextLog(session?.entries ?? state.logs);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

export const downloadDiagnosticJson = async (state: AppState): Promise<void> => {
  const diagnostic = await createDiagnosticJson(state);
  downloadBlob(`worm-install-${state.sessionId}.json`, new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' }));
};

const downloadBlob = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const __uiTest = {
  compactLogMessage,
  connectionTone,
  createUi,
  createDebugSnapshot,
  currentStepIndex,
  debugEvents,
  displayDeviceName,
  headerStateLabel,
  recentActivity,
  renderCurrentCard,
  renderDebugPanel,
  renderReleaseCard
};
