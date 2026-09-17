type AuthState = 'email' | 'code';
type AuthCheckStatus = 'authenticated' | 'unauthenticated' | 'unavailable';

type RenderAuthOptions = {
  initialError?: string;
  onAuthenticated: () => void | Promise<void>;
};

const AUTH_UNAVAILABLE = 'Authentication service unavailable.';
const INVALID_CODE = 'Invalid or expired verification code.';
const GENERIC_CODE_MESSAGE = 'A verification code will be sent if the address is authorized.';

export const getAuthStatus = async (): Promise<AuthCheckStatus> => {
  try {
    const response = await fetch('/auth/check', {
      credentials: 'same-origin'
    });
    if (response.status === 200) return 'authenticated';
    if (response.status === 401) return 'unauthenticated';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
};

export const checkAuth = async (): Promise<boolean> => (await getAuthStatus()) === 'authenticated';

export const requestAuthCode = async (email: string): Promise<void> => {
  let response: Response;
  try {
    response = await fetch('/auth/request-code', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
  } catch {
    throw new Error(AUTH_UNAVAILABLE);
  }

  if (!response.ok && response.status >= 500) {
    throw new Error(AUTH_UNAVAILABLE);
  }
};

export const verifyAuthCode = async (email: string, code: string): Promise<boolean> => {
  try {
    const response = await fetch('/auth/verify-code', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, code })
    });
    return response.ok;
  } catch {
    throw new Error(AUTH_UNAVAILABLE);
  }
};

export const logout = async (): Promise<void> => {
  await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'same-origin'
  });
};

const esc = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const normalizeCode = (value: string): string => value.replace(/\s+/g, '').replace(/\D/g, '').slice(0, 6);

export const renderAuthScreen = (root: HTMLElement, options: RenderAuthOptions): (() => void) => {
  let state: AuthState = 'email';
  let email = '';
  let code = '';
  let message = options.initialError ?? '';
  let busy = false;
  let cooldown = 0;
  let cooldownTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  let disposed = false;

  const stopCooldown = (): void => {
    if (cooldownTimer) {
      globalThis.clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  };

  const startCooldown = (): void => {
    stopCooldown();
    cooldown = 60;
    cooldownTimer = globalThis.setInterval(() => {
      cooldown = Math.max(0, cooldown - 1);
      if (cooldown === 0) {
        stopCooldown();
      }
      render();
    }, 1000);
  };

  const sendCode = async (): Promise<void> => {
    const input = root.querySelector<HTMLInputElement>('#auth-email');
    email = String(input?.value ?? '').trim();
    if (!email || busy) return;

    busy = true;
    message = '';
    render();
    try {
      await requestAuthCode(email);
      code = '';
      state = 'code';
      message = '';
      startCooldown();
    } catch {
      message = AUTH_UNAVAILABLE;
    } finally {
      busy = false;
      render();
    }
  };

  const verifyCode = async (): Promise<void> => {
    const input = root.querySelector<HTMLInputElement>('#auth-code');
    code = normalizeCode(input?.value ?? code);
    if (!/^\d{6}$/.test(code) || busy) return;

    busy = true;
    message = '';
    render();
    try {
      const verified = await verifyAuthCode(email, code);
      if (!verified) {
        message = INVALID_CODE;
        return;
      }
      const authStatus = await getAuthStatus();
      if (authStatus === 'authenticated') {
        stopCooldown();
        await options.onAuthenticated();
        return;
      }
      if (authStatus === 'unavailable') {
        message = AUTH_UNAVAILABLE;
        return;
      }
      message = INVALID_CODE;
    } catch {
      message = AUTH_UNAVAILABLE;
    } finally {
      busy = false;
      if (!disposed) render();
    }
  };

  const render = (): void => {
    if (disposed) return;
    const canVerify = /^\d{6}$/.test(code) && !busy;
    root.innerHTML = `
      <section class="auth-shell" aria-label="WebUSB authentication">
        <div class="auth-card">
          <h1>WebUSB</h1>
          <p class="auth-subtitle">Authentication required</p>
          ${
            state === 'email'
              ? `
                <form id="auth-email-form" class="auth-form">
                  <label for="auth-email">Email</label>
                  <input id="auth-email" name="email" type="email" autocomplete="email" required value="${esc(email)}" />
                  <button type="submit" class="is-primary" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Send code'}</button>
                  <p class="auth-copy">${GENERIC_CODE_MESSAGE}</p>
                </form>
              `
              : `
                <form id="auth-code-form" class="auth-form">
                  <label for="auth-code">Verification code</label>
                  <input id="auth-code" class="otp-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" value="${esc(code)}" />
                  <button type="submit" class="is-primary" ${canVerify ? '' : 'disabled'}>${busy ? 'Verifying...' : 'Verify code'}</button>
                  <button type="button" id="auth-resend" ${busy || cooldown > 0 ? 'disabled' : ''}>${cooldown > 0 ? `Send new code in ${cooldown}s` : 'Send new code'}</button>
                </form>
              `
          }
          <p class="auth-error" aria-live="polite">${esc(message)}</p>
        </div>
      </section>
    `;

    root.querySelector<HTMLFormElement>('#auth-email-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void sendCode();
    });
    root.querySelector<HTMLFormElement>('#auth-code-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void verifyCode();
    });
    root.querySelector<HTMLButtonElement>('#auth-resend')?.addEventListener('click', () => {
      void sendCode();
    });
    const codeInput = root.querySelector<HTMLInputElement>('#auth-code');
    codeInput?.addEventListener('input', () => {
      code = normalizeCode(codeInput.value);
      codeInput.value = code;
      const button = root.querySelector<HTMLButtonElement>('#auth-code-form button[type="submit"]');
      if (button) {
        button.disabled = !/^\d{6}$/.test(code) || busy;
      }
    });
  };

  render();

  return () => {
    disposed = true;
    stopCooldown();
    email = '';
    code = '';
    root.innerHTML = '';
  };
};

export const __authTest = {
  AUTH_UNAVAILABLE,
  INVALID_CODE,
  normalizeCode
};
