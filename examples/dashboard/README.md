# dashboard

A system-monitor-style layout: status header, four stat tiles in a row,
metrics strip at the bottom.

## Run

```bash
pnpm --filter @pilates-examples/dashboard dev
```

## What it shows

- **`justifyContent: 'space-between'`** in the header pushes the status
  badge to the left and the uptime to the right.
- **`alignItems: 'center'`** vertically centers content in the header.
- **`gap: { column: 2 }`** between tiles for clean separation without
  manual margins.
- **`justifyContent: 'space-around'`** in the metrics strip distributes
  values with equal breathing room on both ends and between items.
- Mixed tile colors (`green`, `cyan`, `magenta`) under one rounded
  border per tile.
