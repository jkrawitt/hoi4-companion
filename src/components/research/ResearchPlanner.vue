<script setup lang="ts">
import { computed } from 'vue'
import EffectList from '../focus/EffectList.vue'
import GameDataImport from '../GameDataImport.vue'
import ResearchFolderGraph from './ResearchFolderGraph.vue'
import { availableBonuses, earliestFreeSlot } from '@/domain/plan/researchPlan'
import type { BonusRef, ResearchBonus, UnscheduledReason } from '@/domain/research'
import { describeAhead } from '@/domain/research'
import { formatDate, parseDate, useCampaign } from '@/stores/campaign'
import { useShowOnOverview } from '../overviewLink'
import { yearBanners } from '../yearBanners'

const showOnOverview = useShowOnOverview()
const {
  research,
  startTechs,
  hasData,
  viewDate,
  startDate,
  researchPlan,
  researchSchedule,
  researchEnvironment,
  blockedTechIds,
  toggleTech,
  moveTech,
  setTechBonus,
  resetResearch,
} = useCampaign()

const techs = computed(() =>
  Object.fromEntries((research.value?.techs ?? []).map((t) => [t.id, t])),
)

const REASONS: Record<UnscheduledReason, string> = {
  'unknown-tech': 'Not found in the game data.',
  'not-researchable': 'Cannot be researched in a slot.',
  duplicate: 'Already in the queue.',
  'xor-blocked': 'Excluded by another tech in the queue.',
  'missing-prerequisite': 'A prerequisite is never researched.',
  'out-of-time': 'Not finished within the years the plan looks ahead.',
}

const bonusText = (bonus: ResearchBonus) => {
  const targets = (bonus.targetNames ?? bonus.targets).join(', ')
  const percent = Math.round(bonus.bonus * 100)
  return `${bonus.name}: +${percent}% for ${targets} (${bonus.uses}x)`
}
const bonusId = (ref: BonusRef) => `${ref.focusId}#${ref.index}`
const parseBonusId = (id: string): BonusRef | undefined => {
  const at = id.lastIndexOf('#')
  return at === -1 ? undefined : { focusId: id.slice(0, at), index: Number(id.slice(at + 1)) }
}

// Rows are in queue order. A tech's effects land when it is done, so a banner marks a new year.
const rows = computed(() => {
  const nextBanner = yearBanners()
  return researchPlan.value.map((queued, index) => {
    const tech = techs.value[queued.techId]
    const scheduled = researchSchedule.value.items.find((item) => item.index === index)
    const left = researchSchedule.value.unscheduled.find((u) => u.index === index)
    const banner = nextBanner(scheduled?.end)
    const offered = tech
      ? availableBonuses(tech, index, researchSchedule.value, researchEnvironment.value)
      : []
    const current = queued.bonus
    const options = offered.map((bonus) => ({ id: bonusId(bonus.ref), text: bonusText(bonus) }))
    if (current && !options.some((o) => o.id === bonusId(current))) {
      const known = researchEnvironment.value.bonuses.find(
        (b) => bonusId(b.ref) === bonusId(current),
      )
      options.push({
        id: bonusId(current),
        text: `${known ? bonusText(known) : bonusId(current)} (not available here)`,
      })
    }
    return { index, queued, tech, scheduled, left, banner, options }
  })
})

const formatDays = (days: number) => Math.round(days)

const doneBy = computed(() => parseDate(viewDate.value))

/** When a tech added to the queue would get a research slot, for the ahead-of-time marker. */
const freeAt = computed(() =>
  earliestFreeSlot(researchSchedule.value, researchEnvironment.value, parseDate(startDate.value)),
)
</script>

<template>
  <h2>Research Planner</h2>

  <GameDataImport v-if="!hasData || !research" />

  <template v-else>
    <p class="hint">
      Click a technology to add it to the queue along with the prerequisites it needs. Click it
      again to remove it and what depends on it. Free research slots take the first queued
      technology that can start, so slots from focuses join in when those focuses are done.
    </p>
    <div class="settings">
      <button :disabled="researchPlan.length === 0" @click="resetResearch">Reset queue</button>
    </div>
    <ResearchFolderGraph
      :techs="research.techs"
      :folders="research.folders"
      :queue="researchPlan.map((item) => item.techId)"
      :start-techs="startTechs"
      :schedule="researchSchedule"
      :blocked-ids="blockedTechIds"
      :view-date="doneBy"
      :free-at="freeAt"
      :defines="research.defines"
      @toggle="toggleTech"
    />

    <section>
      <h2>Queue</h2>
      <p v-if="researchPlan.length === 0">Add technologies to build a queue.</p>
      <ol v-else class="plan">
        <template v-for="row in rows" :key="row.index">
          <li v-if="row.banner !== null" class="year-banner">{{ row.banner }}</li>
          <li class="entry">
            <div class="when">
              <strong>{{ row.tech?.name ?? row.queued.techId }}</strong>
              <div v-if="row.scheduled && row.scheduled.slot >= 0">
                {{ formatDate(row.scheduled.start) }} →
                <a
                  href="#"
                  title="See the country on this date"
                  @click.prevent="showOnOverview(row.scheduled.end)"
                  >{{ formatDate(row.scheduled.end) }}</a
                >
              </div>
              <div v-else-if="row.scheduled">Had from {{ formatDate(row.scheduled.end) }}</div>
              <div v-if="row.scheduled && row.scheduled.slot >= 0" class="muted">
                {{ formatDays(row.scheduled.days) }} days, slot {{ row.scheduled.slot + 1 }}
              </div>
              <div v-if="row.scheduled && row.scheduled.ahead.years > 0" class="muted">
                {{ describeAhead(row.scheduled.ahead) }}
              </div>
              <div v-if="row.left" class="problem">{{ REASONS[row.left.reason] }}</div>
              <div v-for="(issue, i) in row.scheduled?.issues ?? []" :key="i" class="problem">
                <template v-if="issue.kind === 'already-researched'"
                  >Already researched, so it needs no slot.</template
                >
                <template v-else>The chosen bonus cannot be used here.</template>
              </div>
              <div class="controls">
                <button
                  :disabled="row.index === 0"
                  title="Move up"
                  @click="moveTech(row.index, -1)"
                >
                  ↑
                </button>
                <button
                  :disabled="row.index === researchPlan.length - 1"
                  title="Move down"
                  @click="moveTech(row.index, 1)"
                >
                  ↓
                </button>
                <button
                  title="Remove with what depends on it"
                  @click="toggleTech(row.queued.techId)"
                >
                  Remove
                </button>
              </div>
            </div>
            <div>
              <label class="bonus">
                Bonus
                <select
                  :value="row.queued.bonus ? bonusId(row.queued.bonus) : ''"
                  @change="
                    setTechBonus(
                      row.index,
                      parseBonusId(($event.target as HTMLSelectElement).value),
                    )
                  "
                >
                  <option value="">None</option>
                  <option v-for="o in row.options" :key="o.id" :value="o.id">{{ o.text }}</option>
                </select>
              </label>
              <EffectList :effects="row.tech?.modifiers ?? []" />
            </div>
          </li>
        </template>
      </ol>
    </section>

    <GameDataImport />
  </template>
</template>

<style scoped>
.settings {
  display: flex;
  gap: 1.5rem;
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
.problem {
  color: #b3261e;
}
.controls {
  margin-top: 0.25rem;
}
.bonus {
  display: block;
  margin-bottom: 0.25rem;
}
button {
  margin-right: 0.25rem;
}
</style>
