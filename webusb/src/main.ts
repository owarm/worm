import { getAuthStatus, logout, renderAuthScreen } from './auth';
import type { UiActions } from './ui';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('App root was not found.');
}

type Cleanup = () => void;

let installerCleanup: Cleanup | null = null;
let authCleanup: Cleanup | null = null;

const renderLogin = (initialError?: string): void => {
  installerCleanup?.();
  installerCleanup = null;
  authCleanup?.();
  authCleanup = renderAuthScreen(root, {
    initialError,
    onAuthenticated: async () => {
      authCleanup?.();
      authCleanup = null;
      await startInstaller();
    }
  });
};

const startInstaller = async (): Promise<void> => {
  const { detectSupportedHost, renderUnsupportedHost } = await import('./platform');
  const host = detectSupportedHost();

  if (!host.supported) {
    renderUnsupportedHost(root, host);
    return;
  }

  const [{ Installer }, state, types, ui] = await Promise.all([
    import('./installer'),
    import('./state'),
    import('./types'),
    import('./ui')
  ]);
  const { TestInstaller } = await import('./test-installer');

  const {
    addLog,
    clearInstallationLogs,
    enterErrorState,
    getState,
    resetSession,
    setProgress,
    subscribe
  } = state;
  const { InstallerError } = types;
  const { copyTextLog, createUi, downloadDiagnosticJson, downloadTextLog } = ui;

  const mockDevice = import.meta.env.DEV ? await import('./mock-device') : null;
  const mockMode = mockDevice?.isMockModeEnabled() ?? false;
  const mockFastboot = mockMode ? await import('./mock-fastboot') : null;
  const installer = new Installer(
    mockMode && mockFastboot
      ? {
          createDevice: mockFastboot.createMockFastbootDevice,
          mockMode: true
        }
      : undefined
  );
  const testInstaller = new TestInstaller();

  const handleOnline = (): void => addLog('BROWSER', 'network online', undefined, 'BROWSER');
  const handleOffline = (): void => addLog('BROWSER', 'network offline', undefined, 'BROWSER');

  const actions: UiActions = {
    startTest: () => {
      testInstaller.start();
    },
    exitTest: () => {
      testInstaller.exit();
    },
    connect: () => {
      void (getState().testMode ? testInstaller.connect() : installer.connect());
    },
    unlock: () => {
      void installer.unlockBootloader();
    },
    download: () => {
      void (getState().testMode ? testInstaller.download() : installer.downloadWormOs());
    },
    verify: () => {
      void (getState().testMode ? testInstaller.verify() : installer.verifyRelease());
    },
    flash: () => {
      void (getState().testMode ? testInstaller.install() : installer.flashWormOs());
    },
    lock: () => {
      void (getState().testMode ? testInstaller.lock() : installer.lockBootloader());
    },
    reboot: () => {
      void (getState().testMode ? testInstaller.reboot() : installer.rebootPixel());
    },
    reconnect: () => {
      void (getState().testMode ? testInstaller.reconnect() : installer.reconnectManual());
    },
    clear: () => {
      void (getState().testMode ? Promise.resolve() : installer.clearDownloadedRelease());
    },
    downloadLog: () => {
      void downloadTextLog(getState());
    },
    copyLog: () => {
      void copyTextLog(getState()).then(() => addLog('SUCCESS', 'Installation log copied.'));
    },
    clearLog: () => {
      void clearInstallationLogs().then(() => addLog('INFO', 'Installation log cleared.'));
    },
    exportJson: () => {
      void downloadDiagnosticJson(getState());
    },
    acknowledgeUnlock: (checked) => {
      installer.acknowledgeUnlock(checked);
    },
    acknowledgeLock: (checked) => {
      installer.acknowledgeLock(checked);
    },
    signOut: () => {
      void logout().finally(() => {
        resetSession();
        renderLogin();
      });
    }
  };

  const render = createUi(root, actions, { authenticated: true });
  const unsubscribe = subscribe(render);
  installerCleanup = () => {
    unsubscribe();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    root.innerHTML = '';
  };

  if (mockMode) {
    root.dataset.mockMode = 'true';
  } else {
    delete root.dataset.mockMode;
  }
  addLog('INFO', '[PLATFORM] Android host accepted', { platform: host.platform }, 'BROWSER');

  installer
    .init()
    .then(() => {
      setProgress(0);
    })
    .catch((error: unknown) => {
      console.error(error);
      const message = error instanceof InstallerError || error instanceof Error ? error.message : String(error);
      enterErrorState(message);
    });

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
};

export const bootApp = async (): Promise<void> => {
  const authStatus = await getAuthStatus();
  if (authStatus !== 'authenticated') {
    renderLogin(authStatus === 'unavailable' ? 'Authentication service unavailable.' : undefined);
    return;
  }

  await startInstaller();
};

void bootApp();
