import cssText from './ui/meter.css?inline';
import type { SiteAdapter } from '../adapters/types';
import { recordAttachment } from '../core/attachments';
import { cyrb53 } from '../core/hash';
import { budgetFor, type Settings } from '../core/settings';
import { estimateTokensText, formatTokenCount } from '../core/tokens';
import {
  collapseBlankLines,
  looksLineNumbered,
  stripLineNumbers,
  stripTrailingWhitespace,
} from '../core/cleanups';
import { detectDarkTheme } from './ui/theme';

/**
 * Send-side cost meter (M3):
 *
 *  - A small chip anchored above the chat input shows the estimated token
 *    cost of the current draft before it's sent.
 *  - A paste auditor: when a (real, user-initiated) paste exceeds the
 *    configured token threshold, a card flags its cost and % of context
 *    and offers opt-in LOCAL cleanups. Cleanups rewrite the whole draft
 *    via adapter.prefillInput — nothing is ever sent or transmitted.
 *
 * Self-contained: owns its listeners, its shadow host, and its lifecycle.
 * Synthetic pastes (our own prefill) are ignored via isTrusted, so the
 * handoff flow and cleanup re-pastes never re-trigger the auditor.
 */

const UPDATE_DEBOUNCE_MS = 150;
const POLL_MS = 1000;
/** % of the budget at which the chip switches to the warning style. */
const CHIP_WARN_PCT = 2;

interface CleanupOption {
  id: string;
  label: string;
  apply: (text: string) => string;
}

export interface DraftMeter {
  destroy(): void;
}

export function createDraftMeter(
  adapter: SiteAdapter,
  getSettings: () => Settings
): DraftMeter {
  const host = document.createElement('div');
  host.setAttribute('data-chathp-meter', '');
  host.style.cssText = 'position:fixed;z-index:2147483645;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${cssText}</style>
    <div class="meter" data-theme="dark">
      <div class="audit" hidden></div>
      <div class="chip" hidden>
        <span class="glyph">&#9998;</span>
        <span class="chip-text"></span>
      </div>
    </div>
  `;
  const root = shadow.querySelector<HTMLElement>('.meter')!;
  const auditEl = shadow.querySelector<HTMLElement>('.audit')!;
  const chipEl = shadow.querySelector<HTMLElement>('.chip')!;
  const chipText = shadow.querySelector<HTMLElement>('.chip-text')!;
  document.documentElement.appendChild(host);

  let auditPasteTokens = 0; // 0 = no active audit
  let visible = false;
  // While a cleanup rewrite is in flight the draft is transiently empty
  // (clear → reconcile → paste); don't mistake that for the user clearing
  // the input and resetting the audit.
  let applyingCleanup = false;

  const hasLineBreakLayoutIssue = () => adapter.hasSpaciousLineBreaks?.() ?? false;

  const cleanupOptions = (draft: string, pasted: string): CleanupOption[] => {
    const opts: CleanupOption[] = [
      { id: 'trim', label: 'Trim trailing spaces', apply: stripTrailingWhitespace },
      { id: 'blank', label: 'Collapse blank lines', apply: collapseBlankLines },
    ];
    if (looksLineNumbered(pasted) || looksLineNumbered(draft)) {
      opts.push({ id: 'nums', label: 'Strip line numbers', apply: stripLineNumbers });
    }
    return opts;
  };

  let lastPastedText = '';

  const positionAnchor = (input: HTMLElement): HTMLElement => {
    const form = input.closest('form');
    return form instanceof HTMLElement ? form : input;
  };

  const position = (input: HTMLElement) => {
    const rect = positionAnchor(input).getBoundingClientRect();
    host.style.left = 'auto';
    host.style.top = 'auto';
    host.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
    host.style.bottom = `${Math.max(4, window.innerHeight - rect.top + 8)}px`;
  };

  const hide = () => {
    if (!visible) return;
    host.style.display = 'none';
    visible = false;
  };

  const renderAudit = (draft: string, settings: Settings) => {
    const budget = budgetFor(settings, adapter.id);
    const pct = budget > 0 ? (auditPasteTokens / budget) * 100 : 0;

    // claude.ai converts big pastes into a file attachment, so the text
    // never reaches the input. Cleanups can't apply there — but the cost
    // report is extra valuable, since the draft meter can't see
    // attachments at all. Detect by checking whether the paste's first
    // non-empty line actually landed in the draft.
    const probe = lastPastedText
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0)
      ?.slice(0, 40);
    const landedInline = !!probe && draft.includes(probe);

    if (!landedInline) {
      auditEl.innerHTML = `
        <div class="audit-title">Large paste: ~${formatTokenCount(auditPasteTokens)} tokens</div>
        <div class="audit-sub">${pct >= 0.05 ? `&asymp;${pct.toFixed(1)}% of context. ` : ''}It was attached as a file, so it still costs this much when sent &mdash; text cleanups don't apply to attachments.</div>
        <button class="abtn dismiss" data-cleanup="dismiss">Dismiss</button>
      `;
      auditEl.hidden = false;
      return;
    }

    const lineBreakLayoutIssue = hasLineBreakLayoutIssue();
    const options = cleanupOptions(draft, lastPastedText)
      .map((opt) => {
        const saved =
          estimateTokensText(draft, settings.charsPerToken) -
          estimateTokensText(opt.apply(draft), settings.charsPerToken);
        return { ...opt, saved, fixesLayout: opt.id === 'blank' && lineBreakLayoutIssue };
      })
      .filter((opt) => opt.saved > 0 || opt.fixesLayout);

    const buttons = options
      .map(
        (opt) => {
          const badge =
            opt.saved > 0
              ? `&minus;~${formatTokenCount(opt.saved)} tok`
              : opt.fixesLayout
                ? 'fix spacing'
                : '';
          return (
            `<button class="abtn" data-cleanup="${opt.id}">${opt.label}` +
            (badge ? `<span class="save">${badge}</span>` : '') +
            `</button>`
          );
        }
      )
      .join('');

    auditEl.innerHTML = `
      <div class="audit-title">Large paste: ~${formatTokenCount(auditPasteTokens)} tokens</div>
      <div class="audit-sub">${pct >= 0.05 ? `&asymp;${pct.toFixed(1)}% of context &middot; ` : ''}optional local cleanups (whole draft):</div>
      ${buttons || '<div class="audit-sub">No automatic savings found.</div>'}
      <button class="abtn dismiss" data-cleanup="dismiss">Dismiss</button>
    `;
    auditEl.hidden = false;
  };

  const update = () => {
    try {
      const settings = getSettings();
      if (settings.sites[adapter.id] === false) return hide();
      const input = adapter.findChatInput();
      if (!input) return hide();

      // Cheap emptiness probe first; innerText (in readDraft) only when
      // there is actually content.
      if ((input.textContent ?? '').trim().length === 0) {
        if (!applyingCleanup) {
          auditPasteTokens = 0;
          auditEl.hidden = true;
        }
        return hide();
      }

      const draft = adapter.readDraft();
      const tokens = estimateTokensText(draft.trim(), settings.charsPerToken);
      const showChip = settings.features.draftMeter && tokens >= settings.draftMinTokens;
      const showAudit = settings.features.pasteAudit && auditPasteTokens > 0;
      if (!showChip && !showAudit) return hide();

      root.dataset.theme = detectDarkTheme() ? 'dark' : 'light';

      chipEl.hidden = !showChip;
      if (showChip) {
        const budget = budgetFor(settings, adapter.id);
        const pct = budget > 0 ? (tokens / budget) * 100 : 0;
        chipText.textContent =
          `~${formatTokenCount(tokens)} tok` + (pct >= 1 ? ` · ${pct.toFixed(1)}%` : '');
        chipEl.classList.toggle('big', pct >= CHIP_WARN_PCT);
        chipEl.title = `Estimated cost of this draft: ~${tokens} tokens`;
      }

      if (showAudit) renderAudit(draft, settings);
      else auditEl.hidden = true;

      position(input);
      if (!visible) {
        host.style.display = '';
        visible = true;
      }
    } catch {
      // degrade silently
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleUpdate = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(update, UPDATE_DEBOUNCE_MS);
  };

  const onInput = () => scheduleUpdate();

  const onPaste = (e: ClipboardEvent) => {
    try {
      // Only real user pastes: our own prefill/cleanup pastes are
      // synthetic (isTrusted false). __chathpTest is a dev-only hook.
      if (!e.isTrusted && !('__chathpTest' in e)) return;
      const settings = getSettings();
      // Site-disabled stops everything; the pasteAudit toggle only gates
      // the audit UI below — the attachment ledger runs regardless.
      if (settings.sites[adapter.id] === false) return;
      const input = adapter.findChatInput();
      if (!input) return;
      const target = e.target;
      if (!(target instanceof Node) || (target !== input && !input.contains(target))) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const tokens = estimateTokensText(text, settings.charsPerToken);
      if (tokens < settings.pasteAuditMinTokens) return;
      // Attachment ledger: improves the core estimate even when the audit
      // UI is off. After the editor ingests, if the paste did NOT land in
      // the (transcript-able) draft, it became a hidden file attachment —
      // record its cost so the health total reflects it.
      setTimeout(() => {
        try {
          const convoId = adapter.conversationId(location);
          if (!convoId) return; // new chat: skip (low value, id-transfer churn)
          const probe = text
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.length > 0)
            ?.slice(0, 40);
          const draft = adapter.readDraft();
          const landedInline = !!probe && draft.includes(probe);
          if (!landedInline) recordAttachment(convoId, cyrb53(text), tokens);
        } catch {
          // degrade silently
        }
      }, UPDATE_DEBOUNCE_MS + 80);
      if (!settings.features.pasteAudit) return;
      lastPastedText = text;
      auditPasteTokens = tokens;
      setTimeout(update, UPDATE_DEBOUNCE_MS); // let the editor ingest first
    } catch {
      // degrade silently
    }
  };

  const onReposition = (e?: Event) => {
    if (!visible) return;
    try {
      const input = adapter.findChatInput();
      if (!input) return;
      const target = e?.target;
      if (target instanceof Node) {
        const anchor = positionAnchor(input);
        if (target === input || input.contains(target) || target === anchor) return;
      }
      position(input);
    } catch {
      // degrade silently
    }
  };

  auditEl.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const btn = (e.target as HTMLElement).closest('[data-cleanup]');
    if (!(btn instanceof HTMLElement)) return;
    const id = btn.getAttribute('data-cleanup');
    if (id === 'dismiss') {
      auditPasteTokens = 0;
      auditEl.hidden = true;
      update();
      return;
    }
    try {
      const draft = adapter.readDraft();
      const opt = cleanupOptions(draft, lastPastedText).find((o) => o.id === id);
      if (!opt) return;
      const cleaned = opt.apply(draft);
      const compactLineBreaks =
        id === 'blank' && hasLineBreakLayoutIssue() && adapter.compactInputLineBreaks;
      if (cleaned !== draft || compactLineBreaks) {
        // The cleaned draft is the audit subject now — keeps the inline
        // detection (and remaining cleanup offers) consistent after the
        // rewrite alters the original paste's first line.
        lastPastedText = cleaned;
        applyingCleanup = true;
        void (compactLineBreaks
          ? adapter.compactInputLineBreaks!(cleaned)
          : adapter.prefillInput(cleaned)
        )
          .then(() => {
            applyingCleanup = false;
            update();
          })
          .catch(() => {
            applyingCleanup = false;
          });
      } else {
        update();
      }
    } catch {
      // degrade silently
    }
  });

  document.addEventListener('input', onInput, true);
  document.addEventListener('paste', onPaste, true);
  window.addEventListener('resize', onReposition);
  window.addEventListener('scroll', onReposition, true);
  const poll = setInterval(update, POLL_MS);

  return {
    destroy() {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('paste', onPaste, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      clearInterval(poll);
      if (timer !== null) clearTimeout(timer);
      host.remove();
    },
  };
}
