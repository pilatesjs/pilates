export type MouseButton = 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down' | 'none'; // mouse-move, no button pressed

export interface MouseEvent {
  /** 1-based terminal column (leftmost = 1). */
  col: number;
  /** 1-based terminal row (topmost = 1). */
  row: number;
  button: MouseButton;
  /** true = press / wheel tick. false = button release. */
  pressed: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Raw SGR escape sequence that produced this event. */
  sequence: string;
  /** Call to stop bubbling to ancestor boxes. No-op on raw `useMouse` events. */
  stopPropagation: () => void;
}
