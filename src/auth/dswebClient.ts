// TODO(M2.1): replace stub with real DeepSeek web protocol calls. Reference: github.com/CJackHwang/ds2api/blob/main/internal/
//
// DSWebClient wraps a single DeepSeek web session cookie and exposes a single
// `streamChat` method that the OpenAI-shaped proxy translates into. The v1
// implementation is mocked: it returns a fixed sequence of small chunks
// (an echoed prompt with a "[mock]" prefix), spread over ~1.2s to exercise
// the streaming path end-to-end.

import type { WebSession } from './session.js';

export type DSWebEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'finish' };

export interface StreamChatOptions {
  reasoning: boolean;
}

export class DSWebClient {
  constructor(private readonly session: WebSession) {}

  /**
   * v1 mock: emit a small thinking trace (when `reasoning` is true) followed
   * by a chunked echo of the prompt with a "[mock]" prefix, then finish.
   * Total duration ~1.2s so callers can verify streaming behaviour.
   */
  async *streamChat(prompt: string, opts: StreamChatOptions): AsyncGenerator<DSWebEvent> {
    void this.session; // referenced so the unused-private check stays quiet
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    if (opts.reasoning) {
      const thoughts = ['Thinking', ' about', ' the', ' prompt', '…'];
      for (const t of thoughts) {
        yield { kind: 'thinking', text: t };
        await sleep(60);
      }
    }

    const reply = `[mock] ${prompt}`;
    // Chunk the reply into ~6-char slices so streaming is visible.
    const chunkSize = 6;
    for (let i = 0; i < reply.length; i += chunkSize) {
      const slice = reply.slice(i, i + chunkSize);
      yield { kind: 'text', text: slice };
      await sleep(60);
    }
    yield { kind: 'finish' };
  }
}
