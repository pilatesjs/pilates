# @tercli/core

The engine. Imperative `Node` API, integer cell coordinates, terminal-correct text
measurement. Pure TypeScript, zero runtime dependencies.

```ts
import { Node, Edge } from '@tercli/core';

const root = Node.create();
root.setFlexDirection('row');
root.setWidth(80);
root.setHeight(24);
root.setPadding(Edge.All, 1);

const main = Node.create();
main.setFlex(1);
root.insertChild(main, 0);

root.calculateLayout();
main.getComputedLayout(); // { left, top, width, height }
```

Status: pre-release. API subject to change.
