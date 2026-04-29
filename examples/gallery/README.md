# gallery

A grid of cards that wraps to multiple rows when the container is too
narrow to fit them all on one line.

## Run

```bash
pnpm --filter @pilates-examples/gallery dev
```

## What it shows

- **`flexWrap: 'wrap'`** lets items spill to new lines when they
  overflow the row.
- **`alignContent: 'flex-start'`** stacks the wrapped lines from the top
  rather than stretching them to fill the container's cross axis.
- **Per-card `borderColor` and `titleColor`** using the same color value
  for matching border/title styling on each item.
- **`gap: { row: 0, column: 2 }`** — independent row vs column gap; here
  no vertical gap between wrapped lines but 2 cells horizontal between
  cards.
- Wide-char-aware titles using box-drawing symbols (★, ✦, ☀, ⚡, etc.).
