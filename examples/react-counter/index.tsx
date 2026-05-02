import { pathToFileURL } from 'node:url';
import { Box, Text, render, useApp } from '@pilates/react';
import { useEffect, useState } from 'react';

export function App() {
  const [n, setN] = useState(0);
  const { exit } = useApp();
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), 250);
    const stop = setTimeout(() => {
      clearInterval(id);
      exit();
    }, 3000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [exit]);
  return (
    <Box border="single" padding={1} width={20} height={7} flexDirection="column">
      <Text bold color="cyan">
        counter
      </Text>
      <Text>n = {n}</Text>
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
