import { describe, expect, it } from 'vitest';
import { Text } from './components.js';
import { ScrollView } from './scroll-view.js';
import { mountWithInput } from './test-utils.js';

describe('<ScrollView> — basic clipping', () => {
  it('renders a viewport that clips content beyond `height`', () => {
    const handle = mountWithInput(
      0,
      () => (
        <ScrollView height={2}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      ),
      { width: 20, height: 5 },
    );
    const out = handle.lastWrite();
    expect(out).toContain('row0');
    expect(out).toContain('row1');
    expect(out).not.toContain('row2');
    expect(out).not.toContain('row3');
    handle.unmount();
  });
});
