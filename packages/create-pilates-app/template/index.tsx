import { Box, Text, render, useApp, useInput } from '@pilates/react';
import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);
  const { exit } = useApp();

  useInput((input) => {
    if (input === '+') setCount((n) => n + 1);
    if (input === '-') setCount((n) => n - 1);
    if (input === 'q') exit();
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
