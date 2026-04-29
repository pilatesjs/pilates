# split-pane

Editor-style layout: title bar at the top, three vertical panes for files /
editor / outline in the body, and a status strip at the bottom.

## Run

```bash
pnpm --filter @pilates-examples/split-pane dev
```

## What it shows

- **Nested `flexDirection`**: outer column for header / body / footer; inner
  row for the three body panes.
- **Fixed sizes** on header (`height: 3`), footer (`height: 1`), file panel
  (`width: 20`), outline panel (`width: 18`); editor takes the rest with
  `flex: 1`.
- Mixed border styles: rounded for the editor (the focused pane), single
  for the others.
- The status bar uses `bgColor: 'blue'` + `bold` for the inverse-style
  badge, plus `color: 'gray'` for the dim metadata on the right.
