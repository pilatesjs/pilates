# @pilates/widgets

Interactive widgets for [Pilates](https://github.com/pilatesjs/pilates) terminal UIs:

- **`<TextInput>`** — single-line text input with cursor, password mask, placeholder
- **`<TextArea>`** — multi-line text editor with grapheme-aware cursor, paste preserves newlines
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
  focus={true}                     // optional, default true (ignored when focusId is set)
  focusId="name"                   // optional — Tab cycling via useFocus
  autoFocus                        // optional — paired with focusId
/>
```

**Key bindings:** printable chars insert at cursor; `←`/`→` move; `Home`/`End` (or `Ctrl+A`/`Ctrl+E`) jump; `Backspace`/`Delete` delete; `Ctrl+U`/`Ctrl+K` clear to start/end; `Ctrl+W` delete previous word; `Enter` calls `onSubmit`.

**Paste:** xterm bracketed paste (DEC mode 2004) is consumed via `usePaste` — the entire pasted block inserts at the cursor as a single `onChange` call. Newlines and carriage returns are stripped (single-line input). Emoji / ZWJ clusters in the paste survive intact.

## `<TextArea>`

Multi-line editor. Auto-grows vertically with content (no fixed-height /
scrolling viewport in v1 — wrap the textarea in a `<Box>` to constrain
visually).

```tsx
<TextArea
  value={value}                    // required, controlled (may contain '\n')
  onChange={setValue}              // required
  placeholder="Notes…"             // optional
  focus={true}                     // optional, default true (ignored when focusId is set)
  focusId="notes"                  // optional — Tab cycling via useFocus
  autoFocus                        // optional — paired with focusId
/>
```

**Key bindings:** printable chars insert at cursor; **Enter** inserts a newline; `←`/`→` move across line boundaries; `↑`/`↓` move to prev/next line at the same column (clamped to line length); `Home`/`End` (or `Ctrl+A`/`Ctrl+E`) jump to start/end of the current line; `Backspace` removes the previous grapheme (joins lines when at column 0); `Delete` removes the next grapheme (joins lines when at end-of-line); `Ctrl+U`/`Ctrl+K` clear current line to start/end; `Ctrl+W` deletes the previous word.

**Paste:** preserves newlines verbatim — multi-line clipboard contents land as multiple lines.

**Tab inside the textarea:** `<FocusProvider>` (auto-installed by `render()`) eats Tab for focus cycling. To disable focus cycling and let Tab insert a literal tab character, call `useFocusManager().disableFocus()` while the textarea is focused (or wrap the area in a custom `<FocusProvider autoTab={false}>`).

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
  focus={true}                     // optional, default true (ignored when focusId is set)
  focusId="size"                   // optional — Tab cycling via useFocus
  autoFocus                        // optional — paired with focusId
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

The recommended approach is `focusId` — pair it with `useFocus` /
`useFocusManager` from `@pilates/react`. A `<FocusProvider>` is
auto-installed by `render()`, so Tab cycles through widgets that opt
in by id; no parent-side bookkeeping needed.

```tsx
<TextInput value={name}  onChange={setName}  focusId="name"  autoFocus />
<TextInput value={email} onChange={setEmail} focusId="email" />
<Select items={sizes} onSelect={…} focusId="size" />
```

The boolean `focus` prop still works (back-compat) and is silently
ignored when `focusId` is set.

## License

MIT — see [LICENSE](https://github.com/pilatesjs/pilates/blob/main/LICENSE).
