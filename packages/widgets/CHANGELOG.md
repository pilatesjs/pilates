# Changelog — @pilates/widgets

All notable changes to `@pilates/widgets` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
package follows [Semantic Versioning](https://semver.org/) once it leaves
the release-candidate train.

## [0.1.0-rc.3] — 2026-05-11

### Fixed

- `peerDependencies."@pilates/react"` was pinned to `^0.2.0` from the
  rc.1 days; consumers installing with `@pilates/react@0.3.x` saw a
  resolution warning. Bumped to `^0.3.0`.

### Changed

- `package.json` `description` now lists all eight widgets that
  actually ship in this rc (previously listed only the original three).
  The npm page now matches the README's feature list.

## [0.1.0-rc.2] — 2026-05-03

### Added

- `<ProgressBar>` — determinate or indeterminate progress bar. Determinate
  clamps `value` to `[0, total]` and rounds to a cell count; indeterminate
  animates a bouncing scanner across the bar. Custom `fillChar` /
  `emptyChar` and `color` / `trackColor`.
- `<TextArea>` — multi-line text editor. Grapheme-aware cursor that walks
  across line boundaries; Enter inserts `\n`; arrow keys preserve column
  position; bracketed paste preserves newlines.
- `<MultiSelect>` — checklist sibling of `<Select>`. `Space` toggles the
  highlighted item, `Enter` calls `onSubmit` with the selection in
  items-order. Controlled via `selectedKeys: Set<string>`.
- `<Tabs>` — horizontal tab strip. `←`/`→` cycle through enabled tabs;
  `Home`/`End` jump to first/last enabled. Controlled via `activeKey` /
  `onChange(key)`.
- `<Table>` — tabular data display. Bold header row, horizontal divider,
  per-column `width` / `align` / optional `render`. Wide-character aware
  truncation via `stringWidth` from `@pilates/core`.
- `focusId?: string` and `autoFocus?: boolean` props on `<TextInput>` and
  `<Select>` — when `focusId` is set, the keystroke gate routes through
  the surrounding `<FocusProvider>` so Tab cycling works without
  parent-side `focus={...}` bookkeeping. The boolean `focus` prop still
  works for back-compat.

### Fixed

- `<TextInput>` cursor model is now grapheme-cluster indexed instead of
  UTF-16 code unit indexed. Emoji and ZWJ sequences (e.g. 👨‍👩‍👧) edit
  as one user-perceived character; surrogate pairs no longer split
  mid-edit.
- `<Select>` re-clamps `highlightIndex` when the `items` prop shrinks
  past the current index. Previously, Enter became a silent no-op and
  no row showed as highlighted after the items list shrank.

### Changed

- Added `@pilates/core` as a direct runtime dependency (previously a
  transitive via `@pilates/react`). Makes the relationship explicit so
  the widgets package can `import { graphemes } from '@pilates/core'`.

## [0.1.0-rc.1] — 2026-05-01

Initial pre-release of the widgets layer.

### Added

- `<TextInput>` — single-line text input with cursor, password mask
  (`mask` prop), placeholder. Backspace, left/right arrows, home/end,
  Ctrl+U / Ctrl+K / Ctrl+W, character insertion.
- `<Select>` — single-select menu with keyboard navigation (`↑`/`↓`,
  `Home`/`End`, `Enter` to submit). Disabled items, custom indicator.
- `<Spinner>` — animated progress indicator. Built-in frame catalogs
  (`dots`, `line`, `arc`, `arrow`) plus custom `frames` array. Configurable
  `interval`.
- React 19 peer; `@pilates/react ^0.2.0` peer.
