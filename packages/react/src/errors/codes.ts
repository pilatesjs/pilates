/**
 * Stable string IDs for every error case PilatesError can carry. Public API
 * (per the SemVer policy in the design doc): renaming a code is a breaking
 * change. New codes can be added in any minor.
 *
 * Authored as an `as const` object so we get both a runtime value (for JS
 * consumers and equality checks) and a derived string-literal type.
 */
export const PilatesErrorCode = {
  // Hooks
  HookOutsideRender: 'PILATES_HOOK_OUTSIDE_RENDER',
  // Focus
  FocusOutsideProvider: 'PILATES_FOCUS_OUTSIDE_PROVIDER',
  DuplicateFocusId: 'PILATES_DUPLICATE_FOCUS_ID',
  FocusIdNotFound: 'PILATES_FOCUS_ID_NOT_FOUND',
  FocusInputBridgeOutsideProvider: 'PILATES_FOCUS_INPUT_BRIDGE_OUTSIDE_PROVIDER',
  // Host config
  UnknownHostType: 'PILATES_UNKNOWN_HOST_TYPE',
  BareStringAtRoot: 'PILATES_BARE_STRING_AT_ROOT',
  BareStringInBox: 'PILATES_BARE_STRING_IN_BOX',
  StringFragmentInvariant: 'PILATES_STRING_FRAGMENT_INVARIANT',
  // Text flatten
  InvalidTextChild: 'PILATES_INVALID_TEXT_CHILD',
  // Widgets
  TextInputBadProp: 'PILATES_TEXTINPUT_BAD_PROP',
} as const;

export type PilatesErrorCode = (typeof PilatesErrorCode)[keyof typeof PilatesErrorCode];

/**
 * Dev-only explanatory hints, keyed by code. The table is `{}` in production
 * builds; bundlers tree-shake the literal object away when `NODE_ENV` is
 * `'production'`. Adding a code without a hint is non-breaking — the hint
 * field on the error simply stays `undefined`.
 */
export const PILATES_ERROR_HINTS: Partial<Record<PilatesErrorCode, string>> =
  process.env.NODE_ENV !== 'production'
    ? {
        [PilatesErrorCode.HookOutsideRender]:
          'Pilates hooks must be called from a component rendered by render() from @pilates/react. Move the call into a child of <render>, or wrap your tree at the top level.',
        [PilatesErrorCode.FocusOutsideProvider]:
          'useFocus() must be called inside a tree wrapped by <FocusProvider>. The render() helper wires this for you unless you opted out via { focus: false }.',
        [PilatesErrorCode.DuplicateFocusId]:
          'Two components called useFocus({ id }) with the same id at the same time. Focus ids must be unique within a Pilates app — check that you are not rendering the same component twice with a static id.',
        [PilatesErrorCode.FocusIdNotFound]:
          'useFocusManager().focus(id) was called with an id that no <useFocus> in the current tree has registered. Check that the focusable is mounted and uses the same id (case-sensitive).',
        [PilatesErrorCode.FocusInputBridgeOutsideProvider]:
          'FocusInputBridge is an internal Pilates component; it should never appear outside <FocusProvider>. If you are seeing this, it likely indicates a corrupted Pilates install.',
        [PilatesErrorCode.UnknownHostType]:
          'Pilates only knows the host elements provided by @pilates/react. If you copy-pasted JSX from a React DOM app, replace HTML tags: <div> → <Box>, <p>/<span> → <Text>. If you typed lowercase, try the capitalized component name.',
        [PilatesErrorCode.BareStringAtRoot]:
          'Wrap raw strings in <Text>: <Text>hello</Text>. Strings at the root have no styling context and would not render.',
        [PilatesErrorCode.BareStringInBox]:
          '<Box> is a layout container; it cannot render text directly. Wrap the string in <Text>: <Box><Text>hello</Text></Box>.',
        [PilatesErrorCode.StringFragmentInvariant]:
          'A Pilates internal invariant about string-fragment placement was violated. This typically indicates a Pilates bug rather than a user error — please file an issue with a reproducing example.',
        [PilatesErrorCode.InvalidTextChild]:
          '<Text> only accepts strings, numbers, and other <Text> as children. To render a non-string value, convert it explicitly: {String(x)} or {x.toString()}.',
        [PilatesErrorCode.TextInputBadProp]:
          '<TextInput> received a prop value that does not match its contract. See message for the specific prop and reason.',
      }
    : {};
