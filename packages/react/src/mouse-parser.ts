import type { MouseButton, MouseEvent } from './mouse-event.js';

export function parseSgrMouse(params: string, final: string, sequence: string): MouseEvent | null {
  const parts = params.split(';');
  if (parts.length !== 3) return null;

  const pb = Number.parseInt(parts[0]!, 10);
  const col = Number.parseInt(parts[1]!, 10);
  const row = Number.parseInt(parts[2]!, 10);
  if (Number.isNaN(pb) || Number.isNaN(col) || Number.isNaN(row)) return null;

  const pressed = final === 'M';
  const shift = (pb & 0x04) !== 0;
  const alt = (pb & 0x08) !== 0;
  const ctrl = (pb & 0x10) !== 0;
  const motion = (pb & 0x20) !== 0;
  const scroll = (pb & 0x40) !== 0;
  const btnBits = pb & 0x03;

  let button: MouseButton;
  if (scroll) {
    button = btnBits === 0 ? 'wheel-up' : 'wheel-down';
  } else if (motion && btnBits === 3) {
    button = 'none';
  } else {
    switch (btnBits) {
      case 0:
        button = 'left';
        break;
      case 1:
        button = 'middle';
        break;
      case 2:
        button = 'right';
        break;
      default:
        button = 'none';
    }
  }

  return {
    col,
    row,
    button,
    pressed,
    ctrl,
    alt,
    shift,
    sequence,
    stopPropagation: () => {},
  };
}
