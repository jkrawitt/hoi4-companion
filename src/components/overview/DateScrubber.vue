<script setup lang="ts">
/** Chooses the date the overview shows: a date field, a slider with a tick per completed focus. */
import { computed } from 'vue'
import { completionDay, formatDate, parseDate, useCampaign } from '@/stores/campaign'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const { schedule, startDate, viewDate, state } = useCampaign()

const start = computed(() => parseDate(startDate.value))
const completionDays = computed(() => schedule.value.items.map((item) => completionDay(item.end)))
const lastDay = computed(
  () => completionDays.value[completionDays.value.length - 1] ?? startDate.value,
)
const span = computed(() =>
  Math.max(
    1,
    Math.round((parseDate(lastDay.value).getTime() - start.value.getTime()) / MS_PER_DAY),
  ),
)

const offset = computed({
  get: () => Math.round((parseDate(viewDate.value).getTime() - start.value.getTime()) / MS_PER_DAY),
  set: (days: number) =>
    (viewDate.value = formatDate(new Date(start.value.getTime() + days * MS_PER_DAY))),
})

const ticks = computed(() =>
  [...new Set(completionDays.value)].map((day) => ({
    day,
    percent: ((parseDate(day).getTime() - start.value.getTime()) / MS_PER_DAY / span.value) * 100,
  })),
)

// Back from the first focus goes to the campaign start.
const previous = computed(() =>
  viewDate.value > startDate.value
    ? ([...completionDays.value].reverse().find((d) => d < viewDate.value && d > startDate.value) ??
      startDate.value)
    : undefined,
)
const following = computed(() => completionDays.value.find((d) => d > viewDate.value))
</script>

<template>
  <div class="scrubber">
    <div class="row">
      <label>
        Date
        <input type="date" v-model="viewDate" :min="startDate" />
      </label>
      <button :disabled="!previous" @click="previous && (viewDate = previous)">
        ← Previous focus
      </button>
      <button :disabled="!following" @click="following && (viewDate = following)">
        Next focus →
      </button>
    </div>
    <div class="slider">
      <!-- Keyed on the range: a new value set before the new max is clamped to the old max. -->
      <input :key="span" type="range" min="0" :max="span" v-model.number="offset" />
      <div class="ticks">
        <span v-for="t in ticks" :key="t.day" :style="{ left: `${t.percent}%` }" />
      </div>
    </div>
    <p class="muted">
      {{ state.completed.length }} of {{ schedule.items.length }} focuses complete<template
        v-if="state.next"
        >; next: {{ state.next.focus.name }} on {{ formatDate(state.next.end) }}</template
      >.
    </p>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}
.slider {
  position: relative;
  margin-top: 0.75rem;
}
.slider input {
  width: 100%;
  margin: 0;
}
.ticks {
  position: relative;
  height: 8px;
}
.ticks span {
  position: absolute;
  top: 0;
  width: 1px;
  height: 8px;
  background: #2f4f6f;
}
.muted {
  color: #666;
}
</style>
