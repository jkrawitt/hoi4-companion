<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import GameDataImport from '../GameDataImport.vue'
import type { TimelineKind } from '@/domain/campaign/timeline'
import { completionDay, formatDate, useCampaign } from '@/stores/campaign'

const router = useRouter()
const { hasData, timeline, viewDate, checkedOff, toggleChecked, resetChecked } = useCampaign()

const KINDS: { kind: TimelineKind; label: string }[] = [
  { kind: 'focus', label: 'Focus' },
  { kind: 'research', label: 'Research' },
  { kind: 'construction', label: 'Construction' },
  { kind: 'politics', label: 'Political power' },
  { kind: 'adjustment', label: 'Adjustments' },
]
const shown = ref<TimelineKind[]>(KINDS.map((k) => k.kind))
/** Hides the actions checked off as done in game, and the days left with nothing to do. */
const hideChecked = ref(true)
const checked = computed(() => new Set(checkedOff.value))

// Days are grouped under year banners. A day with nothing left after filtering is dropped, and so
// is one whose actions were all checked off while those are hidden.
const rows = computed(() => {
  const rows: { day: (typeof timeline.value.days)[number]; banner: number | null }[] = []
  let previous: number | undefined
  for (const day of timeline.value.days) {
    const done = day.done.filter((e) => shown.value.includes(e.kind))
    const shownTodo = day.todo.filter((e) => shown.value.includes(e.kind))
    const todo = hideChecked.value ? shownTodo.filter((e) => !checked.value.has(e.id)) : shownTodo
    if (todo.length === 0 && (done.length === 0 || shownTodo.length > 0)) continue
    const year = day.date.getUTCFullYear()
    rows.push({ day: { ...day, done, todo }, banner: year !== previous ? year : null })
    previous = year
  }
  return rows
})

const unscheduled = computed(() => {
  const u = timeline.value.unscheduled
  return [
    { count: u.research, label: 'queued techs', to: '/research' },
    { count: u.construction, label: 'construction items', to: '/production' },
    { count: u.politics, label: 'purchases', to: '/politics' },
  ].filter((x) => x.count > 0)
})

/** Opens the overview showing the country on this day. */
const showOnOverview = (date: Date) => {
  viewDate.value = completionDay(date)
  void router.push('/')
}
</script>

<template>
  <h2>Timeline</h2>

  <GameDataImport v-if="!hasData" />

  <template v-else>
    <div class="filters">
      <label v-for="k in KINDS" :key="k.kind">
        <input type="checkbox" :value="k.kind" v-model="shown" /> {{ k.label }}
      </label>
      <label class="hide-checked">
        <input type="checkbox" v-model="hideChecked" /> Hide checked ({{ checkedOff.length }})
      </label>
      <button :disabled="checkedOff.length === 0" @click="resetChecked">Uncheck all</button>
    </div>

    <p v-if="rows.length === 0">Nothing is planned yet.</p>
    <ol v-else class="days">
      <template v-for="{ day, banner } in rows" :key="day.day">
        <li v-if="banner !== null" class="year">{{ banner }}</li>
        <li class="day">
          <a
            href="#"
            title="See the country on this date"
            @click.prevent="showOnOverview(day.date)"
          >
            {{ formatDate(day.date) }}
          </a>
          <div class="lists">
            <div v-if="day.done.length">
              <h4>Done</h4>
              <ul>
                <li v-for="(e, i) in day.done" :key="i" :class="{ automatic: e.automatic }">
                  <span :class="['tag', e.kind]">{{ e.kind }}</span> {{ e.text }}
                  <span v-if="e.detail" class="muted">({{ e.detail }})</span>
                </li>
              </ul>
            </div>
            <div v-if="day.todo.length">
              <h4>Next</h4>
              <ul>
                <li
                  v-for="e in day.todo"
                  :key="e.id"
                  :class="{ automatic: e.automatic, checked: checked.has(e.id) }"
                >
                  <label>
                    <input
                      type="checkbox"
                      title="Done in game"
                      :checked="checked.has(e.id)"
                      @change="toggleChecked(e.id)"
                    />
                    <span :class="['tag', e.kind]">{{ e.kind }}</span> {{ e.text }}
                    <span v-if="e.detail" class="muted">({{ e.detail }})</span>
                  </label>
                </li>
              </ul>
            </div>
          </div>
        </li>
      </template>
    </ol>

    <p v-if="unscheduled.length" class="muted">
      Never happens:
      <template v-for="(u, i) in unscheduled" :key="u.to">
        <template v-if="i > 0">, </template>
        <RouterLink :to="u.to">{{ u.count }} {{ u.label }}</RouterLink>
      </template>
    </p>

    <GameDataImport />
  </template>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin-bottom: 1rem;
}
.days {
  padding: 0;
  list-style: none;
}
.day {
  display: grid;
  grid-template-columns: 9rem minmax(0, 1fr);
  gap: 1rem;
  padding: 0.5rem 0;
  border-top: 1px solid #ddd;
}
.lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}
h4 {
  margin: 0 0 0.25rem;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
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
.automatic {
  color: #888;
}
.checked {
  color: #888;
  text-decoration: line-through;
}
.hide-checked {
  margin-left: auto;
}
.tag {
  display: inline-block;
  min-width: 5.5rem;
  padding: 0 0.4rem;
  font-size: 0.75rem;
  text-align: center;
  color: #fff;
  border-radius: 3px;
}
.tag.focus {
  background: #2f4f6f;
}
.tag.research {
  background: #5a7d2f;
}
.tag.construction {
  background: #a06a1c;
}
.tag.politics {
  background: #7a3f7a;
}
.tag.adjustment {
  background: #8a3a3a;
}
</style>
