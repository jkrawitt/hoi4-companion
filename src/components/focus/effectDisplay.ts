import { ref, watch } from 'vue'

const SHOW_KEY = 'hoi4-companion:show-skipped-branches'
const HIDDEN_KEY = 'hoi4-companion:show-hidden-effects'
const SIMPLIFY_KEY = 'hoi4-companion:simplify-effects'

const load = (key: string, fallback = false): boolean => {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : stored === 'true'
  } catch {
    return fallback
  }
}

/**
 * Whether the branches of an `if`/`else` chain that do not apply to this run are drawn (dimmed)
 * or left out. Off by default; shared by every effect list and kept in the browser, being a
 * view preference rather than part of the campaign.
 */
export const showSkippedBranches = ref(load(SHOW_KEY))

/**
 * Whether the effect lists show only what will happen: the branches that do not apply are gone
 * and the headers of the ones that do are dissolved, so the lines are no longer nested under
 * their conditions. Off by default; it overrides `showSkippedBranches`.
 */
export const simplifyEffects = ref(load(SIMPLIFY_KEY))

/**
 * Whether the `hidden_effect` blocks of a reward are drawn (grey, italic). They are things the
 * game does not tell the player but that still happen, so they are shown unless turned off.
 */
export const showHiddenEffects = ref(load(HIDDEN_KEY, true))

const remember = (key: string) => (on: boolean) => {
  try {
    localStorage.setItem(key, String(on))
  } catch {
    // Best-effort (private mode, blocked storage).
  }
}
watch(showSkippedBranches, remember(SHOW_KEY))
watch(showHiddenEffects, remember(HIDDEN_KEY))
watch(simplifyEffects, remember(SIMPLIFY_KEY))
