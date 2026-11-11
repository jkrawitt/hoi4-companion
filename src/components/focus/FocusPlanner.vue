<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { countries } from '@/data/countries'
import type { Focus } from '@/domain/focus'
import { schedulePlan } from '@/domain/focusPlan'
import { isValidPlan, pathTo, removeWithDependents } from '@/domain/focusSelection'
import { GameFolderError, importCountryFocuses, type GameFiles } from '@/domain/gameImport'
import { canUseDirectoryPicker, fromFileList, pickWithDirectoryPicker } from '@/import/gameFolder'
import FocusTreeGraph from './FocusTreeGraph.vue'
import { loadCachedFocuses, saveCachedFocuses } from '@/import/cache'

const countryTag = ref(countries[0].tag)
const country = computed(() => countries.find((c) => c.tag === countryTag.value)!)

const focuses = ref<Record<string, Focus>>({})
const hasData = computed(() => Object.keys(focuses.value).length > 0)
const status = ref('')
const error = ref('')
const importing = ref(false)
const folderInput = ref<HTMLInputElement | null>(null)

const plan = ref<string[]>([])
const startDateInput = ref('1936-01-01')
const speedBonusPercent = ref(0)

const setFocuses = (list: Focus[]) => {
  focuses.value = Object.fromEntries(list.map((f) => [f.id, f]))
  plan.value = []
}

// Load previously imported data whenever the country changes.
watch(
  countryTag,
  async (tag) => {
    focuses.value = {}
    plan.value = []
    error.value = ''
    status.value = ''
    const cached = await loadCachedFocuses(tag)
    if (cached && tag === countryTag.value) setFocuses(cached)
  },
  { immediate: true },
)

const runImport = async (files: GameFiles) => {
  importing.value = true
  error.value = ''
  status.value = 'Reading game files…'
  const target = country.value
  try {
    const list = await importCountryFocuses(files, target.focusTreeFile)
    await saveCachedFocuses(target.tag, list)
    if (target.tag === countryTag.value) setFocuses(list)
    status.value = `Imported ${list.length} focuses for ${target.name}.`
  } catch (e) {
    status.value = ''
    error.value = e instanceof GameFolderError ? e.message : `Import failed: ${String(e)}`
  } finally {
    importing.value = false
  }
}

const chooseFolder = async () => {
  if (canUseDirectoryPicker()) {
    try {
      const files = await pickWithDirectoryPicker()
      if (files) await runImport(files)
    } catch (e) {
      error.value = `Could not open the folder: ${String(e)}`
    }
  } else {
    folderInput.value?.click()
  }
}

const onFolderInput = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) await runImport(fromFileList(input.files))
  input.value = ''
}

const schedule = computed(() =>
  schedulePlan(plan.value, focuses.value, {
    startDate: new Date(`${startDateInput.value}T00:00:00Z`),
    speedBonus: speedBonusPercent.value / 100,
  }),
)

const formatDate = (d: Date) => d.toISOString().slice(0, 10)
const formatDays = (days: number) => Math.round(days * 10) / 10

const blockedIds = computed(
  () =>
    new Set(
      Object.keys(focuses.value).filter(
        (id) => !plan.value.includes(id) && pathTo(id, plan.value, focuses.value) === null,
      ),
    ),
)

// Selecting a focus queues its missing prerequisites first; deselecting also drops its dependents.
const toggle = (id: string) => {
  if (plan.value.includes(id)) {
    plan.value = removeWithDependents(id, plan.value, focuses.value)
    return
  }
  const path = pathTo(id, plan.value, focuses.value)
  if (path) plan.value = [...plan.value, ...path]
}

const reset = () => (plan.value = [])
const remove = (index: number) => toggle(plan.value[index])
const canMove = (index: number, delta: number) => {
  const target = index + delta
  if (target < 0 || target >= plan.value.length) return false
  const next = [...plan.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  return isValidPlan(next, focuses.value)
}
const move = (index: number, delta: number) => {
  if (!canMove(index, delta)) return
  const next = [...plan.value]
  ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
  plan.value = next
}
</script>

<template>
  <h1>National Focus Planner</h1>

  <div class="settings">
    <label>
      Country
      <select v-model="countryTag">
        <option v-for="c in countries" :key="c.tag" :value="c.tag">{{ c.name }}</option>
      </select>
    </label>
    <label>Start date <input type="date" v-model="startDateInput" /></label>
    <label>
      Focus speed bonus (%)
      <input type="number" min="0" step="5" v-model.number="speedBonusPercent" />
    </label>
  </div>

  <div class="import">
    <p v-if="!hasData">
      Focus data is read from your own copy of Hearts of Iron IV, in your browser. Nothing is
      uploaded.
    </p>
    <button @click="chooseFolder" :disabled="importing">
      {{ hasData ? 'Re-import from game folder' : 'Choose game folder' }}
    </button>
    <input ref="folderInput" type="file" webkitdirectory hidden @change="onFolderInput" />
    <span v-if="!hasData && !canUseDirectoryPicker()" class="hint">
      Your browser will list every file in the folder you pick, which can take a moment. Chrome or
      Edge avoid this.
    </span>
    <p v-if="status">{{ status }}</p>
    <p v-if="error" class="issue">{{ error }}</p>
  </div>

  <template v-if="hasData">
    <h2>Focus tree</h2>
    <p class="hint">
      Click a focus to add it to the plan along with any prerequisites it needs. Click it again to
      remove it and anything that depends on it. Greyed-out focuses conflict with your current plan.
    </p>
    <FocusTreeGraph :focuses="focuses" :plan="plan" :blocked-ids="blockedIds" @toggle="toggle" />

    <section>
      <h2>Plan</h2>
      <button v-if="plan.length > 0" @click="reset">Reset plan</button>
      <p v-if="schedule.items.length === 0">Add focuses to build a plan.</p>
      <ol v-else>
        <li v-for="(item, i) in schedule.items" :key="i">
          <button @click="move(i, -1)" :disabled="!canMove(i, -1)">↑</button>
          <button @click="move(i, 1)" :disabled="!canMove(i, 1)">↓</button>
          <button @click="remove(i)">✕</button>
          <strong>{{ item.focus.name }}</strong>
          {{ formatDate(item.start) }} → {{ formatDate(item.end) }} ({{
            formatDays(item.durationDays)
          }}
          days)
        </li>
      </ol>
      <p v-if="schedule.items.length > 0">
        <strong>Done on {{ formatDate(schedule.finish) }}</strong>
        ({{ formatDays(schedule.totalDays) }} days total)
      </p>
    </section>
  </template>
</template>

<style scoped>
.settings {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.import {
  margin-bottom: 1.5rem;
}
.hint {
  margin-left: 0.5rem;
  color: #666;
}
.columns {
  display: flex;
  gap: 3rem;
  flex-wrap: wrap;
}
li {
  margin-bottom: 0.4rem;
}
button {
  margin-right: 0.25rem;
}
.issue {
  color: #b45309;
}
</style>
