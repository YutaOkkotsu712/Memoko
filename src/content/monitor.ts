import type { SiteAdapter, TranscriptMessage } from '../adapters/types';
import { attachmentTokens } from '../core/attachments';
import { burnPerMin, minutesUntil, pruneSamples, type BurnSample } from '../core/burn';
import { debounce } from '../core/debounce';
import { matchModelBudget } from '../core/models';
import {
  budgetFor,
  loadCoachMark,
  loadConversationEstimate,
  loadOnboarded,
  loadPillState,
  loadSettings,
  onSettingsChanged,
  reportAdapterHealth,
  saveConversationEstimate,
  saveCoachMark,
  saveOnboarded,
  savePillState,
  stashHandoff,
  takeHandoffStash,
  type AdapterStatus,
  type ConversationEstimate,
  type Settings,
} from '../core/settings';
import {
  effectiveLoadPct,
  healthState,
  mergeReloadEstimate,
  type HealthState,
} from '../core/health';
import { estimateTokensText } from '../core/tokens';
import { MEMOKO_STATUS } from './ui/avatar';
import { detectWaste, EMPTY_WASTE, type WasteReport } from '../core/waste';
import { createDraftMeter } from './draftMeter';
import { createHandoff } from './handoff';
import { createPill, hydrateStats, type PillStats, type PillUI } from './ui/pill';

const RECOMPUTE_DEBOUNCE_MS = 400;
const AGE_REFRESH_MS = 30_000;

export async function startMonitor(adapter: SiteAdapter): Promise<void> {
  let settings: Settings = await loadSettings();
  const pillState = await loadPillState();

  let uiRef: PillUI | null = null;
  let canStartHandoff = false;
  let lastMessages: ReadonlyArray<TranscriptMessage> = [];

  // Clickable Duplicates row: cycle through the duplicate blocks,
  // scrolling each into view with a brief highlight (WAAPI — no styles
  // injected into the host page, cleans itself up).
  let dupCycle = 0;
  const showDuplicates = () => {
    try {
      const refs = waste.refs;
      if (refs.length === 0) return;
      for (let attempt = 0; attempt < refs.length; attempt++) {
        const ref = refs[dupCycle % refs.length]!;
        dupCycle++;
        if (flashMessage(lastMessages[ref.messageIndex]?.el)) return;
      }
    } catch {
      // degrade silently
    }
  };
  const refreshHandoffUI = () => {
    try {
      uiRef?.updateHandoff(handoff.view(), canStartHandoff, settings.features.handoff);
    } catch {
      // degrade silently
    }
  };
  const handoff = createHandoff(adapter, refreshHandoffUI);

  // Hydrate lifetime stats before the pill reads them (no first-paint zero).
  await hydrateStats();

  const ui = createPill({
    initial: pillState,
    onPersist: savePillState,
    callbacks: {
      onHandoffStart: () => handoff.start(),
      onHandoffCancel: () => handoff.cancel(),
      onShowDuplicates: () => showDuplicates(),
      onJumpToHeavy: () => jumpToHeavy(),
      onOpenNewChat: () => {
        try {
          // Carry the summary into the fresh chat: the content script
          // there prefills it (single-use, session-scoped, user sends).
          const v = handoff.view();
          if (v.phase === 'done' && v.resultText) {
            void stashHandoff(adapter.id, v.resultText);
          }
          window.open(adapter.newChatUrl(), '_blank');
        } catch {
          // degrade silently
        }
      },
    },
  });
  uiRef = ui;

  // Independent of the pill: works wherever the site has a chat input
  // (including the new-chat page, where there is no conversation id).
  createDraftMeter(adapter, () => settings);

  // When the user first opened each conversation in this tab. SPA
  // navigation is detected purely by conversationId changing between
  // recomputes — DOM mutations always accompany a route change, so the
  // MutationObserver doubles as our navigation hook.
  const firstSeen = new Map<string, number>();
  let visible = false;

  // Session-only token floor for the current conversation. This protects
  // against host apps remounting only a visible slice after reload.
  let estimateConvo: string | null = null;
  let estimateCache: ConversationEstimate | null = null;
  let estimateLoadSeq = 0;
  let estimateLoading = false;

  const ensureEstimateCache = (convoId: string): boolean => {
    if (estimateConvo === convoId) return !estimateLoading;
    estimateConvo = convoId;
    estimateCache = null;
    estimateLoading = true;
    const seq = ++estimateLoadSeq;
    void loadConversationEstimate(adapter.id, convoId)
      .then((estimate) => {
        if (seq !== estimateLoadSeq || estimateConvo !== convoId) return;
        estimateCache = estimate;
        estimateLoading = false;
        scheduleRecompute();
      })
      .catch(() => {
        if (seq !== estimateLoadSeq || estimateConvo !== convoId) return;
        estimateLoading = false;
        scheduleRecompute();
      });
    return false;
  };

  const rememberEstimate = (next: ConversationEstimate): void => {
    // Overwrite, NOT monotonic-max. The stored estimate tracks the last
    // SETTLED observed value, so a transient over-count or a stale
    // high-water mark self-heals downward instead of ratcheting forever
    // (the old monotonic gate was the cause of reloads inflating the bar).
    const prev = estimateCache;
    if (
      prev &&
      prev.charsPerToken === next.charsPerToken &&
      prev.tokens === next.tokens &&
      prev.messageCount === next.messageCount &&
      prev.charCount === next.charCount &&
      prev.dupTokens === next.dupTokens &&
      prev.dupBlocks === next.dupBlocks
    ) {
      return; // unchanged — skip the storage write
    }
    estimateCache = next;
    saveConversationEstimate(next);
  };

  // Waste analysis is a full-transcript pass, so it's gated (only when
  // nothing is streaming and the transcript changed) AND deferred to
  // idle time — it must not block the main thread right as a long
  // response finishes rendering.
  let waste: WasteReport = EMPTY_WASTE;
  let wasteAnalyzedAt = -1;
  let wastePending = false;
  const scheduleWasteAnalysis = (
    messages: ReadonlyArray<{ text: string }>,
    charCount: number
  ) => {
    if (wastePending) return;
    wastePending = true;
    const run = () => {
      try {
        waste = detectWaste(messages);
        wasteAnalyzedAt = charCount;
      } catch {
        waste = EMPTY_WASTE;
      }
      wastePending = false;
      scheduleRecompute(); // repaint with the fresh numbers
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 50);
    }
  };

  // Memoko speech bubbles: one-shot lines on upward health transitions,
  // rate-limited; the first-ever Heavy gets a coach mark pointing at the
  // handoff feature (persisted so it shows exactly once, ever).
  const SEVERITY: Record<HealthState, number> = { fresh: 0, healthy: 1, heavy: 2, critical: 3 };
  const COACH_COPY =
    "Memoko's getting tired — this is what Generate handoff is for. Click my pill!";
  const BUBBLE_COOLDOWN_MS = 120_000;
  let lastBubbleState: HealthState | null = null;
  let lastBubbleAt = 0;
  let coachedHeavy = true; // pessimistic until storage answers
  void loadCoachMark()
    .then((done) => {
      coachedHeavy = done;
    })
    .catch(() => {});

  const computeBubble = (state: HealthState): string | undefined => {
    const prev = lastBubbleState;
    lastBubbleState = state;
    if (!settings.features.bubbles) return undefined;
    if (prev === null || SEVERITY[state] <= SEVERITY[prev]) return undefined;
    if ((state === 'heavy' || state === 'critical') && !coachedHeavy) {
      coachedHeavy = true;
      saveCoachMark();
      lastBubbleAt = Date.now();
      return COACH_COPY;
    }
    if (Date.now() - lastBubbleAt < BUBBLE_COOLDOWN_MS) return undefined;
    lastBubbleAt = Date.now();
    return MEMOKO_STATUS[state];
  };

  // Toolbar badge: usage % for this tab, routed through the service
  // worker (content scripts can't touch chrome.action). Deduped sends.
  let lastBadgeKey = '';
  const pushBadge = (text: string, state: HealthState | '') => {
    const key = `${text}:${state}`;
    if (key === lastBadgeKey) return;
    lastBadgeKey = key;
    try {
      void chrome.runtime.sendMessage({ type: 'chathp:badge', text, state }).catch(() => {});
    } catch {
      // extension context gone — non-fatal
    }
  };

  // Per-message token cache. The adapters return STABLE string references
  // for unchanged messages (their per-element cache), so reference
  // equality at the same index is enough to reuse a count — no hashing,
  // no re-walk. During streaming exactly one message misses.
  let lastCpt = 0;
  let lastTexts: string[] = [];
  let lastCounts: number[] = [];
  const transcriptTokens = (
    messages: ReadonlyArray<{ text: string }>,
    cpt: number
  ): number => {
    if (cpt !== lastCpt) {
      lastTexts = [];
      lastCounts = [];
      lastCpt = cpt;
    }
    const texts: string[] = new Array(messages.length);
    const counts: number[] = new Array(messages.length);
    let total = 0;
    for (let i = 0; i < messages.length; i++) {
      const text = messages[i]!.text;
      const t = text === lastTexts[i] ? lastCounts[i]! : estimateTokensText(text, cpt);
      texts[i] = text;
      counts[i] = t;
      total += t;
    }
    lastTexts = texts;
    lastCounts = counts;
    return total;
  };

  // Burn-rate samples for the current conversation (in-memory only).
  let burnSamples: BurnSample[] = [];
  let burnConvo: string | null = null;

  // Reload/nav floor state. The restored estimate is a floor ONLY while
  // the transcript is still rendering; it's released the moment the live
  // DOM catches up to it, or after a short grace window, so a stale
  // persisted high-water mark can't pin the bar after reload.
  const FLOOR_GRACE_MS = 4000;
  let floorConvo: string | null = null;
  let floorReleased = false;
  let floorSince = 0;

  // "Heaviest messages" — top token consumers, cycled on row click.
  const TOP_MIN_TOKENS = 500;
  let topHeavy: Array<{ index: number; role: string; tokens: number }> = [];
  let heavyCycle = 0;

  const flashMessage = (el: HTMLElement | undefined) => {
    if (!el || !el.isConnected) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate(
      [
        { boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.55)' },
        { boxShadow: '0 0 0 4px rgba(245, 158, 11, 0)' },
      ],
      { duration: 1600, easing: 'ease-out' }
    );
    return true;
  };

  const jumpToHeavy = () => {
    try {
      for (let attempt = 0; attempt < topHeavy.length; attempt++) {
        const ref = topHeavy[heavyCycle % topHeavy.length]!;
        heavyCycle++;
        if (flashMessage(lastMessages[ref.index]?.el)) return;
      }
    } catch {
      // degrade silently
    }
  };

  const hide = () => {
    pushBadge('', '');
    if (!visible) return;
    ui.hide();
    visible = false;
  };

  // Safety valve for the adapters' per-element text caches: every 30s
  // tick forces one full DOM re-read, bounding any staleness from
  // in-place mutations of old messages.
  let wantFresh = false;

  // Health heartbeat for the popup's per-site status row. "no-match" is
  // only meaningful once the SPA has had time to render, and writes are
  // throttled to status changes / a slow refresh.
  const bootAt = Date.now();
  let lastHealth: { status: AdapterStatus; model: string; at: number } | null = null;
  const noteHealth = (status: AdapterStatus, model?: string, budget?: number) => {
    if (status === 'no-match' && Date.now() - bootAt < 8000) return;
    // Re-report on status OR model change, else throttle to 5 min.
    if (
      lastHealth &&
      lastHealth.status === status &&
      lastHealth.model === (model ?? '') &&
      Date.now() - lastHealth.at < 300_000
    ) {
      return;
    }
    lastHealth = { status, model: model ?? '', at: Date.now() };
    reportAdapterHealth(adapter.id, status, { model, budget });
  };

  // If a handoff summary was stashed for this site and this is a fresh
  // (non-conversation) page, prefill it. The stash is taken only after
  // an input exists, so a slow page can't burn the single-use entry.
  const consumeHandoffStash = async () => {
    try {
      if (adapter.conversationId(location)) return;
      for (let i = 0; i < 6; i++) {
        const input = adapter.findChatInput();
        if (input) {
          const text = await takeHandoffStash(adapter.id);
          if (text) await adapter.prefillInput(text);
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch {
      // degrade silently
    }
  };
  void consumeHandoffStash();

  // Background tabs do zero work: mutations during a backgrounded stream
  // just set a flag, and one fresh recompute runs when the tab returns.
  let pendingWhileHidden = false;

  const recompute = () => {
    try {
      if (document.visibilityState === 'hidden') {
        pendingWhileHidden = true;
        return;
      }
      if (settings.sites[adapter.id] === false) return hide();

      const convoId = adapter.conversationId(location);
      if (!convoId) return hide();
      const estimateReady = ensureEstimateCache(convoId);
      if (!estimateReady && !visible) return;

      const fresh = wantFresh;
      wantFresh = false;
      const transcript = adapter.readTranscript(fresh ? { fresh: true } : undefined);
      if (!transcript) {
        noteHealth('no-match');
        return hide();
      }
      // Model-aware budget: detect the page's model and use its context
      // window; fall back to the manual per-site budget.
      const detected =
        settings.features.autoBudget && adapter.detectModel
          ? matchModelBudget(adapter.detectModel())
          : null;
      const budget = detected?.budget ?? budgetFor(settings, adapter.id);

      noteHealth(
        transcript.messages.length > 0 ? 'ok' : 'no-match',
        detected?.name,
        detected ? budget : undefined
      );
      lastMessages = transcript.messages;

      if (!firstSeen.has(convoId)) firstSeen.set(convoId, Date.now());
      const now = Date.now();

      const observedTokens = transcriptTokens(transcript.messages, settings.charsPerToken);
      const matchingEstimate =
        estimateCache && estimateCache.charsPerToken === settings.charsPerToken
          ? estimateCache
          : null;
      // Convert duplicate chars at the transcript's MEASURED density, so
      // dup numbers stay consistent with the headline estimate.
      const observedBlendedCpt =
        observedTokens > 0 ? transcript.charCount / observedTokens : settings.charsPerToken;
      const observedDupTokens = Math.round(waste.avoidableChars / Math.max(0.5, observedBlendedCpt));

      // Floor release: as soon as the live transcript reaches the restored
      // floor (caught up — no bounce), or the grace window lapses (a stale
      // high floor that live will never reach — drop to live). Either way
      // the bar converges to the live DOM rather than a frozen value.
      if (floorConvo !== convoId) {
        floorConvo = convoId;
        floorReleased = false;
        floorSince = now;
        // A fully-rendered static page fires no more mutations, so ensure
        // one recompute lands after the grace window to release the floor.
        setTimeout(() => {
          wantFresh = true;
          scheduleRecompute();
        }, FLOOR_GRACE_MS + 200);
      }
      const floorTokens = matchingEstimate?.tokens ?? 0;
      if (
        !floorReleased &&
        !transcript.anyStreaming &&
        (observedTokens >= floorTokens || now - floorSince > FLOOR_GRACE_MS)
      ) {
        floorReleased = true;
      }

      // Once released, trust the live DOM; only apply the restored floor
      // during the active render window.
      const merged = floorReleased
        ? {
            baseTokens: observedTokens,
            messageCount: transcript.messages.length,
            dupTokens: observedDupTokens,
            dupBlocks: waste.blocks,
          }
        : mergeReloadEstimate(
            {
              observedTokens,
              observedMessageCount: transcript.messages.length,
              observedDupTokens,
              observedDupBlocks: waste.blocks,
            },
            matchingEstimate
          );
      const baseTokens = merged.baseTokens;
      // Attachment tokens are added AFTER the restored transcript floor so the
      // cache never folds them back in on the next tick.
      const attachedTokens = attachmentTokens(convoId);
      const tokens = baseTokens + attachedTokens;
      const usagePct = budget > 0 ? (tokens / budget) * 100 : 0;

      // Burn rate: sample settled token counts for this conversation.
      if (burnConvo !== convoId) {
        burnConvo = convoId;
        burnSamples = [];
        heavyCycle = 0;
        dupCycle = 0;
        waste = EMPTY_WASTE;
        wasteAnalyzedAt = -1;
        wastePending = false;
      }
      if (!transcript.anyStreaming && transcript.charCount !== wasteAnalyzedAt) {
        scheduleWasteAnalysis(transcript.messages, transcript.charCount);
      }
      // Sample once the transcript is fully loaded (cache not inflating
      // past what we observe); the sampled total includes attachments.
      if (!transcript.anyStreaming && observedTokens === baseTokens) {
        const lastSample = burnSamples[burnSamples.length - 1];
        if (!lastSample || lastSample.tokens !== tokens) {
          burnSamples.push({ at: now, tokens });
        }
        burnSamples = pruneSamples(burnSamples, now);
      }
      const perMin = burnPerMin(burnSamples);
      const criticalTokens = (budget * settings.thresholds.critical) / 100;
      const minutesToCritical = minutesUntil(tokens, criticalTokens, perMin);

      // Token breakdown: who's spending, and the heaviest messages.
      let userTokens = 0;
      for (let i = 0; i < transcript.messages.length; i++) {
        if (transcript.messages[i]!.role === 'user') userTokens += lastCounts[i] ?? 0;
      }
      topHeavy = lastCounts
        .map((t, index) => ({ index, role: transcript.messages[index]!.role, tokens: t }))
        .filter((x) => x.tokens >= TOP_MIN_TOKENS)
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 3);
      const heaviest = topHeavy[0]
        ? { ordinal: topHeavy[0].index + 1, role: topHeavy[0].role, tokens: topHeavy[0].tokens }
        : null;

      const { dupTokens, dupBlocks, messageCount } = merged;
      const adjustedPct = effectiveLoadPct({
        usagePct,
        messageCount,
        dupTokens,
        budget,
      });
      // Persist only the SETTLED observed value (released + not streaming,
      // never the floor or a partial render) so the stored estimate
      // reflects what's truly in the conversation and can decrease.
      if (floorReleased && !transcript.anyStreaming) {
        rememberEstimate({
          siteId: adapter.id,
          conversationId: convoId,
          tokens: observedTokens,
          charsPerToken: settings.charsPerToken,
          messageCount: transcript.messages.length,
          charCount: transcript.charCount,
          dupTokens: observedDupTokens,
          dupBlocks: waste.blocks,
          at: now,
        });
      }

      const stats: PillStats = {
        usagePct,
        adjustedPct,
        state: healthState(adjustedPct, settings.thresholds),
        tokens,
        budget,
        messageCount,
        ageMs: Date.now() - (firstSeen.get(convoId) ?? Date.now()),
        streaming: transcript.anyStreaming,
        dupTokens,
        dupBlocks,
        attachedTokens,
        bubble: computeBubble(healthState(adjustedPct, settings.thresholds)),
        burnTokensPerMin: perMin,
        minutesToCritical,
        userSharePct:
          observedTokens > 0 && observedTokens === baseTokens
            ? (userTokens / observedTokens) * 100
            : null,
        heaviest,
      };

      ui.update(stats);
      pushBadge(
        settings.features.badge ? `${Math.min(99, Math.round(usagePct))}%` : '',
        stats.state
      );
      canStartHandoff = transcript.messages.length > 0 && !transcript.anyStreaming;
      handoff.onUpdate(transcript, convoId, tokens, settings.charsPerToken);
      refreshHandoffUI();
      if (!visible) {
        ui.show();
        visible = true;
        maybeOnboard();
      }
    } catch {
      // degrade silently
    }
  };

  let onboardChecked = false;
  const maybeOnboard = () => {
    if (onboardChecked) return;
    onboardChecked = true;
    void loadOnboarded()
      .then((done) => {
        if (!done) ui.showOnboarding(saveOnboarded);
      })
      .catch(() => {});
  };

  const scheduleRecompute = debounce(recompute, RECOMPUTE_DEBOUNCE_MS);

  onSettingsChanged((next) => {
    settings = next;
    scheduleRecompute();
  });

  let observeRoot: Node;
  try {
    observeRoot = adapter.observeRoot();
  } catch {
    observeRoot = document.body;
  }
  const observer = new MutationObserver(scheduleRecompute);
  observer.observe(observeRoot, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-is-streaming'],
  });

  window.addEventListener('popstate', scheduleRecompute);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingWhileHidden) {
      pendingWhileHidden = false;
      wantFresh = true;
      scheduleRecompute();
    }
  });

  // Keyboard shortcuts, relayed by the service worker (chrome.commands).
  try {
    chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
      // Only our own service worker may drive the UI (defense-in-depth;
      // the host page can't reach chrome.runtime anyway).
      if (sender.id !== chrome.runtime.id) return;
      const m = msg as { type?: string; command?: string };
      if (!m || m.type !== 'chathp:command' || !visible) return;
      if (m.command === 'toggle-panel') {
        ui.togglePanel();
      } else if (
        m.command === 'generate-handoff' &&
        settings.features.handoff &&
        canStartHandoff
      ) {
        handoff.start();
      }
    });
  } catch {
    // extension context unavailable — shortcuts just won't work
  }

  // Keep "Watching" age fresh while idle, and force a full text re-read
  // through the adapter caches once per interval.
  setInterval(() => {
    if (visible) {
      wantFresh = true;
      scheduleRecompute();
    }
  }, AGE_REFRESH_MS);

  recompute();
}
