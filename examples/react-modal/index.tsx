import { pathToFileURL } from 'node:url';
import { Box, Text, render, useApp, useStdout } from '@pilates/react';
import { useEffect, useState } from 'react';

export function App() {
  const { columns: cols, rows } = useStdout();
  const { exit } = useApp();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setOpen((o) => !o), 1500);
    const stop = setTimeout(() => exit(), 3000);
    return () => {
      clearTimeout(t);
      clearTimeout(stop);
    };
  }, [exit]);

  const users = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry', 'ivy', 'jack'];
  const modalWidth = 36;
  const modalHeight = 7;
  const modalLeft = Math.max(0, Math.floor((cols - modalWidth) / 2));
  const modalTop = Math.max(0, Math.floor((rows - modalHeight) / 2));

  return (
    <Box width={cols} height={rows} flexDirection="column">
      <Box flex={1} border="single" title="App">
        <Text color="cyan" bold>
          users:
        </Text>
        {users.map((u) => (
          <Text key={u}>{` ├ ${u}`}</Text>
        ))}
      </Box>
      {open && (
        <Box
          positionType="absolute"
          position={{ top: modalTop, left: modalLeft }}
          width={modalWidth}
          height={modalHeight}
          border="rounded"
          borderColor="yellow"
          title="Confirm action"
          titleColor="yellow"
          flexDirection="column"
          justifyContent="space-between"
          padding={{ top: 1, bottom: 1, left: 2, right: 2 }}
        >
          <Text bold>Delete user "carol"?</Text>
          <Box height={1} flexDirection="row" justifyContent="space-around">
            <Text color="gray">[ cancel ]</Text>
            <Text color="red" bold>
              [ delete ]
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Only run when invoked directly (not when imported by tests).
// pathToFileURL handles cross-platform quirks (Windows drive letters, the
// file:/// vs file:// slash count) that hand-built file URLs get wrong.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = render(<App />);
  await instance.waitUntilExit();
}
