import { afterEach, describe, expect, it, vi } from 'vitest';
import { __authTest, logout, renderAuthScreen, requestAuthCode } from './auth';

type Listener = (event?: { preventDefault: () => void }) => void;

class FakeElement {
  value = '';
  disabled = false;
  private readonly listeners = new Map<string, Listener>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  trigger(type: string): void {
    this.listeners.get(type)?.({ preventDefault: vi.fn() });
  }
}

class FakeRoot {
  private html = '';
  private elements = new Map<string, FakeElement>();

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    this.elements = new Map();
    if (value.includes('auth-email-form')) {
      this.elements.set('#auth-email-form', new FakeElement());
      this.elements.set('#auth-email', new FakeElement());
    }
    if (value.includes('auth-code-form')) {
      this.elements.set('#auth-code-form', new FakeElement());
      this.elements.set('#auth-code', new FakeElement());
      this.elements.set('#auth-resend', new FakeElement());
      this.elements.set('#auth-code-form button[type="submit"]', new FakeElement());
    }
  }

  querySelector<T>(selector: string): T | null {
    return (this.elements.get(selector) as T | undefined) ?? null;
  }

  element(selector: string): FakeElement {
    const element = this.elements.get(selector);
    if (!element) {
      throw new Error(`Missing fake element ${selector}`);
    }
    return element;
  }
}

const okResponse = (status = 200) => ({ ok: status >= 200 && status < 300, status }) as Response;
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('WebUSB OTP auth frontend', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Send code calls /auth/request-code with a generic UI response', async () => {
    const fetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetch);
    const root = new FakeRoot();

    renderAuthScreen(root as unknown as HTMLElement, { onAuthenticated: vi.fn() });
    root.element('#auth-email').value = 'owner@example.test';
    root.element('#auth-email-form').trigger('submit');
    await flush();

    expect(fetch).toHaveBeenCalledWith('/auth/request-code', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ email: 'owner@example.test' })
    }));
    expect(root.innerHTML).toContain('Verification code');
    expect(root.innerHTML).toContain('Send new code in 60s');
    expect(root.innerHTML).not.toContain('authorized email');
  });

  it('normalizes and verifies a six digit OTP code, then initializes after /auth/check', async () => {
    const onAuthenticated = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetch);
    const root = new FakeRoot();

    renderAuthScreen(root as unknown as HTMLElement, { onAuthenticated });
    root.element('#auth-email').value = 'owner@example.test';
    root.element('#auth-email-form').trigger('submit');
    await flush();
    root.element('#auth-code').value = ' 123 456 ';
    root.element('#auth-code').trigger('input');
    root.element('#auth-code-form').trigger('submit');
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));

    expect(fetch).toHaveBeenCalledWith('/auth/verify-code', expect.objectContaining({
      body: JSON.stringify({ email: 'owner@example.test', code: '123456' })
    }));
    expect(fetch).toHaveBeenCalledWith('/auth/check', { credentials: 'same-origin' });
  });

  it('invalid code stays on login and does not enter installer error state', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(okResponse()).mockResolvedValueOnce(okResponse(401));
    vi.stubGlobal('fetch', fetch);
    const root = new FakeRoot();

    renderAuthScreen(root as unknown as HTMLElement, { onAuthenticated: vi.fn() });
    root.element('#auth-email').value = 'owner@example.test';
    root.element('#auth-email-form').trigger('submit');
    await flush();
    root.element('#auth-code').value = '123456';
    root.element('#auth-code').trigger('input');
    root.element('#auth-code-form').trigger('submit');
    await flush();

    expect(root.innerHTML).toContain('Invalid or expired verification code.');
    expect(root.innerHTML).toContain('Verification code');
    expect(root.innerHTML).not.toContain('Installation needs attention');
  });

  it('does not put OTP in localStorage or logs', async () => {
    const fetch = vi.fn().mockResolvedValue(okResponse());
    const localStorage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', localStorage);
    const root = new FakeRoot();

    renderAuthScreen(root as unknown as HTMLElement, { onAuthenticated: vi.fn() });
    root.element('#auth-email').value = 'owner@example.test';
    root.element('#auth-email-form').trigger('submit');
    await flush();
    root.element('#auth-code').value = '123456';
    root.element('#auth-code').trigger('input');

    expect(JSON.stringify(localStorage.setItem.mock.calls)).not.toContain('123456');
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain('123456');
  });

  it('logout posts to /auth/logout', async () => {
    const fetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetch);

    await logout();

    expect(fetch).toHaveBeenCalledWith('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
  });

  it('resend cooldown counts down for 60 seconds in UI', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetch);
    const root = new FakeRoot();

    renderAuthScreen(root as unknown as HTMLElement, { onAuthenticated: vi.fn() });
    root.element('#auth-email').value = 'owner@example.test';
    root.element('#auth-email-form').trigger('submit');
    await flush();

    expect(root.innerHTML).toContain('Send new code in 60s');
    vi.advanceTimersByTime(1000);
    expect(root.innerHTML).toContain('Send new code in 59s');
  });

  it('requires exactly six digits after OTP normalization', () => {
    expect(__authTest.normalizeCode(' 12 34 56 ')).toBe('123456');
    expect(__authTest.normalizeCode('12a345678')).toBe('123456');
    expect(__authTest.normalizeCode('12345')).not.toHaveLength(6);
  });

  it('reports auth service network errors without stack traces', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(requestAuthCode('owner@example.test')).rejects.toThrow('Authentication service unavailable.');
  });
});
