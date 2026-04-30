import { createContext, useContext } from 'react';

export interface AppHookValue {
  exit: (error?: Error) => void;
}

export interface StdoutHookValue {
  stdout: NodeJS.WriteStream;
  write: (s: string) => boolean;
  columns: number;
  rows: number;
}

export interface StderrHookValue {
  stderr: NodeJS.WriteStream;
  write: (s: string) => boolean;
}

export const AppContext = createContext<AppHookValue | null>(null);
export const StdoutContext = createContext<StdoutHookValue | null>(null);
export const StderrContext = createContext<StderrHookValue | null>(null);

export function useApp(): AppHookValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('Pilates: useApp() must be used inside <render>.');
  return v;
}

export function useStdout(): StdoutHookValue {
  const v = useContext(StdoutContext);
  if (!v) throw new Error('Pilates: useStdout() must be used inside <render>.');
  return v;
}

export function useStderr(): StderrHookValue {
  const v = useContext(StderrContext);
  if (!v) throw new Error('Pilates: useStderr() must be used inside <render>.');
  return v;
}
