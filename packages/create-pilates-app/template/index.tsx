import { Box, Text, render, useApp, useInput } from '@pilates/react';
import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);
  const { exit } = useApp();

  useInput((event) => {
    if (event.ch === '+') setCount((n) => n + 1);
    if (event.ch === '-') setCount((n) => n - 1);
    if (event.ch === 'q') exit();
  });

  return (
    <Box border="single" padding={1} flexDirection="column" width={24}>
      <Text bold color="cyan">
        pilates app
      </Text>
      <Text>count: {count}</Text>
      <Text dim>+ / - to change</Text>
      <Text dim>q to quit</Text>
    </Box>
  );
}

const instance = render(<App />);
await instance.waitUntilExit();
