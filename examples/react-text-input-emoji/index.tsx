import { pathToFileURL } from 'node:url';
import { graphemes } from '@pilates/core';
import { Box, Text, render, useApp } from '@pilates/react';
import { TextInput } from '@pilates/widgets';
import { useState } from 'react';

const finalValue: { current: string } = { current: '' };

function countGraphemes(s: string): number {
  let n = 0;
  for (const _ of graphemes(s)) n++;
  return n;
}

export function App() {
  // Initial value mixes ASCII, a wide CJK char, a surrogate-pair emoji, and
  // a ZWJ family — every shape that breaks code-unit-indexed cursors.
  const [value, setValue] = useState('👋 你好 👨‍👩‍👧!');
  const { exit } = useApp();
  const graphemeCount = countGraphemes(value);

  return (
    <Box flexDirection="column" padding={1} width={50} height={6}>
      <Text bold color="cyan">
        TextInput emoji demo
      </Text>
      <Text dim>
        ←/→ to move; Backspace to delete; Enter to exit. Emoji + ZWJ sequences edit as one cluster.
      </Text>
      <Box flexDirection="row" height={1}>
        <Text>{'> '}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            finalValue.current = v;
            exit();
          }}
        />
      </Box>
      <Text dim>
        graphemes={graphemeCount} • code units={value.length}
      </Text>
    </Box>
  );
}

// Only run when invoked directly (not when imported by tests).
// pathToFileURL handles cross-platform quirks (Windows drive letters, the
// file:/// vs file:// slash count) that hand-built file URLs get wrong.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = render(<App />);
  await instance.waitUntilExit();
  process.stdout.write(`\nFinal: ${finalValue.current}\n`);
}
