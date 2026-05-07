import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Box, Text } from './components.js';
import { useFocus } from './focus.js';
import { useScrollIntoFocus } from './scroll-context.js';
import { ScrollView } from './scroll-view.js';
import type { ScrollViewHandle } from './scroll-view.js';
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

describe('<ScrollView> — imperative ref API', () => {
  it('scrollTo jumps to the given offset', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    expect(api).not.toBeNull();
    api!.scrollTo(1);
    handle.flush?.();
    const out = handle.lastWrite();
    expect(out).toContain('row1');
    expect(out).toContain('row2');
    handle.unmount();
  });

  it('scrollTo clamps to [0, contentSize - viewportSize]', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    api!.scrollTo(999);
    expect(api!.getScrollOffset()).toBe(1);
    api!.scrollTo(-5);
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });

  it('scrollToEnd / scrollToStart move to the bounds', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    api!.scrollToEnd();
    expect(api!.getScrollOffset()).toBe(2);
    api!.scrollToStart();
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });

  it('scrollBy adds the delta', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    api!.scrollBy(1);
    expect(api!.getScrollOffset()).toBe(1);
    api!.scrollBy(1);
    expect(api!.getScrollOffset()).toBe(2);
    api!.scrollBy(99);
    expect(api!.getScrollOffset()).toBe(2);
    // Lower-bound clamp: scrollBy with a large negative delta from a scrolled
    // position must not go below 0.
    api!.scrollBy(-999);
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });
});

describe('<ScrollView> — built-in keys', () => {
  it('arrow Down advances by 1 line when focused', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    handle.pressKey('down');
    expect(api!.getScrollOffset()).toBe(1);
    handle.unmount();
  });

  it('PgDn advances by viewport - 1', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={3} ref={ref}>
          <Text>row0</Text><Text>row1</Text><Text>row2</Text>
          <Text>row3</Text><Text>row4</Text><Text>row5</Text>
          <Text>row6</Text><Text>row7</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 8 });
    handle.pressKey('pageDown');
    expect(api!.getScrollOffset()).toBe(2); // viewport=3, step=2
    handle.unmount();
  });

  it('Home / End jump to bounds', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text><Text>row1</Text><Text>row2</Text><Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    handle.pressKey('end');
    expect(api!.getScrollOffset()).toBe(2);
    handle.pressKey('home');
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });

  it('scrollEnabled={false} disables built-in keys', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} scrollEnabled={false} ref={ref}>
          <Text>row0</Text><Text>row1</Text><Text>row2</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    handle.pressKey('down');
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });
});

describe('<ScrollView> — stickToBottom', () => {
  it('appending content auto-scrolls to end', () => {
    let setItems: ((n: number) => void) | null = null;
    function App() {
      const [n, set] = useState(3);
      setItems = set;
      const items = [];
      for (let i = 0; i < n; i++) items.push(<Text key={i}>{`row${i}`}</Text>);
      return (
        <ScrollView height={2} stickToBottom>
          {items}
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    setItems!(8);
    handle.flush?.();
    const out = handle.lastWrite();
    expect(out).toContain('row6');
    expect(out).toContain('row7');
    expect(out).not.toContain('row0');
    handle.unmount();
  });

  it('after user scrolls away, append does NOT auto-scroll', () => {
    let setItems: ((n: number) => void) | null = null;
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      const [n, set] = useState(8);
      setItems = set;
      const items = [];
      for (let i = 0; i < n; i++) items.push(<Text key={i}>{`row${i}`}</Text>);
      return (
        <ScrollView height={2} stickToBottom ref={ref}>
          {items}
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    api!.scrollToStart();
    setItems!(12);
    handle.flush?.();
    const out = handle.lastWrite();
    expect(out).toContain('row0');
    expect(out).not.toContain('row11');
    handle.unmount();
  });
});

describe('<ScrollView> — scrollOnFocus / scrollIntoView via useScrollIntoFocus', () => {
  it('focusing a descendant outside the viewport auto-scrolls to make it visible', () => {
    let api: ScrollViewHandle | null = null;
    let focusRow3: (() => void) | null = null;
    function Item({ id, index }: { id: string; index: number }) {
      const boxRef = useRef(null);
      const f = useFocus({ id });
      useScrollIntoFocus(f.isFocused, boxRef);
      if (id === 'row3') focusRow3 = f.focus;
      return (
        <Box ref={boxRef}>
          <Text>{id}</Text>
        </Box>
      );
    }
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Item id="row0" index={0} />
          <Item id="row1" index={1} />
          <Item id="row2" index={2} />
          <Item id="row3" index={3} />
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    expect(api!.getScrollOffset()).toBe(0);
    focusRow3!();
    handle.flush?.();
    // row3 is at index 3, viewport is 2 rows → must scroll to offset at least 2
    expect(api!.getScrollOffset()).toBeGreaterThanOrEqual(2);
    handle.unmount();
  });

  it('scrollOnFocus={false} disables auto-scroll', () => {
    let api: ScrollViewHandle | null = null;
    let focusRow3: (() => void) | null = null;
    function Item({ id }: { id: string }) {
      const boxRef = useRef(null);
      const f = useFocus({ id });
      useScrollIntoFocus(f.isFocused, boxRef);
      if (id === 'row3') focusRow3 = f.focus;
      return (
        <Box ref={boxRef}>
          <Text>{id}</Text>
        </Box>
      );
    }
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} scrollOnFocus={false} ref={ref}>
          <Item id="row0" /><Item id="row1" />
          <Item id="row2" /><Item id="row3" />
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    focusRow3!();
    handle.flush?.();
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });
});
