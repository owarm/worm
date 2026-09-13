import { afterEach, describe, expect, it, vi } from 'vitest';

describe('main startup platform gate', () => {
  afterEach(() => {
    vi.doUnmock('./installer');
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not initialize Installer on an unsupported host', async () => {
    const root = { innerHTML: '' };
    const querySelector = vi.fn(() => root);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    vi.stubGlobal('document', { querySelector });
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      usb: {}
    });
    vi.doMock('./installer', () => {
      throw new Error('Installer should not be imported for unsupported hosts.');
    });

    await import('./main');

    expect(querySelector).toHaveBeenCalledWith('#app');
    expect(root.innerHTML).toContain('Mobile installer only');
    expect(root.innerHTML).not.toContain('Connect Pixel');
    expect(infoSpy).toHaveBeenCalledWith('Unsupported Worm OS installer host');
  });
});
