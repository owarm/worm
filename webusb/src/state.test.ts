import { beforeEach, describe, expect, it } from 'vitest';
import { __resetStateForTests, canTransition, getState, setProgress, transitionInstallerState } from './state';
import { InstallerStateError } from './types';

describe('installer state', () => {
  beforeEach(() => {
    __resetStateForTests();
  });

  it('clamps progress to the valid percentage range', () => {
    setProgress(140);
    expect(getState().progress).toBe(100);

    setProgress(-10);
    expect(getState().progress).toBe(0);
  });

  it('allows legal state transition', () => {
    transitionInstallerState('CONNECTING');
    transitionInstallerState('CONNECTED');
    expect(getState().installerState).toBe('CONNECTED');
    expect(canTransition('CONNECTED', 'DEVICE_VERIFIED')).toBe(true);
  });

  it('allows VERIFIED to transition directly to FLASHING', () => {
    transitionInstallerState('DOWNLOADING');
    transitionInstallerState('DOWNLOADED');
    transitionInstallerState('VERIFYING');
    transitionInstallerState('VERIFIED');

    expect(canTransition('DOWNLOADED', 'VERIFYING')).toBe(true);
    expect(canTransition('VERIFYING', 'VERIFIED')).toBe(true);
    expect(canTransition('VERIFIED', 'FLASHING')).toBe(true);
    transitionInstallerState('FLASHING');
    expect(getState().installerState).toBe('FLASHING');
  });

  it('rejects illegal state transition', () => {
    expect(() => transitionInstallerState('FLASHING')).toThrow(InstallerStateError);
    expect(getState().installerState).toBe('ERROR');
  });
});
