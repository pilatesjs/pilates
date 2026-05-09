# Recording the README hero demo

The README has a commented-out section between the wordmark and the
intro text expecting `assets/demo.gif`. Once recorded, drop the file
into `assets/` and uncomment the `<p align="center">…<img …></p>`
block in `README.md` (currently lines 17–24).

## Recommended choice

**`examples/react-build-dashboard`** for the README hero. It's the
flagship demo and exercises everything Pilates ships: multi-pane
flex layout, two `<ScrollView>` instances, `useFocus` + keyboard
navigation, mouse click + scroll, `<ProgressBar>` and `<Spinner>`
widgets, and live animation (tick → progress fills + log appends).

The simulation runs forever in a self-driving loop — no user input
required to look interesting. A 5–10 second clip captures one or two
pipeline-step transitions plus the activity log scrolling. That's
the launch artifact.

For a secondary asset (Twitter or static screenshot):

- **`examples/progress-table`** — static one-frame render. Good for
  a small inline image in a tweet or blog body. Captures the render
  quality (color bars, status, box-drawing) without needing motion.
- **`examples/react-wizard`** — interactive React story
  (`<TextInput>` → `<Select>` → `<Spinner>`). Shows you can build
  forms. Worth a second clip if you want to highlight the React
  layer specifically.

## Tools needed

### Windows (recommended path)

[**ScreenToGif**](https://www.screentogif.com/) — single download, free,
open source, region-records any window straight to GIF. Built-in editor
trims dead frames and optimizes file size.

That's it. No CLI tooling, no `agg` toolchain.

### macOS / Linux

```bash
brew install asciinema agg          # macOS
# or:
sudo apt install asciinema           # Linux
cargo install --git https://github.com/asciinema/agg
```

Asciinema records the terminal as a `.cast` file (compact, deterministic,
re-playable); `agg` converts it to GIF.

## Recording — Windows (ScreenToGif)

1. Install ScreenToGif (one-shot installer from the site, or
   `winget install ScreenToGif.ScreenToGif`).
2. Open Windows Terminal (or your terminal of choice). Set:
   - **Dark theme.** Pilates' colors pop on dark backgrounds and wash
     out on light. The default Windows Terminal "Campbell" or
     "One Half Dark" themes work well.
   - **Comfortable size:** ~100 columns × 30 rows fits the
     `react-build-dashboard` panes comfortably without wrap.
   - **Larger font.** Hit `Ctrl + =` a few times so the eventual GIF
     stays readable when scaled to ~720px wide.
3. In ScreenToGif: **Recorder → Region select** → drag a tight
   rectangle around just the terminal output area (no title bar,
   no shell prompt above the example).
4. Click record. Switch focus to the terminal and run:
   ```bash
   pnpm --filter @pilates-examples/react-build-dashboard dev
   ```
5. The example self-drives forever — pipeline steps run, log
   entries append, tasks advance. Record **5–10 seconds** to capture
   one or two pipeline-step transitions plus log scrolling. Press
   `q` in the terminal to exit cleanly, then stop ScreenToGif.
6. ScreenToGif's editor opens. Trim leading/trailing dead frames
   (Edit → Trim → keep only the live segment). Aim for a clip
   under 5 MB; reduce frame count via Edit → Reduce frame count if
   it's too big.
7. **Save → Gif → File**. Name it `assets/demo.gif`, save into the
   repo's `assets/` folder.

## Recording — macOS / Linux (asciinema + agg)

```bash
# 1. Make sure you're on a clean main with no uncommitted noise.
cd /e/Github/tercli
git status

# 2. Build the workspace so the example runs without lag.
pnpm install
pnpm build

# 3. Record.
asciinema rec assets/react-build-dashboard.cast \
  --command "pnpm --filter @pilates-examples/react-build-dashboard dev" \
  --idle-time-limit 1.0

# 4. Convert to GIF. The build-dashboard fits ~100x30; tweak to match.
agg --cols 100 --rows 30 \
    --font-family "JetBrains Mono,Menlo,Monaco,monospace" \
    --speed 1.5 \
    assets/react-build-dashboard.cast \
    assets/demo.gif

# 5. Inspect the result.
open assets/demo.gif    # macOS
# or just open the file in any image viewer
```

## Quality gates before merging

- [ ] GIF is under 5 MB (HN/Twitter handle this fine; bigger and
      embed loaders fail on slow connections).
- [ ] Frame rate is smooth — agg at default settings produces 30 fps;
      bump with `--fps 60` if it looks choppy.
- [ ] Terminal background matches what you want shown — use a dark
      or near-black background; light backgrounds wash out the colors
      Pilates relies on.
- [ ] Width / height match the example's natural output (set
      `process.stdout.columns` / `rows` if you need to force it).
- [ ] Text is readable at the GIF's native size (~720px wide
      typically). If it's too small, render the example with bigger
      text or at fewer columns.

## Uncommenting the README

Once `assets/demo.gif` exists, in `README.md` find:

```markdown
<!-- Demo: once recorded, drop assets/demo.gif into ./assets/ and uncomment.
…
-->
```

Delete the `<!--` and `-->` wrappers around the `<p align="center">`
block. Verify the GIF renders on github.com (push to a temporary
branch, view the README on GitHub, screenshot for HN if needed).

## Twitter / X clip variant

For Twitter, max 6.5 MB and ideally under 30 seconds. Use the same
cast but cut to 10 seconds with:

```bash
agg --cols 100 --rows 30 \
    --speed 2.0 \
    --last-frame-pause 1.0 \
    assets/react-build-dashboard.cast \
    assets/twitter-clip.gif
```

For a "see it run" Twitter post, capture the React wizard separately:

```bash
asciinema rec assets/react-wizard.cast \
  --command "pnpm --filter @pilates-examples/react-wizard dev" \
  --idle-time-limit 0.5

agg --cols 80 --rows 24 \
    --speed 1.2 \
    assets/react-wizard.cast \
    assets/wizard.gif
```

## When the README is updated, ship

The recording is the only thing blocking the announcement post. Once
`assets/demo.gif` is in, the README hero looks complete, and the
existing draft at `docs/announcements/2026-05-09-faster-than-yoga.md`
can ship to HN / Twitter / r/javascript / r/commandline.

Don't post the announcement until:
1. ~~`@pilates/core@1.0.0` and `@pilates/render@1.0.0` are on npm~~ —
   done as of 2026-05-09. `npm view @pilates/core version` returns
   `1.0.0`.
2. `assets/demo.gif` is committed and the README block is
   uncommented.
