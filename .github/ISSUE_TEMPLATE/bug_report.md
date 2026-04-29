---
name: Bug report
about: Report a layout, render, or API bug
title: ''
labels: bug
assignees: ''
---

## What happened

A clear, concise description of the bug.

## Reproduction

Minimal Pilates spec or code snippet that reproduces the issue:

```ts
import { render } from '@pilates/render';

process.stdout.write(
  render({
    width: 20,
    height: 3,
    // ...
  }),
);
```

## Expected output

What you expected to see (paste the layout/string, or describe).

## Actual output

What you actually saw (paste the layout/string).

## Environment

- Pilates version(s): `@pilates/core@`, `@pilates/render@`, `@pilates/diff@`
- Node version: `node -v`
- OS: macOS / Linux / Windows + version
- Terminal: iTerm2 / Windows Terminal / Alacritty / etc.

## Additional context

Anything else relevant — config, related issues, screenshots.
