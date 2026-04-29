<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo-dark.svg">
  <img src="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo.svg" alt="pilates" width="48">
</picture>

# @pilates/render

Out-of-box renderer for [`@pilates/core`](../core). Takes a declarative tree, returns
a painted string with ANSI styling and box-drawing borders.

```ts
import { render } from '@pilates/render';

const out = render({
  width: 80,
  height: 24,
  flexDirection: 'row',
  children: [
    { flex: 1, border: 'rounded', title: 'Logs', children: [{ text: 'hello' }] },
    { width: 20, border: 'single', title: 'Status', children: [{ text: 'ok', color: 'green' }] },
  ],
});

process.stdout.write(out);
```

Status: release candidate.
