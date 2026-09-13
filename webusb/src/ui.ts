import { DEVICE_TARGET } from './config';
import { createDiagnosticJson, formatTextLog, getStoredLogSession } from './logger';
import type { AppState, InstallerState, LogEntry } from './types';

export type UiActions = {
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
};

type ButtonAction = Exclude<keyof UiActions, 'acknowledgeUnlock' | 'acknowledgeLock'>;
type VisualStepStatus = 'pending' | 'active' | 'complete' | 'warning' | 'error';
type ConnectionTone = 'connected' | 'reconnecting' | 'disconnected' | 'error';
type ModalKind = 'unlock' | 'lock' | null;

const targetName = DEVICE_TARGET.name.replace('Google ', '');

const buttonLabels: Record<ButtonAction, string> = {
  connect: 'Connect Pixel',
  unlock: 'Unlock Bootloader',
  download: 'Download Worm OS',
  verify: 'Verify Image',
  flash: 'Install Worm OS',
  lock: 'Lock Bootloader',
  reboot: 'Reboot Pixel',
  reconnect: 'Reconnect Device',
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
  'RECONNECTING',
  'WAITING_MANUAL_RECONNECT',
  'LOCKING',
  'WAITING_USER_LOCK',
  'REBOOTING'
];

const reconnectStates: InstallerState[] = ['WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT'];

const busyStates: InstallerState[] = ['CONNECTING', 'DOWNLOADING', 'VERIFYING', ...destructiveBusyStates];

const flowSteps: Array<{ label: string; completeStates: InstallerState[] }> = [
  { label: 'Connect Pixel', completeStates: ['CONNECTED', 'DEVICE_VERIFIED', 'UNLOCK_REQUIRED', 'UNLOCKING', 'WAITING_USER_UNLOCK', 'UNLOCKED', 'DOWNLOADING', 'DOWNLOADED', 'VERIFYING', 'VERIFIED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Prepare Bootloader', completeStates: ['UNLOCKED', 'DOWNLOADING', 'DOWNLOADED', 'VERIFYING', 'VERIFIED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Download Worm OS', completeStates: ['DOWNLOADED', 'VERIFYING', 'VERIFIED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Verify Image', completeStates: ['VERIFIED', 'FLASHING', 'WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Install Worm OS', completeStates: ['FLASH_COMPLETE', 'LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING', 'COMPLETE'] },
  { label: 'Lock Bootloader', completeStates: ['LOCKED', 'REBOOTING', 'COMPLETE'] }
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

const statusTone = (state: InstallerState): 'success' | 'warning' | 'error' | 'waiting' | 'neutral' => {
  if (state === 'ERROR') return 'error';
  if (['COMPLETE', 'LOCKED', 'LOCK_READY', 'VERIFIED'].includes(state)) return 'success';
  if (['UNLOCK_REQUIRED', 'WAITING_USER_UNLOCK', 'WAITING_USER_LOCK'].includes(state)) return 'warning';
  if (['CONNECTING', 'DOWNLOADING', 'VERIFYING', 'FLASHING', 'WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'LOCKING', 'REBOOTING'].includes(state)) return 'waiting';
  return 'neutral';
};

const serialMatches = (actual: string | null | undefined, expected: string | null | undefined): boolean => {
  if (!expected || expected === 'Unavailable') return true;
  if (!actual || actual === 'Unavailable') return false;
  return actual === expected;
};

const currentStepIndex = (state: InstallerState): number => {
  if (state === 'COMPLETE') return 5;
  if (['LOCK_READY', 'LOCKING', 'WAITING_USER_LOCK', 'LOCKED', 'REBOOTING'].includes(state)) return 5;
  if (['FLASHING', 'WAITING_FOR_RECONNECT', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT', 'FLASH_COMPLETE'].includes(state)) return 4;
  if (['VERIFYING', 'VERIFIED'].includes(state)) return 3;
  if (['DOWNLOADING', 'DOWNLOADED'].includes(state)) return 2;
  if (['DEVICE_VERIFIED', 'UNLOCK_REQUIRED', 'UNLOCKING', 'WAITING_USER_UNLOCK', 'UNLOCKED'].includes(state)) return 1;
  return 0;
};

const headerStateLabel = (state: AppState): string => {
  switch (state.installerState) {
    case 'IDLE':
    case 'CONNECTING':
    case 'CONNECTED':
      return 'Ready to connect your Pixel';
    case 'DOWNLOADING':
      return 'Downloading Worm OS';
    case 'VERIFYING':
      return 'Verifying installation image';
    case 'FLASHING':
      return state.flash?.operation === 'unpack' || (state.flash?.operation === 'load' && state.flash.item === 'package')
        ? 'Preparing installation files'
        : 'Installing Worm OS';
    case 'WAITING_FOR_RECONNECT':
    case 'RECONNECTING':
    case 'WAITING_MANUAL_RECONNECT':
      return 'Waiting for Pixel';
    case 'COMPLETE':
      return 'Installation complete';
    case 'ERROR':
      return 'Installation needs attention';
    default:
      return state.statusMessage || 'Secure Web Installer';
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
  <div class="setting-row">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
  </div>
`;

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

export const isEnabled = (action: ButtonAction, state: AppState): boolean => {
  if (reconnectStates.includes(state.installerState)) {
    return action === 'reconnect';
  }
  if (busyStates.includes(state.installerState)) {
    return false;
  }
  switch (action) {
    case 'connect':
      return ['IDLE', 'DOWNLOADED', 'VERIFIED', 'ERROR'].includes(state.installerState);
    case 'unlock':
      return state.installerState === 'UNLOCK_REQUIRED' && state.unlockAcknowledged;
    case 'download':
      return ['IDLE', 'CONNECTED', 'DEVICE_VERIFIED', 'UNLOCK_REQUIRED', 'UNLOCKED', 'DOWNLOADED', 'VERIFIED', 'ERROR'].includes(state.installerState);
    case 'verify':
      return state.installerState === 'DOWNLOADED';
    case 'flash':
      return canFlash(state);
    case 'lock':
      return (
        state.installerState === 'LOCK_READY' &&
        state.lockAcknowledged &&
        state.deviceInfo.product === DEVICE_TARGET.codename &&
        Boolean(state.release) &&
        Boolean(state.verifiedDigest) &&
        state.verifiedDigest === state.release?.release.sha256
      );
    case 'reboot':
      return state.installerState === 'LOCKED';
    case 'reconnect':
      return reconnectStates.includes(state.installerState);
    case 'clear':
      return !busyStates.includes(state.installerState);
    case 'downloadLog':
    case 'copyLog':
    case 'clearLog':
    case 'exportJson':
      return true;
  }
};

export const createUi = (root: HTMLElement, actions: UiActions): ((state: AppState) => void) => {
  let activeLogFilter = 'All';
  let logExpanded = false;
  let autoScroll = true;
  let modalKind: ModalKind = null;
  let latestState: AppState | null = null;
  const logFilters = ['All', 'USB', 'Fastboot', 'ZIP', 'Download', 'Verify', 'Flash', 'Reconnect', 'Errors'];

  root.innerHTML = `
    <section class="catalina-shell" aria-label="Worm OS WebUSB Installer">
      <section class="mac-window">
        <header class="titlebar">
          <div class="traffic-lights" aria-hidden="true">
            <span class="traffic-light traffic-close"></span>
            <span class="traffic-light traffic-minimize"></span>
            <span class="traffic-light traffic-zoom"></span>
          </div>
          <div class="titlebar-center">
            <strong>Worm OS Installer</strong>
          </div>
          <div class="titlebar-status" aria-label="Connection status">
            <span id="connection-dot" class="connection-dot is-disconnected"></span>
          </div>
        </header>

        <div class="window-body">
          <main class="main-pane" aria-label="Main installation view">
            <header class="main-header">
              <h1>Worm OS</h1>
              <p>Secure Web Installer</p>
              <strong id="header-state" aria-live="polite">Ready to connect your Pixel</strong>
            </header>

            <section class="setup-steps" id="setup-steps" aria-label="Installation steps"></section>

            <section class="step-card panel" id="current-card" aria-live="polite"></section>

            <section class="device-card panel" aria-label="Device information">
              <div class="card-heading">
                <div>
                  <h2>${esc(targetName)}</h2>
                  <p>${esc(DEVICE_TARGET.codename)}</p>
                </div>
                <strong class="badge" id="device-status">Disconnected</strong>
              </div>
              <div class="settings-list" id="device-settings"></div>
            </section>

            <section class="release-card panel" id="release-card" aria-label="Worm OS release"></section>

            <section class="action-card panel">
              <div class="status-message" id="status-message" aria-live="polite"></div>
              <div class="error-message" id="error-message" aria-live="assertive"></div>
              <div class="button-grid" id="button-grid"></div>
            </section>
          </main>
        </div>

        <section class="technical-log" id="technical-log">
          <div class="recent-activity" aria-label="Recent activity">
            <strong>Recent activity</strong>
            <ol id="recent-activity-list"></ol>
          </div>
          <button type="button" class="log-toggle" id="log-toggle" aria-expanded="false">Show technical log</button>
          <div class="console-panel" id="console-panel">
            <div class="console-toolbar">
              <div>
                <span>Console</span>
                <strong id="fastboot-api">fastboot: not inspected</strong>
              </div>
              <label class="auto-scroll"><input id="auto-scroll" type="checkbox" checked /> Auto-scroll</label>
            </div>
            <div class="session-line">Installation session: <strong id="session-id"></strong></div>
            <div class="log-tools">
              <div class="log-filters" id="log-filters"></div>
              <span id="log-count">Logs: 0</span>
            </div>
            <ol class="log-list" id="log-list" aria-live="polite"></ol>
            <div class="log-export" id="log-export"></div>
          </div>
        </section>

        <div class="modal-layer" id="modal-layer" hidden></div>
      </section>
    </section>
  `;

  const buttonGrid = root.querySelector<HTMLDivElement>('#button-grid');
  const logFiltersRoot = root.querySelector<HTMLDivElement>('#log-filters');
  const logExport = root.querySelector<HTMLDivElement>('#log-export');
  const autoScrollInput = root.querySelector<HTMLInputElement>('#auto-scroll');
  const logToggle = root.querySelector<HTMLButtonElement>('#log-toggle');
  const modalLayer = root.querySelector<HTMLDivElement>('#modal-layer');

  if (!buttonGrid || !logFiltersRoot || !logExport || !autoScrollInput || !logToggle || !modalLayer) {
    throw new Error('Installer controls were not mounted.');
  }

  const rerender = (): void => {
    if (latestState) render(latestState);
  };

  const toggleLog = (): void => {
    logExpanded = !logExpanded;
    rerender();
  };

  autoScrollInput.addEventListener('change', () => {
    autoScroll = autoScrollInput.checked;
  });
  logToggle.addEventListener('click', toggleLog);
  root.addEventListener('click', (event) => {
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
  });

  for (const filter of logFilters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-button';
    button.dataset.filter = filter;
    button.textContent = filter;
    button.addEventListener('click', () => {
      activeLogFilter = filter;
      rerender();
    });
    logFiltersRoot.append(button);
  }

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

  for (const key of ['downloadLog', 'copyLog', 'clearLog', 'exportJson'] as ButtonAction[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = key;
    button.textContent = buttonLabels[key];
    button.addEventListener('click', actions[key]);
    logExport.append(button);
  }

  const render = (state: AppState): void => {
    latestState = state;
    const setupSteps = root.querySelector<HTMLElement>('#setup-steps');
    const currentCard = root.querySelector<HTMLElement>('#current-card');
    const releaseCard = root.querySelector<HTMLElement>('#release-card');
    const actionCard = root.querySelector<HTMLElement>('.action-card');
    const deviceSettings = root.querySelector<HTMLElement>('#device-settings');
    const deviceStatus = root.querySelector<HTMLElement>('#device-status');
    const connectionDot = root.querySelector<HTMLElement>('#connection-dot');
    const headerState = root.querySelector<HTMLElement>('#header-state');
    const statusMessage = root.querySelector<HTMLElement>('#status-message');
    const errorMessage = root.querySelector<HTMLElement>('#error-message');
    const logList = root.querySelector<HTMLOListElement>('#log-list');
    const fastbootApi = root.querySelector<HTMLElement>('#fastboot-api');
    const sessionId = root.querySelector<HTMLElement>('#session-id');
    const logCount = root.querySelector<HTMLElement>('#log-count');
    const technicalLog = root.querySelector<HTMLElement>('#technical-log');
    const recentActivityList = root.querySelector<HTMLOListElement>('#recent-activity-list');

    if (
      !setupSteps ||
      !currentCard ||
      !releaseCard ||
      !actionCard ||
      !deviceSettings ||
      !deviceStatus ||
      !connectionDot ||
      !headerState ||
      !statusMessage ||
      !errorMessage ||
      !logList ||
      !fastbootApi ||
      !sessionId ||
      !logCount ||
      !technicalLog ||
      !recentActivityList
    ) {
      throw new Error('Installer UI is missing required elements.');
    }

    const tone = connectionTone(state);
    const connected = tone === 'connected';
    const activeStep = currentStepIndex(state.installerState);

    root.dataset.tone = statusTone(state.installerState);
    root.dataset.activity = ['DOWNLOADING', 'VERIFYING', 'FLASHING', 'RECONNECTING', 'WAITING_MANUAL_RECONNECT'].includes(state.installerState) ? 'critical' : 'idle';
    technicalLog.classList.toggle('is-expanded', logExpanded);
    logToggle.textContent = logExpanded ? 'Hide technical log' : 'Show technical log';
    logToggle.setAttribute('aria-expanded', String(logExpanded));

    connectionDot.className = `connection-dot is-${tone}`;
    connectionDot.setAttribute('aria-label', connectionLabel(tone));
    headerState.textContent = headerStateLabel(state);
    deviceStatus.textContent = connected ? 'Connected' : 'Disconnected';
    deviceStatus.classList.toggle('is-good', connected);
    actionCard.hidden = reconnectStates.includes(state.installerState) || state.installerState === 'COMPLETE';

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
      settingRow('Bootloader', state.deviceInfo.bootloader),
      settingRow('Mode', reconnectStates.includes(state.installerState) ? 'Reconnecting' : 'Fastboot'),
      settingRow('Release', state.release?.release.id ?? 'Not loaded')
    ].join('');

    releaseCard.innerHTML = renderReleaseCard(state);
    currentCard.innerHTML = renderCurrentCard(state);
    statusMessage.textContent = state.statusMessage;
    errorMessage.textContent = state.errorMessage ?? '';

    fastbootApi.textContent = state.fastbootInspection
      ? `android-fastboot ${state.fastbootInspection.version}: ${state.fastbootInspection.flashFactoryZipSignature}`
      : 'fastboot: not inspected';
    sessionId.textContent = state.sessionId;
    logCount.textContent = `Logs: ${state.logCount}`;

    const primaryAction = (['connect', 'download', 'verify', 'flash', 'reconnect', 'reboot'] as ButtonAction[]).find((action) =>
      isModalTriggerEnabled(action, state)
    );

    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      const action = button.dataset.action as ButtonAction;
      const logAction = ['downloadLog', 'copyLog', 'clearLog', 'exportJson'].includes(action);
      const enabled = logAction ? true : isModalTriggerEnabled(action, state);
      button.disabled = !enabled;
      button.hidden = !logAction && (!enabled || (action === 'reconnect' && !reconnectStates.includes(state.installerState)));
      button.classList.toggle('is-primary', action === primaryAction || (state.installerState === 'COMPLETE' && action === 'reboot'));
      button.classList.toggle('is-danger', ['unlock', 'lock', 'clear', 'clearLog'].includes(action));
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-filter]')) {
      button.classList.toggle('is-active', button.dataset.filter === activeLogFilter);
    }

    renderModal(modalLayer, modalKind);
    const visibleLogs = filterLogs(state.logs, activeLogFilter);
    recentActivityList.replaceChildren(
      ...state.logs.slice(-8).map((entry) => {
        const item = document.createElement('li');
        item.textContent = compactLogMessage(entry);
        return item;
      })
    );
    logList.replaceChildren(
      ...visibleLogs.map((entry) => {
        const item = document.createElement('li');
        item.className = `log-entry log-${entry.level.toLowerCase()} log-category-${entry.category.toLowerCase()}`;
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = entry.timestamp;
        const category = document.createElement('span');
        category.className = 'log-category';
        category.textContent = entry.category;
        const message = document.createElement('span');
        message.className = 'log-message';
        message.textContent = entry.message;
        item.append(time, category, message);
        return item;
      })
    );

    if (autoScroll) {
      logList.scrollTop = logList.scrollHeight;
    }
  };

  return render;
};

const compactLogMessage = (entry: LogEntry): string => {
  if (entry.category === 'ERROR' && entry.details && typeof entry.details === 'object' && 'message' in entry.details) {
    return String((entry.details as { message?: unknown }).message ?? entry.message);
  }
  return entry.message;
};

const renderCurrentCard = (state: AppState): string => {
  if (state.installerState === 'COMPLETE') {
    return `
      <div class="complete-view">
        <div class="complete-check" aria-hidden="true">✓</div>
        <h2>Worm OS is ready</h2>
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
    return `
      <div class="center-stage">
        <h2>Pixel restarted</h2>
        <p>Reconnect the Pixel to continue installation.</p>
        <button type="button" class="is-primary" data-action="reconnect">Reconnect Device</button>
      </div>
    `;
  }

  if (state.installerState === 'VERIFYING') {
    return `
      <div class="center-stage">
        <h2>Verifying Worm OS</h2>
        <p>SHA-256 verification</p>
      </div>
      ${progressBar(state.progress, false)}
      <div class="info-list">
        ${settingRow('Expected', abbreviateHash(state.release?.release.sha256))}
        ${settingRow('Status', state.releaseVerified ? 'Verified ✓' : 'Verifying')}
      </div>
    `;
  }

  if (state.installerState === 'FLASHING') {
    const unpacking = state.flash?.operation === 'unpack' || (state.flash?.operation === 'load' && state.flash.item === 'package');
    const itemPercent = state.flash?.itemPercent ?? 0;
    return `
      <div class="center-stage">
        <h2>${unpacking ? 'Preparing installation files' : 'Installing Worm OS'}</h2>
        <span class="spinner" aria-hidden="true"></span>
        <p>${esc(formatFlashItem(state.flash?.item ?? null))}</p>
      </div>
      ${progressBar(itemPercent, Boolean(state.flash?.overallIndeterminate), unpacking ? 'Unpacking bootloader' : 'Current operation')}
      <div class="info-list">
        ${settingRow('Stage', unpacking ? 'Preparing installation files' : state.statusMessage)}
        ${settingRow('Current item', formatFlashItem(state.flash?.item ?? null))}
        ${settingRow('Mode', state.flash?.operation === 'reboot' && state.flash.item === 'fastbootd' ? 'Fastbootd' : 'Bootloader')}
        ${settingRow('Connection', 'Connected')}
        ${settingRow('Current progress', `${itemPercent}%`)}
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
    <div class="info-list">
      ${settingRow('Device', targetName)}
      ${settingRow('Product', state.deviceInfo.product === 'Unknown' ? DEVICE_TARGET.codename : state.deviceInfo.product)}
      ${settingRow('Mode', 'Bootloader')}
      ${settingRow('Connection', state.deviceInfo.serial !== 'Not connected' ? 'Connected' : 'Disconnected')}
      ${settingRow('Current stage', currentStep)}
    </div>
  `;
};

const renderReleaseCard = (state: AppState): string => {
  const download = state.download;
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
        <p>Worm OS Release</p>
      </div>
      <strong class="badge ${state.releaseVerified || download?.verified ? 'is-good' : ''}">${esc(status)}</strong>
    </div>
    <div class="release-summary">
      <strong>${download ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(download.totalBytes)}` : 'Waiting'}</strong>
      <span>${download?.percent === null || download?.percent === undefined ? `${state.progress}%` : `${Math.round(download.percent)}%`}</span>
    </div>
    ${state.installerState === 'DOWNLOADING' || download ? progressBar(percent ?? 0, false, 'Download progress') : ''}
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

const renderModal = (root: HTMLElement, kind: ModalKind): void => {
  if (!kind) {
    root.hidden = true;
    root.innerHTML = '';
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

const filterLogs = (entries: LogEntry[], filter: string): LogEntry[] => {
  if (filter === 'All') return entries;
  if (filter === 'Errors') return entries.filter((entry) => entry.level === 'ERROR');
  if (filter === 'ZIP') return entries.filter((entry) => entry.message.includes('[ZIP]') || entry.category === 'FASTBOOT');
  const category = filter.toUpperCase();
  return entries.filter((entry) => entry.category === category);
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
  connectionTone,
  currentStepIndex,
  headerStateLabel,
  renderCurrentCard,
  renderReleaseCard
};
