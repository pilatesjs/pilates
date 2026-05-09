/**
 * Flagship demo: an interactive build-pipeline dashboard.
 *
 * Demonstrates:
 *   - Multi-pane layout via flex containers and ScrollView
 *   - Focus management (Tab cycles between Tasks list and Activity log)
 *   - Mouse: click task to select, scroll wheel anywhere
 *   - Keyboard: ↑↓ navigate, Enter run, q quit
 *   - Animation: live tick, spinner on running step, log appends
 *   - Widgets: <ProgressBar>, <Spinner>
 *
 * The simulation cycles forever — selecting a task starts a fake build,
 * progress bars fill, log entries append, then the next task is picked.
 *
 * Designed for a ~100×30 terminal for the README/launch demo capture.
 */

import { pathToFileURL } from 'node:url';
import {
  Box,
  ScrollView,
  Text,
  render,
  useApp,
  useFocus,
  useFocusManager,
  useInput,
  useStdout,
} from '@pilates/react';
import { ProgressBar, Spinner } from '@pilates/widgets';
import { useEffect, useRef, useState } from 'react';

// ─── domain types ───────────────────────────────────────────────────────

interface Task {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'done' | 'failed';
}

interface PipelineStep {
  name: string;
  progress: number; // 0..100
  status: 'pending' | 'running' | 'done' | 'failed';
}

interface LogEntry {
  time: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

// ─── seed data ──────────────────────────────────────────────────────────

const INITIAL_TASKS: Task[] = [
  { id: 'build', name: 'Build CI pipeline', status: 'running' },
  { id: 'deploy-staging', name: 'Deploy to staging', status: 'idle' },
  { id: 'e2e', name: 'Run e2e suite', status: 'idle' },
  { id: 'docs', name: 'Update docs site', status: 'idle' },
  { id: 'tag', name: 'Tag release', status: 'idle' },
  { id: 'notify', name: 'Notify team', status: 'idle' },
  { id: 'cleanup', name: 'Cleanup artifacts', status: 'idle' },
];

const PIPELINE_STEPS = (): PipelineStep[] => [
  { name: 'lint', progress: 0, status: 'pending' },
  { name: 'typecheck', progress: 0, status: 'pending' },
  { name: 'unit tests', progress: 0, status: 'pending' },
  { name: 'integration tests', progress: 0, status: 'pending' },
  { name: 'package', progress: 0, status: 'pending' },
  { name: 'deploy:staging', progress: 0, status: 'pending' },
];

const STEP_DURATIONS_MS: Record<string, number> = {
  lint: 800,
  typecheck: 1500,
  'unit tests': 1200,
  'integration tests': 2400,
  package: 900,
  'deploy:staging': 1800,
};

// ─── helpers ────────────────────────────────────────────────────────────

function fmtTime(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function statusGlyph(s: Task['status'] | PipelineStep['status']): string {
  return s === 'done' ? '✓' : s === 'failed' ? '✗' : s === 'running' ? '▸' : '·';
}

function statusColor(
  s: Task['status'] | PipelineStep['status'],
): 'green' | 'red' | 'yellow' | 'gray' {
  return s === 'done' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'yellow' : 'gray';
}

// ─── App ────────────────────────────────────────────────────────────────

export function App() {
  const { columns, rows } = useStdout();
  const { exit } = useApp();
  const { focus } = useFocusManager();

  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineStep[]>(PIPELINE_STEPS());
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: fmtTime(), level: 'info', message: 'Pilates dashboard ready.' },
  ]);
  const [tick, setTick] = useState(0);

  // Default focus to the tasks pane.
  useEffect(() => {
    focus('tasks');
  }, [focus]);

  // ── Quit handler
  useInput((event) => {
    if (event.ch === 'q' || event.ch === 'Q') {
      exit();
    }
  });

  // ── Pipeline simulation
  // Each tick advances the running step's progress. When it hits 100,
  // mark it done, append a log, advance to the next step. When all
  // steps are done, mark the running task done and start the next one.
  const stepStartRef = useRef<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);

      setPipeline((prev) => {
        const idx = prev.findIndex((s) => s.status === 'pending' || s.status === 'running');
        if (idx === -1) return prev; // all done

        const step = prev[idx]!;
        const next = [...prev];

        if (step.status === 'pending') {
          next[idx] = { ...step, status: 'running' };
          stepStartRef.current = Date.now();
          appendLog({
            time: fmtTime(),
            level: 'info',
            message: `${step.name} started`,
          });
          return next;
        }

        const dur = STEP_DURATIONS_MS[step.name] ?? 1200;
        const elapsed = Date.now() - stepStartRef.current;
        const pct = Math.min(100, Math.round((elapsed / dur) * 100));

        if (pct >= 100) {
          next[idx] = { ...step, progress: 100, status: 'done' };
          appendLog({
            time: fmtTime(),
            level: 'success',
            message: `${step.name} passed`,
          });
        } else {
          next[idx] = { ...step, progress: pct };
        }
        return next;
      });

      // Check if pipeline finished — advance to next task and reset.
      setPipeline((prev) => {
        if (prev.every((s) => s.status === 'done' || s.status === 'failed')) {
          setTasks((tt) => {
            const runningIdx = tt.findIndex((t) => t.status === 'running');
            if (runningIdx === -1) return tt;
            const nextTasks = [...tt];
            nextTasks[runningIdx] = { ...tt[runningIdx]!, status: 'done' };
            const nextIdleIdx = nextTasks.findIndex((t) => t.status === 'idle');
            if (nextIdleIdx !== -1) {
              nextTasks[nextIdleIdx] = { ...nextTasks[nextIdleIdx]!, status: 'running' };
              appendLog({
                time: fmtTime(),
                level: 'info',
                message: `Starting: ${nextTasks[nextIdleIdx]!.name}`,
              });
            }
            return nextTasks;
          });
          return PIPELINE_STEPS();
        }
        return prev;
      });
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: setters are stable
  }, []);

  function appendLog(entry: LogEntry) {
    setLogs((l) => [...l, entry].slice(-50));
  }

  const headerHeight = 3;
  const footerHeight = 1;
  const middleHeight = Math.max(10, rows - headerHeight - footerHeight);
  const tasksPaneWidth = 32;
  const rightPaneWidth = Math.max(40, columns - tasksPaneWidth - 1);
  const pipelineHeight = Math.min(11, Math.floor(middleHeight * 0.45));
  const logHeight = middleHeight - pipelineHeight;

  const runningTaskName = tasks.find((t) => t.status === 'running')?.name ?? '—';

  return (
    <Box width={columns} height={rows} flexDirection="column">
      {/* Header */}
      <Box
        height={headerHeight}
        border="single"
        title="Pilates Build Dashboard"
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        padding={{ left: 1, right: 1 }}
      >
        <Box flexDirection="row" gap={{ column: 2 }}>
          <Text color="green" bold>
            ● live
          </Text>
          <Text color="gray">running:</Text>
          <Text color="cyan">{runningTaskName}</Text>
        </Box>
        <Text color="gray">tick {tick}</Text>
      </Box>

      {/* Middle: tasks | (pipeline + log) */}
      <Box flex={1} flexDirection="row">
        {/* Tasks pane */}
        <TasksPane
          tasks={tasks}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
          width={tasksPaneWidth}
          height={middleHeight}
        />

        {/* Right column */}
        <Box width={rightPaneWidth} flexDirection="column">
          <PipelinePane pipeline={pipeline} height={pipelineHeight} />
          <ActivityPane logs={logs} height={logHeight} />
        </Box>
      </Box>

      {/* Footer */}
      <Box
        height={footerHeight}
        flexDirection="row"
        justifyContent="space-around"
        padding={{ left: 1, right: 1 }}
      >
        <Text color="gray">
          <Text color="white" bold>
            Tab
          </Text>{' '}
          switch pane
        </Text>
        <Text color="gray">
          <Text color="white" bold>
            ↑↓
          </Text>{' '}
          navigate
        </Text>
        <Text color="gray">
          <Text color="white" bold>
            Click
          </Text>{' '}
          select
        </Text>
        <Text color="gray">
          <Text color="white" bold>
            q
          </Text>{' '}
          quit
        </Text>
      </Box>
    </Box>
  );
}

// ─── Tasks pane ─────────────────────────────────────────────────────────

function TasksPane({
  tasks,
  selectedIdx,
  onSelect,
  width,
  height,
}: {
  tasks: Task[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  width: number;
  height: number;
}) {
  const { isFocused } = useFocus({ id: 'tasks', autoFocus: true });

  useInput(
    (event) => {
      if (event.name === 'up') onSelect(Math.max(0, selectedIdx - 1));
      else if (event.name === 'down') onSelect(Math.min(tasks.length - 1, selectedIdx + 1));
    },
    { isActive: isFocused },
  );

  return (
    <Box
      width={width}
      height={height}
      border={isFocused ? 'rounded' : 'single'}
      borderColor={isFocused ? 'cyan' : 'gray'}
      title="Tasks"
      flexDirection="column"
    >
      <ScrollView height={height - 2}>
        {tasks.map((task, i) => {
          const isSelected = i === selectedIdx;
          const highlight = isSelected && isFocused;
          return (
            <Box
              key={task.id}
              height={1}
              flexDirection="row"
              padding={{ left: 1, right: 1 }}
              onClick={() => onSelect(i)}
            >
              <Text color={highlight ? 'cyan' : statusColor(task.status)} bold>
                {highlight ? '▸' : statusGlyph(task.status)}
              </Text>
              <Text> </Text>
              <Text color={highlight ? 'cyan' : 'white'} bold={highlight}>
                {task.name}
              </Text>
            </Box>
          );
        })}
      </ScrollView>
    </Box>
  );
}

// ─── Pipeline pane ──────────────────────────────────────────────────────

function PipelinePane({ pipeline, height }: { pipeline: PipelineStep[]; height: number }) {
  return (
    <Box
      height={height}
      border="single"
      borderColor="gray"
      title="Pipeline"
      flexDirection="column"
      padding={1}
    >
      {pipeline.map((step) => (
        <Box key={step.name} height={1} flexDirection="row" gap={{ column: 1 }}>
          <Box width={2}>
            {step.status === 'running' ? (
              <Spinner />
            ) : (
              <Text color={statusColor(step.status)} bold>
                {statusGlyph(step.status)}
              </Text>
            )}
          </Box>
          <Box width={20}>
            <Text color={step.status === 'done' ? 'gray' : 'white'}>{step.name}</Text>
          </Box>
          <ProgressBar
            value={step.progress}
            total={100}
            width={20}
            color={step.status === 'done' ? 'green' : step.status === 'failed' ? 'red' : 'yellow'}
            trackColor="gray"
          />
          <Text color="gray">{step.progress.toString().padStart(3, ' ')}%</Text>
        </Box>
      ))}
    </Box>
  );
}

// ─── Activity log pane ─────────────────────────────────────────────────

function ActivityPane({ logs, height }: { logs: LogEntry[]; height: number }) {
  const { isFocused } = useFocus({ id: 'log' });

  return (
    <Box
      height={height}
      border={isFocused ? 'rounded' : 'single'}
      borderColor={isFocused ? 'cyan' : 'gray'}
      title="Activity"
      flexDirection="column"
    >
      <ScrollView height={height - 2} stickToBottom>
        {logs.map((entry, i) => (
          <Box
            // biome-ignore lint/suspicious/noArrayIndexKey: log entries are append-only and stable by index
            key={i}
            height={1}
            flexDirection="row"
            padding={{ left: 1, right: 1 }}
            gap={{ column: 1 }}
          >
            <Text color="gray">{entry.time}</Text>
            <Text
              color={
                entry.level === 'success'
                  ? 'green'
                  : entry.level === 'error'
                    ? 'red'
                    : entry.level === 'warning'
                      ? 'yellow'
                      : 'cyan'
              }
              bold
            >
              {entry.level === 'success'
                ? '✓'
                : entry.level === 'error'
                  ? '✗'
                  : entry.level === 'warning'
                    ? '!'
                    : '•'}
            </Text>
            <Text>{entry.message}</Text>
          </Box>
        ))}
      </ScrollView>
    </Box>
  );
}

// ─── entrypoint ─────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = render(<App />);
  await instance.waitUntilExit();
}
