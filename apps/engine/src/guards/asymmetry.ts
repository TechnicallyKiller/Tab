import { format, type MicroUsdc } from '@tab/money'
import { mayApplyMidWindow } from '@tab/scoring'

/**
 * The shrink-now / grow-later transition.
 *
 * **May shrink a ceiling mid-window, instantly. May never grow one
 * mid-window.**
 *
 * This is the mechanism behind the demo's central moment: the graph catches a
 * control edge, the ceiling collapses to zero mid-window, and the very next
 * spend is refused. If growth were also immediate, that collapse would be one
 * behaviour among many rather than a deliberate safety property — and the loop
 * attacker's fastest path would be to fake revenue, watch the ceiling rise
 * inside the same window, and spend against the increase before anything
 * settled.
 *
 * A guarded transition with its own test, per the README, rather than a
 * convention someone has to remember. `@tab/scoring` owns the predicate because
 * it is pure and a stranger must be able to rerun it; this owns the STATE — what
 * is in force, what is pending, and when the pending value is allowed to land.
 */

export interface CeilingState {
  /** In force now, and what the fast path enforces. */
  inForce: MicroUsdc
  /** The window `inForce` was set in. */
  window: number
  /**
   * Computed, higher than `inForce`, and waiting for a clean settlement.
   *
   * Held rather than discarded so the operator can see that the agent has
   * earned an increase and what is holding it — "pending 4.0000, waits for
   * settlement" is actionable where silence looks like a stuck engine.
   */
  pending?: MicroUsdc
}

export type TransitionAction = 'shrink_now' | 'hold_pending' | 'grow_on_settlement' | 'unchanged'

export interface Transition {
  action: TransitionAction
  next: CeilingState
  /**
   * Published even when the ceiling does not move.
   *
   * "Stayed capped because concentration" is information the operator needs.
   * An engine that only speaks when a number changes is indistinguishable from
   * one that has died.
   */
  reason: string
}

/**
 * Apply a freshly computed ceiling to the state, mid-window.
 */
export function transition(
  state: CeilingState,
  computed: MicroUsdc,
  window: number,
): Transition {
  const verdict = mayApplyMidWindow(state.inForce, computed)

  if (computed === state.inForce) {
    return {
      action: 'unchanged',
      // Any pending growth is DROPPED here, deliberately: the recomputation
      // just said the ceiling should be exactly what it already is, so a
      // pending increase from an earlier run is stale and holding it would let
      // a settlement apply a value the model no longer supports.
      next: { inForce: state.inForce, window: state.window },
      reason: `unchanged at ${format(state.inForce)}${
        state.pending ? ' — a previously pending increase is now stale and dropped' : ''
      }`,
    }
  }

  if (verdict.allowed) {
    return {
      action: 'shrink_now',
      // A shrink also clears any pending growth. Something got worse; an
      // increase computed before it would be indefensible to apply after.
      next: { inForce: computed, window },
      reason:
        `shrink ${format(state.inForce)} → ${format(computed)}, applied immediately — ` +
        'a shrink is a safety action',
    }
  }

  return {
    action: 'hold_pending',
    next: { inForce: state.inForce, window: state.window, pending: computed },
    reason:
      `growth to ${format(computed)} computed but HELD at ${format(state.inForce)} — ` +
      verdict.reason,
  }
}

/**
 * A window settled cleanly. Any pending growth may now land.
 *
 * This is the only path by which a ceiling increases, and that is the point:
 * every increase is paid for by a window that actually closed and cleared.
 */
export function onCleanSettlement(state: CeilingState, window: number): Transition {
  if (state.pending === undefined) {
    return {
      action: 'unchanged',
      next: { inForce: state.inForce, window },
      reason: `clean settlement, nothing pending — ceiling stays at ${format(state.inForce)}`,
    }
  }

  /*
   * A pending value BELOW what is in force is applied too, and immediately.
   *
   * It can happen: growth is computed and held, the graph then worsens, and a
   * later recompute lands a smaller number in `pending`. Treating this branch
   * as "growth" and applying it unconditionally would be right by accident;
   * naming it keeps the invariant true — a ceiling never rises except here, and
   * never resists falling anywhere.
   */
  const pending = state.pending
  return {
    action: 'grow_on_settlement',
    next: { inForce: pending, window },
    reason:
      `clean settlement — pending ${format(pending)} applied, ` +
      `${format(state.inForce)} → ${format(pending)}`,
  }
}

/**
 * A window was MISSED. Nothing pending may land, ever.
 *
 * Not merely "the pending value waits for the next settlement": a missed
 * settlement is the one event that proves the credit decision was wrong, so an
 * increase computed before it is discarded rather than deferred.
 */
export function onMissedSettlement(state: CeilingState, window: number): Transition {
  return {
    action: 'unchanged',
    next: { inForce: state.inForce, window },
    reason: state.pending
      ? `missed settlement — pending ${format(state.pending)} DISCARDED, not deferred`
      : 'missed settlement — nothing was pending',
  }
}
