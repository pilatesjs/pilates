# Changelog

All notable changes to `@pilates/render` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [1.0.0] — 2026-05-09

Promotion to 1.0.0 alongside `@pilates/core@1.0.0`. No `@pilates/render`
public API change since `1.0.0-rc.3`; the version bump reflects the
core's milestone (consumers using both packages now have a clean
matched-1.0 line).

## [1.0.0-rc.3] — 2026-05-07

### Scissor clipping + scrollbar (Track 1 P2 prep)

- **Added** Internal scissor-rect stack on `Frame`: `pushScissor` / `popScissor`. Nested scissors intersect.
- **Added** Internal `paintScrollbar` helper (text-glyph, vertical + horizontal).
- **Changed** Painter clips overflow nodes: push scissor → translate child paint by `(-scrollLeft, -scrollTop)` → paint children → pop → paint scrollbar.
- **Added** `RenderNode.overflow` / `overflowX` / `overflowY` / `scrollLeft` / `scrollTop` props.
