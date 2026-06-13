export type HealthState = 'fresh' | 'healthy' | 'heavy' | 'critical';

export interface Thresholds {
  /** Usage % at which Fresh becomes Healthy. */
  healthy: number;
  /** Usage % at which Healthy becomes Heavy. */
  heavy: number;
  /** Usage % at which Heavy becomes Critical. */
  critical: number;
}

export const STATE_LABEL: Record<HealthState, string> = {
  fresh: 'Fresh',
  healthy: 'Healthy',
  heavy: 'Heavy',
  critical: 'Critical',
};

export function healthState(usagePct: number, t: Thresholds): HealthState {
  if (usagePct >= t.critical) return 'critical';
  if (usagePct >= t.heavy) return 'heavy';
  if (usagePct >= t.healthy) return 'healthy';
  return 'fresh';
}

/**
 * Smarter health heuristics (v0.2): raw token usage understates how
 * degraded a long conversation feels, so the health STATE is derived
 * from an adjusted "effective load":
 *
 *  - Turn penalty: beyond TURN_FREE messages, attention quality drops
 *    even with budget to spare — +TURN_STEP% per extra message, capped.
 *  - Duplicate penalty: duplicated blocks inflate the window without
 *    adding information; half their budget share is added back, capped.
 *
 * Conversation age is deliberately NOT a factor: real message
 * timestamps aren't reliably in the DOM, and a fake signal is worse
 * than none. The raw usage % stays displayed as-is — only the
 * state/bar use the adjusted number, and the panel shows the
 * adjustment when it is material.
 */

const TURN_FREE = 60;
const TURN_STEP = 0.15;
const TURN_CAP = 15;
const DUP_WEIGHT = 0.5;
const DUP_CAP = 10;

export interface LoadInputs {
  usagePct: number;
  messageCount: number;
  dupTokens: number;
  budget: number;
}

export function effectiveLoadPct(i: LoadInputs): number {
  const turnPenalty = Math.min(TURN_CAP, Math.max(0, (i.messageCount - TURN_FREE) * TURN_STEP));
  const dupSharePct = i.budget > 0 ? (i.dupTokens / i.budget) * 100 : 0;
  const dupPenalty = Math.min(DUP_CAP, dupSharePct * DUP_WEIGHT);
  return i.usagePct + turnPenalty + dupPenalty;
}
