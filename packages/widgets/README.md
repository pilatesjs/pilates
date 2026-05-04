# @pilates/widgets

Interactive widgets for [Pilates](https://github.com/pilatesjs/pilates) terminal UIs:

- **`<TextInput>`** — single-line text input with cursor, password mask, placeholder
- **`<Select>`** — single-select menu with keyboard navigation
- **`<Spinner>`** — animated progress indicator with built-in frame catalog
- **`<ProgressBar>`** — determinate or indeterminate progress bar with custom colors and characters

Built on [`@pilates/react`](https://www.npmjs.com/package/@pilates/react). **Zero runtime dependencies.**

## Install

```sh
npm install @pilates/widgets @pilates/react react
```

> **Status:** `0.1.0-rc.1` — release candidate baking until ~2026-05-15.
> The trio (`<TextInput>`, `<Select>`, `<Spinner>`) is feature-complete
> for the v0.1 line. `<MultiSelect>` and `<Table>` are deferred to a
> later minor on demand.

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

## `<ProgressBar>`

```tsx
<ProgressBar value={42} total={100} width={20} />          // determinate
<ProgressBar indeterminate width={20} />                   // bouncing scanner
<ProgressBar
  value={3}
  total={10}
  width={20}
  fillChar="="
  emptyChar="-"
  color="cyan"
  trackColor="gray"
/>
```

| Prop | Default | Notes |
|---|---|---|
| `value` | `0` | Current progress. Clamped to `[0, total]`. Ignored if `indeterminate`. |
| `total` | `100` | If `<= 0`, the bar renders fully empty. |
| `width` | `20` | Bar width in terminal cells. |
| `fillChar` | `'█'` | Single grapheme assumed. |
| `emptyChar` | `'░'` | Single grapheme assumed. |
| `color` | — | Color for filled cells. Any `@pilates/react` `Color` (named, `#rrggbb`, or 256-color number). |
| `trackColor` | — | Color for empty cells. |
| `indeterminate` | `false` | When true, animates a bouncing scanner. |
| `interval` | `80` | Indeterminate scanner step interval (ms). |
| `scannerWidth` | `3` | Indeterminate scanner cell width. Clamped to `width`. |

To compose with a label, wrap in a row:

```tsx
<Box flexDirection="row" gap={1}>
  <ProgressBar value={done} total={total} width={20} color="green" />
  <Text>{done}/{total}</Text>
</Box>
```

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
