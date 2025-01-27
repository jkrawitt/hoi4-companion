<script setup lang="ts">
import { computed } from 'vue'
import type { Submarine } from './SubmarineCard.vue'

const props = defineProps<{
  sub: Submarine
}>()

const transposeSubObject = (sub: Submarine) => {
  const baseStats = Object.keys(sub.BaseStats)
  const baseStatsValues = Object.values(sub.BaseStats)
  const combatStats = Object.keys(sub.CombatStats)
  const combatStatsValues = Object.values(sub.CombatStats)
  const miscStats = Object.keys(sub.MiscStats)
  const miscStatsValues = Object.values(sub.MiscStats)
  return [baseStats, baseStatsValues, combatStats, combatStatsValues, miscStats, miscStatsValues]
}

const transposedSubObject = computed(() => {
  return transposeSubObject(props.sub)
})
</script>

<template>
  <span>
    <table border="1">
      <thead>
        <tr>
          <th colspan="2">Base Stats</th>
          <th colspan="2">Combat Stats</th>
          <th colspan="2">Misc Stats</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in 12" :key="n">
          <td v-for="k in 6" :key="k">{{ transposedSubObject[k - 1][n - 1] }}</td>
        </tr>
      </tbody>
    </table>
  </span>
</template>
