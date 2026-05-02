import { describe, expect, it } from 'vitest';
import type { TextFragment, TextInstance } from './reconciler.js';
import { flattenText } from './text-flatten.js';

function frag(text: string): TextFragment {
  return { kind: 'fragment', text, parent: null };
}
function textInst(fragments: TextInstance['fragments']): TextInstance {
  return { kind: 'text', node: { text: '' }, fragments, parent: null };
}

describe('flattenText', () => {
  it('concatenates string fragments', () => {
    expect(flattenText(textInst([frag('hello'), frag(' '), frag('world')]))).toBe('hello world');
  });

  it('flattens nested <Text> by concatenating its text', () => {
    const inner = textInst([frag('inner')]);
    expect(flattenText(textInst([frag('outer '), inner]))).toBe('outer inner');
  });

  it('throws if a fragment is something other than TextFragment or TextInstance', () => {
    const bad = { kind: 'box', node: {} } as unknown as TextInstance['fragments'][number];
    expect(() => flattenText(textInst([bad]))).toThrow(
      /Pilates: <Text> children must be string, number, <Text>, or <Newline>/,
    );
  });
});
