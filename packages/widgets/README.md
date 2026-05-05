# @pilates/widgets

Interactive widgets for [Pilates](https://github.com/pilatesjs/pilates) terminal UIs:

- **`<TextInput>`** — single-line text input with cursor, password mask, placeholder
- **`<TextArea>`** — multi-line text editor with grapheme-aware cursor, paste preserves newlines
- **`<Select>`** — single-select menu with keyboard navigation
- **`<MultiSelect>`** — multi-select checklist; Space toggles, Enter submits the selection
- **`<Tabs>`** — horizontal tab strip; arrow keys cycle through, controlled by activeKey
- **`<Table>`** — fixed-column tabular display with header, divider, alignment, ellipsis truncation
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

## `<MultiSelect>`

```tsx
<MultiSelect
  items={[
    { label: 'Apple', value: 'apple' },
    { label: 'Banana', value: 'banana' },
    { label: 'Cherry', value: 'cherry' },
  ]}
  selectedKeys={selected}             // Set<string>, controlled
  onChange={setSelected}              // (next: Set<string>) => void — fires on Space toggle
  onSubmit={(items) => ...}           // optional, fires on Enter, receives selected items
  onHighlight={(item) => ...}         // optional
  initialIndex={0}                    // optional
  focus={true}                        // optional, default true (ignored when focusId is set)
  focusId="checks"                    // optional — Tab cycling via useFocus
  autoFocus                           // optional — paired with focusId
  indicator={...}                     // optional, custom marker per row
/>
```

**Key bindings:** `↑`/`↓` move highlight (skip disabled, wrap-around); `Home`/`End` jump to first/last enabled; `Space` toggles the highlighted item's selection; `Enter` calls `onSubmit(selectedItems)`. The selection set is keyed by `item.key ?? String(item.value)`, and the array passed to `onSubmit` is ordered to match `items`.

## `<Tabs>`

Horizontal tab strip. Renders only the strip itself — the panel body is wired
by the consumer based on `activeKey`.

```tsx
<Tabs
  items={[
    { key: 'overview', label: 'Overview' },
    { key: 'logs', label: 'Logs' },
    { key: 'settings', label: 'Settings', disabled: true },
  ]}
  activeKey={active}                  // controlled
  onChange={setActive}                // (key: string) => void
  focus={true}                        // optional, default true (ignored when focusId is set)
  focusId="primary-tabs"              // optional — Tab cycling via useFocus
  autoFocus                           // optional — paired with focusId
/>

{active === 'overview' && <OverviewPanel />}
{active === 'logs'     && <LogsPanel />}
```

**Visual:** active tab renders as `[Label]` in cyan + bold; inactive tabs render as ` Label `; disabled tabs render dim. Tabs are separated by a single space.

**Key bindings:** `←`/`→` cycle the active tab (skip disabled, wrap-around); `Home`/`End` jump to the first / last enabled tab. Activation is immediate — no separate highlight + commit step like `<Select>`. If `activeKey` matches no item (e.g., consumer passed a stale key), the next arrow press jumps to the first / last enabled tab.

## `<Table>`

Tabular data display: bold headers, a horizontal divider, then one row per record.

```tsx
<Table
  columns={[
    { key: 'name', header: 'Name', width: 20 },
    { key: 'age',  header: 'Age',  width: 4, align: 'right' },
    { key: 'role', header: 'Role', width: 16,
      render: (val, row) => `${val} (${row.team})` },
  ]}
  rows={people}
/>
```

Each column declares:

| Field | Notes |
|---|---|
| `key` | Property of the row used to look up this column's raw value. |
| `header` | Bold text in the top row. |
| `width?` | Cells. When omitted, the column flexes — 16-cell fallback in v1; a parent `<Box width=…>` constrains the visible area. |
| `align?` | `'left'` (default), `'right'`, or `'center'`. |
| `render?` | `(value, row) => string`. Receives the raw value and the full row; returns the cell's displayed text. Plain strings only in v1 — Table pads / truncates the result. |

**Layout:** values longer than the column width are truncated to `width − 1` cells with a trailing `…`. Wide-character values (CJK, emoji) are measured via `stringWidth` from `@pilates/core` so truncation never overshoots a wide grapheme.

**Out of v1:** vertical separators between columns, multi-line cells (wrap), per-row selection / highlight, sorting / filtering. Wrap selection-friendly variants in your own component or wait for a future `<DataTable>`.

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
