import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectSupportedHost, renderUnsupportedHost } from './platform';

const chromeAndroidUa =
  'Mozilla/5.0 (Linux; Android 15; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const windowsChromeUa =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const macChromeUa =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const linuxChromeUa =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const chromeOsUa =
  'Mozilla/5.0 (X11; CrOS x86_64 16002.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const iphoneUa =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const ipadUa =
  'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

const usb = {
  getDevices: async () => [],
  requestDevice: async () => ({ opened: true }),
  addEventListener: () => undefined,
  removeEventListener: () => undefined
} satisfies USB;

const installHost = ({
  userAgent,
  platform,
  mobile,
  webUsb = true,
  secure = true
}: {
  userAgent: string;
  platform?: string;
  mobile?: boolean;
  webUsb?: boolean;
  secure?: boolean;
}): void => {
  vi.stubGlobal('window', { isSecureContext: secure });
  vi.stubGlobal('navigator', {
    userAgent,
    ...(platform || mobile !== undefined ? { userAgentData: { platform, mobile } } : {}),
    ...(webUsb ? { usb } : {})
  });
};

describe('detectSupportedHost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows Android with WebUSB', () => {
    installHost({ userAgent: chromeAndroidUa });

    expect(detectSupportedHost()).toEqual({ supported: true, platform: 'Android' });
  });

  it('blocks Android without WebUSB with the browser guidance message', () => {
    installHost({ userAgent: chromeAndroidUa, webUsb: false });

    const result = detectSupportedHost();

    expect(result.supported).toBe(false);
    expect(result.reason).toBe('WebUSB is not available in this browser.\nUse Chrome, Chromium or another compatible Chromium-based browser.');
  });

  it('blocks Windows Chrome', () => {
    installHost({ userAgent: windowsChromeUa });

    expect(detectSupportedHost()).toMatchObject({ supported: false, platform: 'Windows', reason: 'Desktop browsers are not supported.' });
  });

  it('blocks macOS Chrome', () => {
    installHost({ userAgent: macChromeUa });

    expect(detectSupportedHost()).toMatchObject({ supported: false, platform: 'macOS', reason: 'Desktop browsers are not supported.' });
  });

  it('blocks Linux Chrome', () => {
    installHost({ userAgent: linuxChromeUa });

    expect(detectSupportedHost()).toMatchObject({ supported: false, platform: 'Linux', reason: 'Desktop browsers are not supported.' });
  });

  it('blocks ChromeOS', () => {
    installHost({ userAgent: chromeOsUa });

    expect(detectSupportedHost()).toMatchObject({ supported: false, platform: 'ChromeOS', reason: 'Desktop browsers are not supported.' });
  });

  it('blocks iPhone', () => {
    installHost({ userAgent: iphoneUa });

    expect(detectSupportedHost()).toMatchObject({ supported: false, platform: 'iPhone', reason: 'Desktop browsers are not supported.' });
  });

  it('blocks iPad', () => {
    installHost({ userAgent: ipadUa });

    expect(detectSupportedHost()).toMatchObject({ supported: false, platform: 'iPad', reason: 'Desktop browsers are not supported.' });
  });

  it('allows Android userAgentData even when the UA looks desktop-like', () => {
    installHost({ userAgent: linuxChromeUa, platform: 'Android', mobile: true });

    expect(detectSupportedHost()).toEqual({ supported: true, platform: 'Android' });
  });

  it('shows Desktop site mode guidance when Android cannot be determined reliably', () => {
    installHost({ userAgent: linuxChromeUa, platform: 'Linux', mobile: true });

    expect(detectSupportedHost()).toMatchObject({
      supported: false,
      platform: 'Linux',
      reason: 'Disable Desktop site mode and reload this page.'
    });
  });
});

describe('renderUnsupportedHost', () => {
  it('renders only the mobile installer block', () => {
    const root = { innerHTML: '' } as HTMLElement;
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    renderUnsupportedHost(root, { supported: false, platform: 'Windows', reason: 'Desktop browsers are not supported.' });

    expect(root.innerHTML).toContain('WEB INSTALLER');
    expect(root.innerHTML).toContain('Mobile installer only');
    expect(root.innerHTML).toContain('Desktop browsers are not supported.');
    expect(root.innerHTML).toContain('Open worm.estixari.com on an Android device.');
    expect(root.innerHTML).not.toContain('Connect Pixel');
    expect(root.innerHTML).not.toContain('Unlock Bootloader');
    expect(root.innerHTML).not.toContain('Download Worm OS');
    expect(root.innerHTML).not.toContain('Verify Release');
    expect(root.innerHTML).not.toContain('Flash Worm OS');
    expect(root.innerHTML).not.toContain('Lock Bootloader');
    expect(root.innerHTML).not.toContain('Reconnect Pixel');
    expect(infoSpy).toHaveBeenCalledWith('Unsupported Worm OS installer host');
  });
});
