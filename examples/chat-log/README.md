# chat-log

A two-pane chat-style layout: scrolling messages on the left, status sidebar on
the right.

## Run

```bash
pnpm --filter @tercli-examples/chat-log dev
```

## What it shows

- **`flexDirection: 'row'`** at the root for the two-pane split.
- **`flex: 1`** on the chat panel to take all leftover horizontal space.
- **`width: 22`** on the status panel — fixed cell count.
- Each message is a **single text leaf** — text leaves report their natural
  wrapped height via a measure function, so a long message wraps to two
  lines inside the panel without any explicit sizing.
- Per-message ANSI color follows the speaker.
- Wide-char passthrough: `☕`, `✅`, `👀`, `🎉`, CJK.
