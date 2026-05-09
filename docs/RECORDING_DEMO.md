# Recording the README hero demo

The README has a commented-out section between the wordmark and the
intro text expecting `assets/demo.gif`. Once recorded, drop the file
into `assets/` and uncomment the `<p align="center">…<img …></p>`
block in `README.md` (currently lines 17–24).

## Recommended choice

**`examples/progress-table`** for the README hero. It's:
- Visually striking (color bars, percentages, status icons).
- Static-looking — easy to capture without timing tricks.
- Demonstrates render quality without needing user input.
- Renders in ~0.5 seconds; clip is short.

For a secondary asset (Twitter / blog), `examples/react-wizard`
demonstrates the interactive React story — `<TextInput>` → `<Select>`
→ `<Spinner>` flow with mouse and keyboard. Better for "look you can
build interactive things" framing. Record this one separately if you
want a second clip.

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
   - **Comfortable size:** ~120 columns × 24 rows lets the
     `progress-table` output sit on one screen without wrap.
   - **Larger font.** Hit `Ctrl + =` a few times so the eventual GIF
     stays readable when scaled to ~720px wide.
3. In ScreenToGif: **Recorder → Region select** → drag a tight
   rectangle around just the terminal output area (no title bar,
   no shell prompt above the example).
4. Click record. Switch focus to the terminal and run:
   ```bash
   pnpm --filter @pilates-examples/progress-table dev
   ```
5. The example renders one static frame and exits. Wait ~1–2 seconds
   after the output appears, then stop ScreenToGif.
6. ScreenToGif's editor opens. Trim leading/trailing dead frames
   (Edit → Trim → keep only frames showing the rendered output).
   For a near-static clip like this, set the playback to **2 fps**
   (or just keep a single frame and save as GIF) — both keep the
   file <500 KB.
7. **Save → Gif → File**. Name it `assets/demo.gif`, save into the
   repo's `assets/` folder.

**For an animated alternative** (if you want the GIF to actually
move): record `react-dashboard` instead. It has a live `tick` counter
that increments every frame, giving the GIF visible motion:

```bash
pnpm --filter @pilates-examples/react-dashboard dev
```

Record ~5 seconds of it, the diff loop's live re-render creates a
cleanly-moving clip.

## Recording — macOS / Linux (asciinema + agg)

```bash
# 1. Make sure you're on a clean main with no uncommitted noise.
cd /e/Github/tercli
git status

# 2. Build the workspace so the example runs without lag.
pnpm install
pnpm build

# 3. Record.
asciinema rec assets/progress-table.cast \
  --command "pnpm --filter @pilates-examples/progress-table dev" \
  --idle-time-limit 1.0

# 4. Convert to GIF. Tweak --cols / --rows to match the example's
#    output dimensions (progress-table is 80x20-ish).
agg --cols 80 --rows 18 \
    --font-family "JetBrains Mono,Menlo,Monaco,monospace" \
    --speed 1.5 \
    assets/progress-table.cast \
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
agg --cols 80 --rows 18 \
    --speed 2.0 \
    --last-frame-pause 1.0 \
    assets/progress-table.cast \
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

Don't post the announcement until both:
1. `@pilates/core@1.0.0` and `@pilates/render@1.0.0` are on npm
   (the `npm pack --dry-run` outputs the correct tarballs at HEAD;
   actual `pnpm publish` needs your 2FA OTP).
2. `assets/demo.gif` is committed and the README block is
   uncommented.
