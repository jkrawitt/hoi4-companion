<script setup lang="ts">
/**
 * What completing a focus does, as one indented line per effect, coloured by whether it is an
 * improvement or a setback. Shown both in the tree's hover tooltip and in the plan.
 */
import type { EffectLine } from '@/domain/focus'
import { effectTone, formatEffect } from '@/domain/focusEffects'

defineProps<{
  effects: EffectLine[]
  /** Shown in place of the list when the focus has no effects; nothing is shown without one. */
  emptyText?: string
}>()

/** One grid level of nesting, in px. */
const INDENT = 12
</script>

<template>
  <ul class="effects">
    <li
      v-for="(effect, i) in effects"
      :key="i"
      :class="[effectTone(effect), { hidden: effect.hidden }]"
      :style="{ paddingLeft: `${effect.depth * INDENT}px` }"
    >
      {{ formatEffect(effect) }}
    </li>
    <li v-if="effects.length === 0 && emptyText" class="muted">{{ emptyText }}</li>
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
/* Effects inside a `hidden_effect` block: the game does not show them to the player. */
.hidden {
  color: #777;
  font-style: italic;
}
.muted {
  color: #666;
}
</style>
