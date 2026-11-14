<script setup lang="ts">
/** The construction queue: what the spare civilian factories build, in order, and where. */
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { levelsLeft, type ConstructionIssue, type ScheduledConstruction } from '@/domain/production'
import { completionDay, formatDate, useCampaign } from '@/stores/campaign'

/** What the add row holds; the state rows' `+` fills it in. */
export interface ConstructionDraft {
  state: number
  building: string
  levels: number
}

const draft = defineModel<ConstructionDraft>('draft', { required: true })

const router = useRouter()
const {
  production,
  industry,
  viewDate,
  constructionPlan,
  constructionSchedule,
  addConstruction,
  moveConstruction,
  removeConstruction,
  resetConstruction,
} = useCampaign()

const ISSUES: Record<ConstructionIssue, string> = {
  'no-slots': 'Waited for a free building slot in the state.',
  'state-max': 'The state cannot hold more levels of this building.',
  'unknown-building': 'Not found in the game data.',
  'unknown-state': 'The country does not own this state.',
}

/**
 * The states for the add row: best infrastructure first (it builds faster there), then by name,
 * with the states whose building slots are all taken or promised moved to the bottom and greyed.
 * Full is judged on the viewed date: the slots there, minus what is built and what the queue
 * still has to build in the state. A full state can still take buildings that use no slot.
 */
const stateOptions = computed(() => {
  const shared = new Set(production.value?.buildings.filter((b) => b.sharesSlots).map((b) => b.id))
  const viewed = new Date(viewDate.value).getTime()
  const pending = new Map<number, number>()
  for (const item of constructionSchedule.value?.items ?? []) {
    if (!shared.has(item.item.building)) continue
    const done = item.levels.filter((l) => l.end.getTime() <= viewed).length
    pending.set(item.item.state, (pending.get(item.item.state) ?? 0) + item.item.levels - done)
  }
  return (industry.value?.states ?? [])
    .map((s) => ({
      id: s.id,
      name: s.name,
      infrastructure: s.infrastructure,
      free: s.slots - s.used - (pending.get(s.id) ?? 0),
    }))
    .map((s) => ({ ...s, full: s.free <= 0 }))
    .sort(
      (a, b) =>
        Number(a.full) - Number(b.full) ||
        b.infrastructure - a.infrastructure ||
        a.name.localeCompare(b.name),
    )
})

/** The buildings with room left in the chosen state. */
const buildingOptions = computed(() =>
  (production.value?.buildings ?? []).filter(
    (b) => levelsLeft(production.value!, b.id, draft.value.state, constructionPlan.value) > 0,
  ),
)
const maxLevels = computed(() =>
  production.value
    ? levelsLeft(production.value, draft.value.building, draft.value.state, constructionPlan.value)
    : 0,
)
// Keep the building and the levels within what the chosen state can still take.
watch(
  [buildingOptions, maxLevels, production],
  () => {
    const first = production.value?.states[0]?.id
    if (first !== undefined && !production.value?.states.some((s) => s.id === draft.value.state)) {
      draft.value = { ...draft.value, state: first }
    } else if (!buildingOptions.value.some((b) => b.id === draft.value.building)) {
      draft.value = { ...draft.value, building: buildingOptions.value[0]?.id ?? '' }
    } else if (draft.value.levels > maxLevels.value) {
      draft.value = { ...draft.value, levels: Math.max(1, maxLevels.value) }
    }
  },
  { immediate: true },
)

const canAdd = computed(
  () =>
    draft.value.building !== '' && draft.value.levels >= 1 && draft.value.levels <= maxLevels.value,
)
const add = () => {
  if (!canAdd.value) return
  addConstruction({ ...draft.value })
  draft.value = { ...draft.value, levels: 1 }
}

const stateName = (id: number) =>
  production.value?.states.find((s) => s.id === id)?.name ?? `#${id}`
const buildingName = (id: string) =>
  production.value?.buildings.find((b) => b.id === id)?.name ?? id

const rows = computed(() =>
  (constructionSchedule.value?.items ?? []).map((item: ScheduledConstruction) => {
    const first = item.levels[0]
    const last = item.levels[item.levels.length - 1]
    return {
      item,
      first,
      last,
      days: first && last ? Math.round((last.end.getTime() - first.start.getTime()) / 86400000) : 0,
    }
  }),
)

/** Opens the overview showing the country as of the day this is built. */
const showOnOverview = (end: Date) => {
  viewDate.value = completionDay(end)
  void router.push('/')
}
</script>

<template>
  <section v-if="production && constructionSchedule">
    <h3>Construction queue</h3>
    <p class="muted">
      Spare civilian factories build the queue in order, up to 15 on each project. Builds queued by
      focuses join the end of the queue when their focus is done. The speed is an estimate: the
      infrastructure bonus, the energy check and the 15-factory cap have not been checked against
      the game.
    </p>
    <form class="add" @submit.prevent="add">
      <label>
        State
        <select v-model.number="draft.state">
          <option
            v-for="s in stateOptions"
            :key="s.id"
            :value="s.id"
            :class="{ full: s.full }"
            :title="s.full ? 'No free building slots; only buildings that use none' : undefined"
          >
            {{ s.name }} (infra {{ s.infrastructure }},
            {{ s.full ? 'full' : `${s.free} free slot${s.free === 1 ? '' : 's'}` }})
          </option>
        </select>
      </label>
      <label>
        Building
        <select v-model="draft.building">
          <option v-for="b in buildingOptions" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>
      <label>
        Levels
        <input v-model.number="draft.levels" type="number" min="1" :max="maxLevels" />
      </label>
      <button type="submit" :disabled="!canAdd">Add</button>
      <button type="button" :disabled="constructionPlan.length === 0" @click="resetConstruction">
        Reset queue
      </button>
    </form>

    <p v-if="rows.length === 0">Add buildings to build a queue.</p>
    <table v-else>
      <thead>
        <tr>
          <th>State</th>
          <th>Building</th>
          <th>Levels</th>
          <th>Start / end</th>
          <th>Civs</th>
          <th>Days</th>
          <th>Issues</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="`${row.item.source}${row.item.index}`"
          :class="{ focus: row.item.source === 'focus' }"
        >
          <td>{{ stateName(row.item.item.state) }}</td>
          <td>
            {{ buildingName(row.item.item.building) }}
            <div v-if="row.item.source === 'focus'" class="muted">
              {{ row.item.focusName }}
              <span v-if="row.item.guessed">(game picks the state; guessed)</span>
            </div>
          </td>
          <td>{{ row.item.levels.length }} / {{ row.item.item.levels }}</td>
          <td>
            <template v-if="row.first && row.last">
              {{ formatDate(row.first.start) }} →
              <a
                href="#"
                title="See the country on this date"
                @click.prevent="showOnOverview(row.last.end)"
                >{{ formatDate(row.last.end) }}</a
              >
            </template>
            <span v-else class="muted">not built</span>
          </td>
          <td>{{ row.last?.civs ?? '' }}</td>
          <td>{{ row.days || '' }}</td>
          <td>
            <div v-for="issue in row.item.issues" :key="issue" class="problem">
              {{ ISSUES[issue] }}
            </div>
            <div v-if="row.item.levels.length < row.item.item.levels" class="problem">
              Not finished within the years the plan looks ahead.
            </div>
          </td>
          <td>
            <template v-if="row.item.source === 'queue'">
              <button
                :disabled="row.item.index === 0"
                title="Move up"
                @click="moveConstruction(row.item.index, -1)"
              >
                ↑
              </button>
              <button
                :disabled="row.item.index === constructionPlan.length - 1"
                title="Move down"
                @click="moveConstruction(row.item.index, 1)"
              >
                ↓
              </button>
              <button @click="removeConstruction(row.item.index)">Remove</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.muted {
  color: #666;
}
.problem {
  color: #b3261e;
}
.add {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  margin: 0.5rem 0 1rem;
}
.add label {
  display: flex;
  flex-direction: column;
}
.add input {
  width: 5rem;
}
.focus {
  color: #888;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.75rem 0.25rem 0;
  border-bottom: 1px solid #eee;
}
button {
  margin-right: 0.25rem;
}
option.full {
  color: #999;
}
</style>
