import { Box, Text, render, useApp } from '@pilates/react';
import { Select, type SelectItem, Spinner, TextInput } from '@pilates/widgets';
import { useEffect, useState } from 'react';
import { pathToFileURL } from 'node:url';

type Step = 'name' | 'size' | 'processing' | 'done';

const sizes: SelectItem<'sm' | 'md' | 'lg'>[] = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
];

const finalResult: { current: { name: string; size: string } | null } = { current: null };

export function App() {
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [size, setSize] = useState<'sm' | 'md' | 'lg' | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    if (step !== 'processing') return;
    const t = setTimeout(() => setStep('done'), 2500);
    return () => {
      clearTimeout(t);
    };
  }, [step]);

  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(() => exit(), 1500);
    return () => {
      clearTimeout(t);
    };
  }, [step, exit]);

  return (
    <Box flexDirection="column" padding={1} width={50} height={8}>
      <Text bold color="cyan">
        Pilates Widgets Wizard
      </Text>

      {step === 'name' && (
        <Box flexDirection="column" marginTop={1} height={3}>
          <Text>What's your name?</Text>
          <TextInput
            value={name}
            onChange={setName}
            onSubmit={(v) => {
              if (v.trim().length > 0) setStep('size');
            }}
            placeholder="type and press Enter"
          />
        </Box>
      )}

      {step === 'size' && (
        <Box flexDirection="column" marginTop={1} height={5}>
          <Text>Hi {name}. Pick a size:</Text>
          <Select
            items={sizes}
            onSelect={(item) => {
              setSize(item.value);
              finalResult.current = { name, size: item.value };
              setStep('processing');
            }}
          />
        </Box>
      )}

      {step === 'processing' && (
        <Box flexDirection="row" marginTop={1} height={1}>
          <Spinner type="dots" />
          <Text> Processing...</Text>
        </Box>
      )}

      {step === 'done' && (
        <Box flexDirection="column" marginTop={1} height={2}>
          <Text color="green">✓ Done</Text>
          <Text>
            name = {name}, size = {size}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// Only run when invoked directly (not when imported by tests).
// pathToFileURL handles cross-platform quirks (Windows drive letters, the
// file:/// vs file:// slash count) that hand-built file URLs get wrong.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Pin stdin into flowing mode so Node's event loop stays alive long enough
  // for React's passive effects (which attach useInput's stdin listener) to
  // fire. Without this the wizard can exit before its first paint commits.
  process.stdin.resume();
  const instance = render(<App />);
  await instance.waitUntilExit();
  if (finalResult.current) {
    process.stdout.write(`\nResult: name=${finalResult.current.name}, size=${finalResult.current.size}\n`);
  }
}
