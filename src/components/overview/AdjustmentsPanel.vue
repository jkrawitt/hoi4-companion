<script setup lang="ts">
/**
 * What the player saw in game that the plan cannot know: stability moved by events and modifiers
 * from random events. Each entry is dated; everything downstream follows from it.
 */
import { computed, ref } from 'vue'
import { ADJUSTABLE_STATS, adjustableStat, warText } from '@/domain/adjustments'
import { formatStatValue, statLabel } from '@/domain/stats'
import { useCampaign } from '@/stores/campaign'

const { adjustments, addAdjustment, removeAdjustment, stabilityOn, viewDate } = useCampaign()

const stabilityDate = ref(viewDate.value)
const stabilityPercent = ref<number | null>(null)
const expected = computed(() => stabilityOn(stabilityDate.value))
const canAddStability = computed(
  () => stabilityDate.value !== '' && stabilityPercent.value !== null,
)
const addStability = () => {
  if (!canAddStability.value) return
  addAdjustment('stability', {
    date: stabilityDate.value,
    value: Math.round(stabilityPercent.value! * 10) / 1000,
  })
  stabilityPercent.value = null
}

const modifierDate = ref(viewDate.value)
const modifierName = ref('')
const modifierKey = ref(ADJUSTABLE_STATS[0].key)
const modifierValue = ref<number | null>(null)
const modifierDays = ref<number | null>(null)
const modifierStat = computed(() => ADJUSTABLE_STATS.find((s) => s.key === modifierKey.value)!)
const canAddModifier = computed(
  () => modifierDate.value !== '' && modifierValue.value !== null && modifierValue.value !== 0,
)
const addModifier = () => {
  if (!canAddModifier.value) return
  const percent = modifierStat.value.kind === 'percent'
  addAdjustment('modifiers', {
    date: modifierDate.value,
    name: modifierName.value.trim() || statLabel(adjustableStat(modifierKey.value)),
    key: modifierKey.value,
    value: percent ? Math.round(modifierValue.value! * 10) / 1000 : modifierValue.value!,
    ...(modifierDays.value && modifierDays.value > 0 ? { days: modifierDays.value } : {}),
  })
  modifierValue.value = null
  modifierDays.value = null
  modifierName.value = ''
}

const warDate = ref(viewDate.value)
const warEnemies = ref('')
const addWar = () => {
  if (warDate.value === '') return
  addAdjustment('wars', {
    date: warDate.value,
    enemies: warEnemies.value
      .split(/[\s,]+/)
      .map((t) => t.toUpperCase())
      .filter((t) => /^[A-Z]{3}$/.test(t)),
  })
  warEnemies.value = ''
}

const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
const describe = (m: (typeof adjustments.value.modifiers)[number]) => {
  const stat = adjustableStat(m.key)
  return `${m.name}: ${formatStatValue(stat, String(m.value))} ${statLabel(stat).toLowerCase()}${
    m.days ? ` for ${m.days} days` : ''
  }`
}
const entries = computed(() =>
  [
    ...adjustments.value.stability.map((s) => ({
      kind: 'stability' as const,
      id: s.id,
      date: s.date,
      text: `Stability was ${percent(s.value)}`,
    })),
    ...adjustments.value.wars.map((w) => ({
      kind: 'wars' as const,
      id: w.id,
      date: w.date,
      text: warText(w),
    })),
    ...adjustments.value.modifiers.map((m) => ({
      kind: 'modifiers' as const,
      id: m.id,
      date: m.date,
      text: describe(m),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)),
)
</script>

<template>
  <section class="adjustments">
    <h3>Adjust to the game</h3>
    <p class="muted">
      Enter what you see in game and the plan follows from it: consumer goods, civs, construction
      dates and political power. Trade is entered on the production page.
    </p>
    <form @submit.prevent="addStability">
      <strong>Stability was</strong>
      <input v-model="stabilityDate" type="date" aria-label="Date" />
      <input
        v-model.number="stabilityPercent"
        type="number"
        min="0"
        max="100"
        step="0.1"
        aria-label="Stability percent"
      />
      %
      <span v-if="expected !== undefined" class="muted">the plan has {{ percent(expected) }}</span>
      <button type="submit" :disabled="!canAddStability">Add</button>
    </form>
    <form @submit.prevent="addWar">
      <strong>War from</strong>
      <input v-model="warDate" type="date" aria-label="Date" />
      <input
        v-model="warEnemies"
        type="text"
        placeholder="Enemy tags, e.g. SOV (empty: at peace)"
        aria-label="Enemies"
      />
      <button type="submit" :disabled="warDate === ''">Add</button>
    </form>
    <form @submit.prevent="addModifier">
      <strong>Event modifier</strong>
      <input v-model="modifierDate" type="date" aria-label="Date" />
      <input v-model="modifierName" type="text" placeholder="Name" aria-label="Name" />
      <select v-model="modifierKey" aria-label="Stat">
        <option v-for="s in ADJUSTABLE_STATS" :key="s.key" :value="s.key">{{ s.label }}</option>
      </select>
      <input
        v-model.number="modifierValue"
        type="number"
        step="any"
        :aria-label="modifierStat.kind === 'percent' ? 'Value in percent' : 'Value'"
      />
      {{ modifierStat.kind === 'percent' ? '%' : '' }}
      <input
        v-model.number="modifierDays"
        type="number"
        min="1"
        placeholder="Days (optional)"
        aria-label="Days"
      />
      <button type="submit" :disabled="!canAddModifier">Add</button>
    </form>
    <ul v-if="entries.length > 0">
      <li v-for="e in entries" :key="e.id">
        {{ e.date }}: {{ e.text }}
        <button :title="'Remove'" @click="removeAdjustment(e.kind, e.id)">Remove</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
input[type='number'] {
  width: 7rem;
}
ul {
  padding: 0;
  list-style: none;
}
</style>
