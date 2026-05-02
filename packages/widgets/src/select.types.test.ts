/**
 * Type-level tests for the Select<T> generic. Runtime is a no-op; the
 * assertions are compile-time. Removing the generic or widening the
 * onSelect parameter should fail `pnpm typecheck`.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { Select, SelectItem, SelectProps } from './select.js';

describe('Select<T> generic propagation', () => {
  it('SelectItem<T> preserves T in value', () => {
    type Size = 'sm' | 'md' | 'lg';
    expectTypeOf<SelectItem<Size>['value']>().toEqualTypeOf<Size>();
  });

  it('SelectProps<T> threads T through items and onSelect', () => {
    type Size = 'sm' | 'md' | 'lg';
    expectTypeOf<SelectProps<Size>['items']>().toEqualTypeOf<SelectItem<Size>[]>();
    expectTypeOf<SelectProps<Size>['onSelect']>().toEqualTypeOf<(item: SelectItem<Size>) => void>();
  });

  it('Select component accepts a typed items array', () => {
    type Size = 'sm' | 'md' | 'lg';
    type SizeProps = React.ComponentProps<typeof Select<Size>>;
    expectTypeOf<SizeProps['items']>().toEqualTypeOf<SelectItem<Size>[]>();
  });

  it('disabled and key are optional on SelectItem', () => {
    expectTypeOf<SelectItem<string>['disabled']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<SelectItem<string>['key']>().toEqualTypeOf<string | undefined>();
  });
});
