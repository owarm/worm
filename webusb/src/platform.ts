export type SupportedHostResult = {
  supported: boolean;
  platform: string;
  reason?: string;
};

type NavigatorUserAgentDataLike = {
  platform?: string;
  mobile?: boolean;
};

const ANDROID_WEBUSB_UNAVAILABLE =
  'WebUSB is not available in this browser.\nUse Chrome, Chromium or another compatible Chromium-based browser.';
const DESKTOP_SITE_MODE = 'Disable Desktop site mode and reload this page.';
const SECURE_CONTEXT_UNAVAILABLE = 'This installer requires a secure HTTPS browser context.';
const DESKTOP_UNSUPPORTED = 'Desktop browsers are not supported.';

const getNavigator = (): Navigator | undefined => (typeof navigator === 'undefined' ? undefined : navigator);

const hasWebUsb = (nav: Navigator | undefined): boolean => Boolean(nav && 'usb' in nav && nav.usb);

const hasSecureContext = (): boolean => typeof window !== 'undefined' && window.isSecureContext === true;

const getUserAgentData = (nav: Navigator | undefined): NavigatorUserAgentDataLike | undefined => {
  const candidate = nav as (Navigator & { userAgentData?: NavigatorUserAgentDataLike }) | undefined;
  return candidate?.userAgentData;
};

const normalizePlatform = (value: string | undefined): string => (value ?? '').trim();

const platformFromUserAgentData = (data: NavigatorUserAgentDataLike | undefined): string => normalizePlatform(data?.platform);

const platformFromUserAgent = (ua: string): string => {
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X|Mac OS/i.test(ua)) return 'macOS';
  if (/Linux|X11/i.test(ua)) return 'Linux';
  return 'Unknown';
};

const isBlockedDesktopOrIos = (platform: string, ua: string): boolean => {
  const value = platform.toLowerCase();
  return (
    value.includes('windows') ||
    value.includes('mac') ||
    value.includes('chrome os') ||
    value.includes('cros') ||
    value.includes('linux') ||
    value.includes('iphone') ||
    value.includes('ipad') ||
    /Windows|Macintosh|Mac OS X|CrOS|iPhone|iPad/i.test(ua)
  );
};

const isAmbiguousAndroidDesktopMode = (data: NavigatorUserAgentDataLike | undefined, ua: string, platform: string): boolean => {
  if (/Android/i.test(ua) || platform.toLowerCase().includes('android')) {
    return false;
  }

  const chromiumLike = /Chrome|Chromium|CriOS|EdgA|OPR|SamsungBrowser/i.test(ua);
  const desktopLike = /Linux|X11/i.test(ua) || platform.toLowerCase().includes('linux');
  return Boolean(chromiumLike && desktopLike && data?.mobile === true);
};

export const detectSupportedHost = (): SupportedHostResult => {
  const nav = getNavigator();
  const ua = nav?.userAgent ?? '';
  const uaData = getUserAgentData(nav);
  const dataPlatform = platformFromUserAgentData(uaData);
  const platform = dataPlatform || platformFromUserAgent(ua);
  const android = dataPlatform ? dataPlatform.toLowerCase().includes('android') : /Android/i.test(ua);

  if (!android && isAmbiguousAndroidDesktopMode(uaData, ua, platform)) {
    return { supported: false, platform, reason: DESKTOP_SITE_MODE };
  }

  if (!android) {
    return {
      supported: false,
      platform,
      reason: isBlockedDesktopOrIos(platform, ua) ? DESKTOP_UNSUPPORTED : DESKTOP_SITE_MODE
    };
  }

  if (!dataPlatform && /Windows|Macintosh|Mac OS X|CrOS|iPhone|iPad/i.test(ua)) {
    return { supported: false, platform, reason: DESKTOP_UNSUPPORTED };
  }

  if (!hasSecureContext()) {
    return { supported: false, platform: platform || 'Android', reason: SECURE_CONTEXT_UNAVAILABLE };
  }

  if (!hasWebUsb(nav)) {
    return { supported: false, platform: platform || 'Android', reason: ANDROID_WEBUSB_UNAVAILABLE };
  }

  return { supported: true, platform: platform || 'Android' };
};

export const renderUnsupportedHost = (root: HTMLElement, result: SupportedHostResult): void => {
  console.info('Unsupported Worm OS installer host');
  root.innerHTML = `
    <main class="mobile-block" aria-labelledby="mobile-block-title">
      <section class="mobile-block-panel">
        <div class="mobile-block-icon" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="img" focusable="false">
            <rect x="20" y="6" width="24" height="52" rx="6"></rect>
            <path d="M27 12h10M29 51h6"></path>
            <path d="M24 21h16M24 43h16"></path>
          </svg>
        </div>
        <p class="mobile-block-brand">WORM OS</p>
        <h1 id="mobile-block-title">Mobile installer only</h1>
        <p>This Worm OS installer can only be used from a supported Android device with a Chromium-based browser and WebUSB.</p>
        <p>Desktop browsers are not supported.</p>
        <p>Open worm.estixari.com on an Android device.</p>
        ${result.reason ? `<p class="mobile-block-reason">${result.reason}</p>` : ''}
      </section>
    </main>
  `;
};
