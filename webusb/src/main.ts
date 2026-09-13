import { detectSupportedHost, renderUnsupportedHost } from './platform';
import type { UiActions } from './ui';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('App root was not found.');
}

const host = detectSupportedHost();

if (!host.supported) {
  renderUnsupportedHost(root, host);
} else {
  const startInstaller = async (): Promise<void> => {
    const [{ Installer }, state, types, ui] = await Promise.all([
      import('./installer'),
      import('./state'),
      import('./types'),
      import('./ui')
    ]);
    const {
      addLog,
      clearInstallationLogs,
      enterErrorState,
      getState,
      setProgress,
      subscribe
    } = state;
    const { InstallerError } = types;
    const { copyTextLog, createUi, downloadDiagnosticJson, downloadTextLog } = ui;

    const installer = new Installer();

    const actions: UiActions = {
      connect: () => {
        void installer.connect();
      },
      unlock: () => {
        void installer.unlockBootloader();
      },
      download: () => {
        void installer.downloadWormOs();
      },
      verify: () => {
        void installer.verifyRelease();
      },
      flash: () => {
        void installer.flashWormOs();
      },
      lock: () => {
        void installer.lockBootloader();
      },
      reboot: () => {
        void installer.rebootPixel();
      },
      reconnect: () => {
        void installer.reconnectManual();
      },
      clear: () => {
        void installer.clearDownloadedRelease();
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
      }
    };

    const render = createUi(root, actions);
    subscribe(render);
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

    window.addEventListener('online', () => addLog('BROWSER', 'network online', undefined, 'BROWSER'));
    window.addEventListener('offline', () => addLog('BROWSER', 'network offline', undefined, 'BROWSER'));
  };

  void startInstaller();
}
