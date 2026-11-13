<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import FocusTreeGraph from './FocusTreeGraph.vue'
import EffectList from './EffectList.vue'
import GameDataImport from '../GameDataImport.vue'
import { completionDay, formatDate, useCampaign } from '@/stores/campaign'

const router = useRouter()
const {
  focuses,
  hasData,
  plan,
  startDate: startDateInput,
  speedBonusPercent,
  viewDate,
  schedule,
  blockedIds,
  toggle,
  reset,
} = useCampaign()

const formatDays = (days: number) => Math.round(days * 10) / 10

// A focus's effects land when it completes, so rows are grouped under their completion year.
const rows = computed(() =>
  schedule.value.items.map((item, i, items) => {
    const year = item.end.getUTCFullYear()
    const previous = items[i - 1]?.end.getUTCFullYear()
    return { item, banner: year !== previous ? year : null }
  }),
)

/** Opens the overview showing the country as of the day this focus completes. */
const showOnOverview = (end: Date) => {
  viewDate.value = completionDay(end)
  void router.push('/')
}
</script>

<template>
  <h2>National Focus Planner</h2>

  <div class="settings">
    <label>Start date <input type="date" v-model="startDateInput" /></label>
    <label>
      Focus speed bonus (%)
      <input type="number" min="0" step="5" v-model.number="speedBonusPercent" />
    </label>
  </div>

  <GameDataImport v-if="!hasData" />

  <template v-else>
    <p class="hint">
      Click a focus to add it to the plan along with any prerequisites it needs. Click it again to
      remove it and anything that depends on it. Greyed-out focuses conflict with your current plan.
    </p>
    <FocusTreeGraph :focuses="focuses" :plan="plan" :blocked-ids="blockedIds" @toggle="toggle" />

    <section>
      <h2>Plan</h2>
      <button v-if="plan.length > 0" @click="reset">Reset plan</button>
      <p v-if="schedule.items.length === 0">Add focuses to build a plan.</p>
      <ol v-else class="plan">
        <template v-for="({ item, banner }, i) in rows" :key="i">
          <li v-if="banner !== null" class="year">{{ banner }}</li>
          <li class="entry">
            <div class="when">
              <strong>{{ item.focus.name }}</strong>
              <div>
                {{ formatDate(item.start) }} →
                <a
                  href="#"
                  title="See the country on this date"
                  @click.prevent="showOnOverview(item.end)"
                  >{{ formatDate(item.end) }}</a
                >
              </div>
              <div class="muted">{{ formatDays(item.durationDays) }} days</div>
            </div>
            <EffectList :effects="item.focus.effects" empty-text="No direct effects." />
          </li>
        </template>
      </ol>
      <p v-if="schedule.items.length > 0">
        <strong>Done on {{ formatDate(schedule.finish) }}</strong>
        ({{ formatDays(schedule.totalDays) }} days total)
      </p>
    </section>

    <GameDataImport />
  </template>
</template>

<style scoped>
.settings {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.hint {
  margin-left: 0.5rem;
  color: #666;
}
.plan {
  padding: 0;
  list-style: none;
}
.plan > .entry {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
  gap: 1.5rem;
  padding: 0.5rem 0;
  border-top: 1px solid #ddd;
}
.year {
  margin-top: 1rem;
  padding: 0.25rem 0.75rem;
  font-weight: 700;
  color: #fff;
  background: #2f4f6f;
  border-radius: 3px;
}
.muted {
  color: #666;
}
button {
  margin-right: 0.25rem;
}
</style>
