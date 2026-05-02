/**
 * Smoke test for examples/react-dashboard.
 *
 * The dashboard renders a header with status, a tile grid (CPU / Memory /
 * Disk / Network), and a footer of metrics. Confirms the full render path
 * (useStdout + useApp + multiple Box / Text nodes) doesn't throw and
 * produces the expected static labels.
 */

import { mountWithInput } from '@pilates/react/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../examples/react-dashboard/index.js';
import { strip } from './helpers.js';

describe('react-dashboard smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders header, tiles, and footer metrics', () => {
    const h = mountWithInput(0, () => <App />, { width: 80, height: 24 });

    const out = strip(h.lastWrite());
    expect(out).toMatch(/Pilates Dashboard/);
    expect(out).toMatch(/CPU/);
    expect(out).toMatch(/Memory/);
    expect(out).toMatch(/Disk/);
    expect(out).toMatch(/Network/);
    expect(out).toMatch(/read \d+\/s/);

    h.unmount();
  });
});
