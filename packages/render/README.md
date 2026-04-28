# @tercli/render

Out-of-box renderer for [`@tercli/core`](../core). Takes a declarative tree, returns
a painted string with ANSI styling and box-drawing borders.

```ts
import { render } from '@tercli/render';

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

Status: pre-release. API subject to change.
