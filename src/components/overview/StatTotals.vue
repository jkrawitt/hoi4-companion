<script setup lang="ts">
/** Summed stats (and yes/no rules) as `Label: value` lines, coloured by whether it helps. */
import type { StatDefinition } from '@/domain/stats'
import { formatStatValue, statLabel, statTone } from '@/domain/stats'

defineProps<{
  items: { key: string; stat: StatDefinition; value: string }[]
}>()
</script>

<template>
  <ul class="totals">
    <li v-for="item in items" :key="item.key" :class="statTone(item.stat, item.value)">
      {{ statLabel(item.stat) }}: {{ formatStatValue(item.stat, item.value) }}
    </li>
  </ul>
</template>

<style scoped>
.totals {
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.good {
  color: #1f7a3d;
}
.bad {
  color: #b3261e;
}
</style>
