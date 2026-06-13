import type { SiteAdapter, Transcript } from '../adapters/types';
import { estimateTokensText } from '../core/tokens';

/**
 * Handoff flow (M2). All user-driven, nothing automated:
 *
 *   idle ──start()──▶ armed: the handoff prompt is pre-filled into the
 *     chat input. THE USER presses send (or cancels).
 *   armed ──prompt appears in transcript──▶ capturing: the user sent it;
 *     we wait for the assistant's reply to finish streaming.
 *   capturing ──completed reply found──▶ done: response captured, shown
 *     in the panel with the compression ratio.
 *
 * Detection is marker-based: the prompt contains USER_MARKER, so the
 * sent prompt is identifiable in the transcript, and the first completed
 * assistant message after it is the summary. Result text lives in memory
 * only — never persisted, never transmitted.
 */

export const HANDOFF_PROMPT = `Please write a HANDOFF SUMMARY of this conversation so I can continue it seamlessly in a fresh chat. Start your reply with the exact line:
=== HANDOFF SUMMARY ===
Then, in concise markdown:
1. **Goal** — what we're working on and why.
2. **Decisions** — every settled decision, with one line of reasoning each.
3. **Current state** — what's done and what's in progress; exact names, files, versions, numbers.
4. **Open threads** — unresolved questions and the immediate next step.
5. **Key facts** — constraints, preferences, links, and details I'd otherwise have to repeat.
6. **Tone & format** — how I like answers written.
Be dense and specific. No filler, no praise, no commentary about this request — the summary alone should let a fresh session pick up exactly where we left off.`;

const USER_MARKER = 'HANDOFF SUMMARY';
const MIN_RESULT_CHARS = 80;

export type HandoffPhase = 'idle' | 'confirm-replace' | 'armed' | 'capturing' | 'done';

export interface HandoffView {
  phase: HandoffPhase;
  resultText: string;
  baselineTokens: number;
  resultTokens: number;
  /** % of baseline tokens saved by the summary, clamped to [0, 99.9]. */
  compressionPct: number;
}

export interface HandoffController {
  view(): HandoffView;
  start(): void;
  cancel(): void;
  onUpdate(
    transcript: Transcript,
    convoId: string,
    tokens: number,
    charsPerToken: number
  ): void;
}

export function createHandoff(
  adapter: SiteAdapter,
  onChange: () => void
): HandoffController {
  let phase: HandoffPhase = 'idle';
  let baselineTokens = 0;
  let resultText = '';
  let resultTokens = 0;
  let lastTokens = 0;
  let convoId: string | null = null;

  const reset = () => {
    phase = 'idle';
    baselineTokens = 0;
    resultText = '';
    resultTokens = 0;
  };

  return {
    view(): HandoffView {
      const compressionPct =
        baselineTokens > 0 && resultTokens > 0
          ? Math.min(99.9, Math.max(0, (1 - resultTokens / baselineTokens) * 100))
          : 0;
      return { phase, resultText, baselineTokens, resultTokens, compressionPct };
    },

    start() {
      try {
        if (phase === 'done') reset();
        const draft = adapter.readDraft().trim();
        if (draft && draft !== HANDOFF_PROMPT && phase !== 'confirm-replace') {
          phase = 'confirm-replace';
          onChange();
          return;
        }
        adapter
          .prefillInput(HANDOFF_PROMPT)
          .then((ok) => {
            if (ok) {
              // Baseline = the conversation as it stands before the
              // handoff exchange is sent; the "before" of the ratio.
              baselineTokens = lastTokens;
              phase = 'armed';
            } else {
              phase = 'idle';
            }
            onChange();
          })
          .catch(() => {});
        onChange();
      } catch {
        // degrade silently
      }
    },

    cancel() {
      reset();
      onChange();
    },

    onUpdate(transcript, convo, tokens, charsPerToken) {
      if (convo !== convoId) {
        convoId = convo;
        reset();
      }
      lastTokens = tokens;
      if (phase !== 'armed' && phase !== 'capturing') return;

      let promptIdx = -1;
      for (let i = transcript.messages.length - 1; i >= 0; i--) {
        const m = transcript.messages[i];
        if (m.role === 'user' && m.text.includes(USER_MARKER)) {
          promptIdx = i;
          break;
        }
      }
      if (promptIdx === -1) return; // still armed; the user hasn't sent it

      if (phase === 'armed') {
        phase = 'capturing';
        onChange();
      }

      for (let i = promptIdx + 1; i < transcript.messages.length; i++) {
        const m = transcript.messages[i];
        if (m.role !== 'assistant') continue;
        if (m.streaming || transcript.anyStreaming) return; // not finished
        const text = m.text.trim();
        if (text.length < MIN_RESULT_CHARS) return;
        resultText = text;
        resultTokens = estimateTokensText(text, charsPerToken);
        phase = 'done';
        onChange();
        return;
      }
    },
  };
}
