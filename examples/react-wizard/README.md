# react-wizard

End-to-end showcase of `@pilates/widgets`: a four-step wizard that drives `<TextInput>`, `<Select>`, and `<Spinner>` in sequence on top of `@pilates/react`. Type a name, pick a size, watch the spinner, see the result, exit.

```bash
pnpm --filter @pilates-examples/react-wizard dev
```

The `<TextInput>` (name) and `<Select>` (size) capture interactive keyboard input — this is the example that exercises `useInput` end-to-end through real widgets, not just a counter.
