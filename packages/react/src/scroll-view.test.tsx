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

describe('<ScrollView> — scroll state', () => {
  it('controlled: when scrollOffset prop is set, content is offset by that amount', () => {
    const handle = mountWithInput(
      0,
      () => (
        <ScrollView height={2} scrollOffset={2}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      ),
      { width: 20, height: 5 },
    );
    const out = handle.lastWrite();
    expect(out).toContain('row2');
    expect(out).toContain('row3');
    expect(out).not.toContain('row0');
    expect(out).not.toContain('row1');
    handle.unmount();
  });

  it('uncontrolled: defaultScrollOffset sets the initial position', () => {
    const handle = mountWithInput(
      0,
      () => (
        <ScrollView height={2} defaultScrollOffset={1}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
        </ScrollView>
      ),
      { width: 20, height: 5 },
    );
    const out = handle.lastWrite();
    expect(out).not.toContain('row0');
    expect(out).toContain('row1');
    expect(out).toContain('row2');
    handle.unmount();
  });
});
