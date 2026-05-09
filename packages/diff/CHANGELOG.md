# Changelog

All notable changes to `@pilates/diff` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.2.0] — 2026-05-09

Companion bump to `@pilates/core@1.0.0` and `@pilates/render@1.0.0`.
No `@pilates/diff` public API change since `0.1.0`; the version bump
keeps the diff package's range comfortable for the 1.0 ecosystem
moment.

## [0.1.0] — 2026-04-30

Initial release. Cell-level frame diff + minimal ANSI redraw sequences
for live Pilates TUIs. `diffFrames(prev, next): string` walks two
`Frame` instances cell-by-cell and emits the smallest CSI cursor +
SGR + glyph sequence that turns one into the other. Pairs with
`@pilates/render`'s `Frame` for the live-update loop.
