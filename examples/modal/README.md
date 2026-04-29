# modal

A confirm-action modal floating over a background list, demonstrating
absolute positioning.

## Run

```bash
pnpm --filter @pilates-examples/modal dev
```

## What it shows

- **`positionType: 'absolute'`** takes the modal out of the normal flex
  flow — the background list lays out as if the modal weren't there.
- **`position: { top, left }`** — anchored to the parent's outer corners
  (Yoga semantics, not CSS's content-edge semantics).
- The modal is centered by computing `(parentSize - modalSize) / 2` and
  passing that as `top`/`left`. No `transform` magic needed.
- The modal itself uses `flexDirection: 'column'` +
  `justifyContent: 'space-between'` to put the title text at the top and
  the action buttons at the bottom of its inner area.
- Action buttons use `flexDirection: 'row'` +
  `justifyContent: 'space-around'` for even horizontal distribution.
- Color-coded danger styling: yellow border for "warning" tone, red bold
  on the destructive action.
