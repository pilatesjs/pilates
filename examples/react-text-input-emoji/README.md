# react-text-input-emoji

Focused demo of `<TextInput>`'s grapheme-cluster cursor model. The initial value mixes ASCII, a wide CJK character, a surrogate-pair emoji, and a ZWJ family sequence — exactly the shapes that break code-unit-indexed editors.

```bash
pnpm --filter @pilates-examples/react-text-input-emoji dev
```

Try ←/→ to step through the value: each emoji and the ZWJ family advance the cursor by one grapheme, not by one UTF-16 code unit. Backspace deletes the whole cluster. The footer shows `graphemes` (what the cursor counts) vs `code units` (what `value.length` reports) so the difference is visible.

Press Enter to commit and exit.
