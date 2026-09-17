import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UiActions } from './ui';

describe('main startup auth and platform gates', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock('./auth');
    vi.doUnmock('./installer');
    vi.doUnmock('./platform');
    vi.doUnmock('./state');
    vi.doUnmock('./types');
    vi.doUnmock('./ui');
    vi.doUnmock('./mock-device');
    vi.doUnmock('./mock-fastboot');
  });

  const stubRoot = () => {
    const root = { innerHTML: '', dataset: {} };
    vi.stubGlobal('document', { querySelector: vi.fn(() => root) });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      isSecureContext: true,
      location: { search: '' }
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
      usb: {}
    });
    return root;
  };

  it('renders login on 401 and does not initialize Installer before auth', async () => {
    const root = stubRoot();

    vi.doMock('./auth', () => ({
      getAuthStatus: vi.fn().mockResolvedValue('unauthenticated'),
      logout: vi.fn(),
      renderAuthScreen: vi.fn((target) => {
        target.innerHTML = '<h1>WebUSB</h1><p>Authentication required</p>';
        return vi.fn();
      })
    }));
    vi.doMock('./installer', () => {
      throw new Error('Installer should not be imported before auth.');
    });

    await import('./main');
    await vi.dynamicImportSettled();

    expect(root.innerHTML).toContain('Authentication required');
    expect(root.innerHTML).not.toContain('Connect Pixel');
  });

  it('renders installer on 200 auth', async () => {
    const root = stubRoot();
    const init = vi.fn().mockResolvedValue(undefined);
    const createUi = vi.fn((target) => {
      target.innerHTML = '<button>Connect Pixel</button>';
      return vi.fn();
    });

    vi.doMock('./auth', () => ({
      getAuthStatus: vi.fn().mockResolvedValue('authenticated'),
      logout: vi.fn(),
      renderAuthScreen: vi.fn()
    }));
    vi.doMock('./platform', () => ({
      detectSupportedHost: vi.fn(() => ({ supported: true, platform: 'Android' })),
      renderUnsupportedHost: vi.fn()
    }));
    vi.doMock('./installer', () => ({
      Installer: vi.fn(() => ({
        init,
        connect: vi.fn(),
        unlockBootloader: vi.fn(),
        downloadWormOs: vi.fn(),
        verifyRelease: vi.fn(),
        flashWormOs: vi.fn(),
        lockBootloader: vi.fn(),
        rebootPixel: vi.fn(),
        reconnectManual: vi.fn(),
        clearDownloadedRelease: vi.fn(),
        acknowledgeUnlock: vi.fn(),
        acknowledgeLock: vi.fn()
      }))
    }));
    vi.doMock('./mock-device', () => ({
      isMockModeEnabled: vi.fn(() => false)
    }));
    vi.doMock('./state', () => ({
      addLog: vi.fn(),
      clearInstallationLogs: vi.fn().mockResolvedValue(undefined),
      enterErrorState: vi.fn(),
      getState: vi.fn(() => ({})),
      resetSession: vi.fn(),
      setProgress: vi.fn(),
      subscribe: vi.fn((render) => {
        render({});
        return vi.fn();
      })
    }));
    vi.doMock('./types', () => ({ InstallerError: Error }));
    vi.doMock('./ui', () => ({
      copyTextLog: vi.fn(),
      createUi,
      downloadDiagnosticJson: vi.fn(),
      downloadTextLog: vi.fn()
    }));

    await import('./main');
    await vi.dynamicImportSettled();

    expect(createUi).toHaveBeenCalledWith(root, expect.objectContaining({ signOut: expect.any(Function) }), { authenticated: true });
    expect(init).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toContain('Connect Pixel');
  });

  it('shows auth service unavailable when startup auth check cannot reach backend', async () => {
    const root = stubRoot();

    vi.doMock('./auth', () => ({
      getAuthStatus: vi.fn().mockResolvedValue('unavailable'),
      logout: vi.fn(),
      renderAuthScreen: vi.fn((target, options) => {
        target.innerHTML = options.initialError;
        return vi.fn();
      })
    }));
    vi.doMock('./installer', () => {
      throw new Error('Installer should not be imported when auth is unavailable.');
    });

    await import('./main');
    await vi.dynamicImportSettled();

    expect(root.innerHTML).toBe('Authentication service unavailable.');
  });

  it('logout resets runtime state and returns to login', async () => {
    const root = stubRoot();
    const resetSession = vi.fn();
    const logout = vi.fn().mockResolvedValue(undefined);
    let actions: UiActions | null = null;

    vi.doMock('./auth', () => ({
      getAuthStatus: vi.fn().mockResolvedValue('authenticated'),
      logout,
      renderAuthScreen: vi.fn((target) => {
        target.innerHTML = '<p>Authentication required</p>';
        return vi.fn();
      })
    }));
    vi.doMock('./platform', () => ({
      detectSupportedHost: vi.fn(() => ({ supported: true, platform: 'Android' })),
      renderUnsupportedHost: vi.fn()
    }));
    vi.doMock('./installer', () => ({
      Installer: vi.fn(() => ({
        init: vi.fn().mockResolvedValue(undefined),
        connect: vi.fn(),
        unlockBootloader: vi.fn(),
        downloadWormOs: vi.fn(),
        verifyRelease: vi.fn(),
        flashWormOs: vi.fn(),
        lockBootloader: vi.fn(),
        rebootPixel: vi.fn(),
        reconnectManual: vi.fn(),
        clearDownloadedRelease: vi.fn(),
        acknowledgeUnlock: vi.fn(),
        acknowledgeLock: vi.fn()
      }))
    }));
    vi.doMock('./mock-device', () => ({
      isMockModeEnabled: vi.fn(() => false)
    }));
    vi.doMock('./state', () => ({
      addLog: vi.fn(),
      clearInstallationLogs: vi.fn().mockResolvedValue(undefined),
      enterErrorState: vi.fn(),
      getState: vi.fn(() => ({})),
      resetSession,
      setProgress: vi.fn(),
      subscribe: vi.fn((render) => {
        render({});
        return vi.fn();
      })
    }));
    vi.doMock('./types', () => ({ InstallerError: Error }));
    vi.doMock('./ui', () => ({
      copyTextLog: vi.fn(),
      createUi: vi.fn((target, uiActions) => {
        actions = uiActions;
        target.innerHTML = '<button>Connect Pixel</button>';
        return vi.fn();
      }),
      downloadDiagnosticJson: vi.fn(),
      downloadTextLog: vi.fn()
    }));

    await import('./main');
    await vi.dynamicImportSettled();
    actions?.signOut();
    await flushPromises();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toContain('Authentication required');
  });
});

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
