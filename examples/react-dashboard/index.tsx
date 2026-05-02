import { pathToFileURL } from 'node:url';
import { Box, Text, render, useApp, useStdout } from '@pilates/react';
import { useEffect, useState } from 'react';

interface Tile {
  title: string;
  value: string;
  detail?: string;
  color: 'green' | 'yellow' | 'red' | 'cyan' | 'magenta';
}

export function App() {
  const { columns: cols, rows } = useStdout();
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    const stop = setTimeout(() => {
      clearInterval(id);
      exit();
    }, 3000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [exit]);

  const tiles: Tile[] = [
    {
      title: 'CPU',
      value: `${(40 + (tick % 20)).toFixed(0)}%`,
      detail: 'load 1.4',
      color: 'green',
    },
    { title: 'Memory', value: '8.2 GB', detail: '/ 16 GB', color: 'cyan' },
    { title: 'Disk', value: '124 GB', detail: '/ 500 GB', color: 'cyan' },
    { title: 'Network', value: `${10 + (tick % 5)} MB/s`, detail: '↓ 8  ↑ 4', color: 'magenta' },
  ];
  const tileWidth = Math.max(6, Math.floor((cols - 2 - tiles.length * 2 - 2) / tiles.length));

  return (
    <Box width={cols} height={rows} flexDirection="column">
      <Box
        height={3}
        border="single"
        title="Pilates Dashboard"
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Text color="green" bold>
          ● running
        </Text>
        <Text color="gray">tick {tick}</Text>
      </Box>
      <Box flex={1} flexDirection="row" alignItems="flex-start" gap={{ column: 2 }} padding={1}>
        {tiles.map((t) => (
          <Box key={t.title} width={tileWidth} height={4} border="rounded" title={t.title}>
            <Text color={t.color} bold>
              {t.value}
            </Text>
            <Text color="gray">{t.detail ?? ''}</Text>
          </Box>
        ))}
      </Box>
      <Box height={3} border="single">
        <Box height={1} flexDirection="row" justifyContent="space-around" alignItems="center">
          <Text color="green">read 412/s</Text>
          <Text color="cyan">write 87/s</Text>
          <Text color="green">errors 0</Text>
          <Text color="gray">latency 4ms</Text>
        </Box>
      </Box>
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
