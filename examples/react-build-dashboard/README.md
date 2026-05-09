# Pilates Build Dashboard

The flagship Pilates demo — an interactive build-pipeline dashboard
that exercises everything `@pilates/react` and `@pilates/widgets`
ship together.

```
┌─ Pilates Build Dashboard ──────────────────────────────────────────────┐
│ ● live   running: Build CI pipeline                       tick 142     │
├────────────────────────┬────────────────────────────────────────────────┤
│ Tasks                  │ Pipeline                                       │
│ ▸ Build CI pipeline    │ ✓  lint              ████████████████  100%   │
│   Deploy to staging    │ ✓  typecheck         ████████████████  100%   │
│   Run e2e suite        │ ✓  unit tests        ████████████████  100%   │
│   Update docs site     │ ⠋  integration tests ███████████░░░░░   72%   │
│   Tag release          │ ·  package           ░░░░░░░░░░░░░░░░    0%   │
│   Notify team          │ ·  deploy:staging    ░░░░░░░░░░░░░░░░    0%   │
│   Cleanup artifacts    │                                                │
│                        ├────────────────────────────────────────────────┤
│                        │ Activity                                       │
│                        │ 14:23:08  • integration tests started          │
│                        │ 14:23:04  ✓ unit tests passed                  │
│                        │ 14:23:02  ✓ typecheck passed                   │
│                        │ 14:23:01  ✓ lint passed                        │
│                        │ 14:23:00  • Pilates dashboard ready.           │
└────────────────────────┴────────────────────────────────────────────────┘
  Tab switch pane     ↑↓ navigate     Click select     q quit
```

## What it demonstrates

| Feature | Where |
|---|---|
| Multi-pane flex layout | Header / Tasks / Pipeline / Activity / Footer all driven by `<Box>` flex containers |
| `<ScrollView>` | Tasks list (left pane), Activity log (bottom pane); both scroll independently |
| `useFocus` / `useFocusManager` | Tab cycles between the Tasks and Activity panes; focus ring switches border style + color |
| Mouse | Click any task to select it; mouse wheel scrolls the focused pane |
| Keyboard | `↑↓` navigate the tasks list; `q` / `Q` quits |
| Animation | Live tick (`setInterval` 100ms); `<Spinner>` on the running pipeline step; live progress-bar fill; log entries append in real time |
| `<ProgressBar>` widget | One per pipeline step, color-coded by state |
| `<Spinner>` widget | Used for the actively-running pipeline step |
| `stickToBottom` | Activity log auto-scrolls to keep the latest entry visible until you scroll away |
| Theming via colors | Consistent green/yellow/red/cyan/gray palette across status indicators, progress fills, focus rings |

The simulation is self-driving — no real builds are run. Each task
cycles through six pipeline steps with realistic durations
(800–2400 ms each), then advances to the next task. Loops forever
until you press `q`.

## Run

```bash
pnpm install
pnpm --filter @pilates-examples/react-build-dashboard dev
```

Best in a ~100×30 terminal. Smaller works but the panes get tight.

## Files

- `index.tsx` — single-file example, ~280 lines. Read top-to-bottom
  for the full pattern: state shape, simulation loop, layout, and
  the three pane components.

## Why this is the flagship

The other examples (`chat-log`, `dashboard`, `progress-table`,
`react-modal`, `react-wizard`) each demonstrate one or two
capabilities cleanly. This one stitches them together into a
realistic-looking application: the kind of TUI someone watches for
30 seconds and recognizes as something they could ship.

If you're capturing a screencast or GIF for the README hero, this
is the one to record. See `docs/RECORDING_DEMO.md` at the repo root.
