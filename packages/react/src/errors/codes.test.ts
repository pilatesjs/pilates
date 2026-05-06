import { describe, expect, it } from 'vitest';
import {
  PILATES_ERROR_HINTS,
  PilatesErrorCode,
  type PilatesErrorCode as PilatesErrorCodeType,
} from './codes.js';

describe('PilatesErrorCode', () => {
  it("exports a const object with at least the spec's codes", () => {
    expect(PilatesErrorCode.HookOutsideRender).toBe('PILATES_HOOK_OUTSIDE_RENDER');
    expect(PilatesErrorCode.UnknownHostType).toBe('PILATES_UNKNOWN_HOST_TYPE');
    expect(PilatesErrorCode.BareStringAtRoot).toBe('PILATES_BARE_STRING_AT_ROOT');
    expect(PilatesErrorCode.BareStringInBox).toBe('PILATES_BARE_STRING_IN_BOX');
    expect(PilatesErrorCode.StringFragmentInvariant).toBe('PILATES_STRING_FRAGMENT_INVARIANT');
    expect(PilatesErrorCode.InvalidTextChild).toBe('PILATES_INVALID_TEXT_CHILD');
    expect(PilatesErrorCode.FocusOutsideProvider).toBe('PILATES_FOCUS_OUTSIDE_PROVIDER');
    expect(PilatesErrorCode.DuplicateFocusId).toBe('PILATES_DUPLICATE_FOCUS_ID');
    expect(PilatesErrorCode.FocusInputBridgeOutsideProvider).toBe(
      'PILATES_FOCUS_INPUT_BRIDGE_OUTSIDE_PROVIDER',
    );
    expect(PilatesErrorCode.TextInputBadProp).toBe('PILATES_TEXTINPUT_BAD_PROP');
  });

  it('every value is unique', () => {
    const values = Object.values(PilatesErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('every value starts with PILATES_', () => {
    for (const v of Object.values(PilatesErrorCode)) {
      expect(v.startsWith('PILATES_')).toBe(true);
    }
  });

  it('the type derives from the const object', () => {
    const code: PilatesErrorCodeType = PilatesErrorCode.HookOutsideRender;
    expect(code).toBe('PILATES_HOOK_OUTSIDE_RENDER');
  });
});

describe('PILATES_ERROR_HINTS — dev-only table', () => {
  it('precondition: NODE_ENV is not production (so the hint table is populated)', () => {
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('contains a non-empty hint for at least each code that has one in the spec', () => {
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.HookOutsideRender]).toMatch(/render/i);
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.UnknownHostType]).toMatch(/host/i);
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.BareStringAtRoot]).toMatch(/Text/);
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.BareStringInBox]).toMatch(/Text/);
  });

  it('every hint is non-empty if defined', () => {
    for (const v of Object.values(PILATES_ERROR_HINTS)) {
      if (v !== undefined) expect(v.length).toBeGreaterThan(0);
    }
  });
});
