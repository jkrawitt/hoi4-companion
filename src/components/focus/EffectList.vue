<script setup lang="ts">
/**
 * What completing a focus does, as one indented line per effect, coloured by whether it is an
 * improvement or a setback. Shown both in the tree's hover tooltip and in the plan.
 */
import { computed } from 'vue'
import type { EffectLine } from '@/domain/focus'
import { effectTone, formatEffect, onlyWhatHappens } from '@/domain/focusEffects'
import { showHiddenEffects, showSkippedBranches, simplifyEffects } from './effectDisplay'

const props = defineProps<{
  effects: EffectLine[]
  /** Shown in place of the list when the focus has no effects; nothing is shown without one. */
  emptyText?: string
}>()

/**
 * The lines to draw: simplified, only what happens (and not nested under why); otherwise the
 * branches that do not apply are left out, unless the toggle asks for them.
 */
const shown = computed(() => {
  const lines = showHiddenEffects.value ? props.effects : props.effects.filter((e) => !e.hidden)
  if (simplifyEffects.value) return onlyWhatHappens(lines)
  return showSkippedBranches.value ? lines : lines.filter((e) => e.branch !== 'skipped')
})

/** What a branch header says about itself, once the campaign has settled which branch runs. */
const note = (effect: EffectLine): string | undefined => {
  if (effect.branch === 'applies') return '(applies)'
  const header = effect.value === undefined && /^(if|else|else_if)$/.test(effect.key ?? '')
  return effect.branch === 'skipped' && header ? '(does not apply)' : undefined
}

/** One grid level of nesting, in px. */
const INDENT = 12
</script>

<template>
  <ul class="effects">
    <li
      v-for="(effect, i) in shown"
      :key="i"
      :class="[effectTone(effect), { hidden: effect.hidden, skipped: effect.branch === 'skipped' }]"
      :style="{ paddingLeft: `${effect.depth * INDENT}px` }"
    >
      {{ formatEffect(effect) }}
      <span v-if="note(effect)" class="muted">{{ note(effect) }}</span>
    </li>
    <li v-if="shown.length === 0 && emptyText" class="muted">{{ emptyText }}</li>
  </ul>
</template>

<style scoped>
.effects {
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.good {
  color: #1f7a3d;
}
.bad {
  color: #b3261e;
}
/* A branch of an `if` chain that does not run. */
.skipped {
  opacity: 0.45;
}
/* Effects inside a `hidden_effect` block: the game does not show them to the player. */
.hidden {
  color: #777;
  font-style: italic;
}
</style>
