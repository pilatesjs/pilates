# @pilates/widgets

Interactive widgets for [Pilates](https://github.com/pilatesjs/pilates) terminal UIs:

- **`<TextInput>`** — single-line text input with cursor, password mask, placeholder
- **`<Select>`** — single-select menu with keyboard navigation
- **`<Spinner>`** — animated progress indicator with built-in frame catalog

Built on [`@pilates/react`](https://www.npmjs.com/package/@pilates/react). **Zero runtime dependencies.**

## Install

```sh
npm install @pilates/widgets @pilates/react react
```

## Quick example

```tsx
import { render, Box, Text } from '@pilates/react';
import { TextInput, Select, Spinner } from '@pilates/widgets';
import { useState } from 'react';

function Wizard() {
  const [name, setName] = useState('');
  const [size, setSize] = useState<'sm' | 'md' | 'lg' | null>(null);

  if (!name) {
    return (
      <Box flexDirection="column">
        <Text>What's your name?</Text>
        <TextInput value={name} onChange={setName} onSubmit={(v) => setName(v)} />
      </Box>
    );
  }

  if (!size) {
    return (
      <Box flexDirection="column">
        <Text>Hi {name}. Pick a size:</Text>
        <Select
          items={[
            { label: 'Small', value: 'sm' as const },
            { label: 'Medium', value: 'md' as const },
            { label: 'Large', value: 'lg' as const },
          ]}
          onSelect={(item) => setSize(item.value)}
        />
      </Box>
    );
  }

  return <Text>Done — {name}, {size}.</Text>;
}

render(<Wizard />);
```

## `<TextInput>`

```tsx
<TextInput
  value={value}                    // required, controlled
  onChange={setValue}              // required
  onSubmit={(v) => ...}            // optional, fires on Enter
  placeholder="Type something"     // optional
  mask="*"                         // optional, for passwords (single character)
  focus={true}                     // optional, default true
/>
```

**Key bindings:** printable chars insert at cursor; `←`/`→` move; `Home`/`End` (or `Ctrl+A`/`Ctrl+E`) jump; `Backspace`/`Delete` delete; `Ctrl+U`/`Ctrl+K` clear to start/end; `Ctrl+W` delete previous word; `Enter` calls `onSubmit`.

## `<Select>`

```tsx
<Select
  items={[
    { label: 'Apple', value: 'apple' },
    { label: 'Banana', value: 'banana' },
    { label: 'Disabled', value: 'd', disabled: true },
  ]}
  onSelect={(item) => ...}         // required, fires on Enter
  onHighlight={(item) => ...}      // optional, fires on cursor move
  initialIndex={0}                 // optional, default 0
  focus={true}                     // optional, default true
  indicator={...}                  // optional, custom marker function
/>
```

**Key bindings:** `↑`/`↓` move (skipping disabled, with wrap-around); `Home`/`End` jump to first/last enabled item; `Enter` calls `onSelect` (no-op if disabled).

## `<Spinner>`

```tsx
<Spinner type="dots" />              // built-in frame set
<Spinner frames={['◐','◓','◑','◒']} interval={120} />  // custom
```

**Built-in types:** `dots`, `line`, `arrow`, `bouncingBar`, `bouncingBall`. Default interval is 80 ms.

## Composing focus

Widgets don't have a focus-management context. To wire mutual exclusion between widgets, gate each one's `focus` prop with parent state:

```tsx
const [active, setActive] = useState<'name' | 'size'>('name');

<TextInput value={name} onChange={setName} focus={active === 'name'} />
<Select items={sizes} onSelect={...} focus={active === 'size'} />
```

(A real `useFocus` may land in `@pilates/react` later if demand surfaces.)

## License

MIT — see [LICENSE](https://github.com/pilatesjs/pilates/blob/main/LICENSE).
