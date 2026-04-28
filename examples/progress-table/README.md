# progress-table

A multi-row progress dashboard with per-task progress bars and color-coded
status.

## Run

```bash
pnpm --filter @tercli-examples/progress-table dev
```

## What it shows

- A **container row per task**, each with `flexDirection: 'row'` and
  `height: 1`.
- Fixed-width name column (`width: 22`), fixed-width bar (`width: 20`,
  via the bar string itself), fixed-width pct column (`width: 4`),
  and a flex status column to fill the rest.
- **`gap: { column: 2 }`** for breathing room between columns.
- Per-task status drives the bar color: green (done), yellow
  (running), gray (pending), red (failed).
- Padded numeric % with `.padStart(3)` so single- and triple-digit
  values right-align.
