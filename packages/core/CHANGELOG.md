# Changelog

All notable changes to `@pilates/core` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Overflow (Track 1 P2 prep)

- **Added** `Style.overflow` / `overflowX` / `overflowY` (`'visible' | 'hidden' | 'scroll' | 'auto'`). Default `'visible'`.
- **Added** `Node.setOverflow` / `setOverflowX` / `setOverflowY` setters.
- **Added** `Node.scrollLeft` / `scrollTop` mutable fields (paint-time, no markDirty).
- **Added** `ComputedLayout.scrollWidth` / `scrollHeight` and `Node.scrollWidth` / `scrollHeight` getters.
- **Verified** `overflow: scroll/hidden` preserves children's natural (unconstrained) size.
