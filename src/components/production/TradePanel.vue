<script setup lang="ts">
/**
 * Trade as the player sees it in game: the resources imported (each costs civilian factories) and
 * the civs received from other countries. Both change the civs construction has.
 */
import { computed, ref } from 'vue'
import { DEFAULT_RESOURCE_COST } from '@/domain/production'
import { importCost } from '@/domain/adjustments'
import { useCampaign } from '@/stores/campaign'

const { production, adjustments, addAdjustment, removeAdjustment, viewDate } = useCampaign()

const resources = computed(() => Object.keys(production.value?.resourceCost ?? {}))
const costs = computed(() => production.value?.resourceCost ?? {})

const resource = ref('steel')
const amount = ref<number | null>(null)
const from = ref(viewDate.value)
const until = ref('')
const partner = ref('')
const cost = computed(() =>
  amount.value ? importCost({ resource: resource.value, amount: amount.value }, costs.value) : 0,
)
const canAddImport = computed(() => amount.value !== null && amount.value > 0 && from.value !== '')
const addImport = () => {
  if (!canAddImport.value) return
  addAdjustment('imports', {
    resource: resource.value,
    amount: amount.value!,
    from: from.value,
    ...(until.value ? { until: until.value } : {}),
    ...(partner.value.trim() ? { partner: partner.value.trim() } : {}),
  })
  amount.value = null
}

const receivedDate = ref(viewDate.value)
const receivedCivs = ref<number | null>(null)
const addReceived = () => {
  if (receivedCivs.value === null || receivedDate.value === '') return
  addAdjustment('received', { date: receivedDate.value, civs: receivedCivs.value })
  receivedCivs.value = null
}

const sortedImports = computed(() =>
  [...adjustments.value.imports].sort((a, b) => a.from.localeCompare(b.from)),
)
const sortedReceived = computed(() =>
  [...adjustments.value.received].sort((a, b) => a.date.localeCompare(b.date)),
)
</script>

<template>
  <section v-if="production">
    <h3>Trade</h3>
    <p class="muted">
      An import costs civilian factories ({{ DEFAULT_RESOURCE_COST * 8 }} units a civ in the game
      files, rounded up). Civs received from trade are read off the production screen and hold until
      the next entry; they count a quarter toward the energy cost scaling. Exports are not modelled.
    </p>
    <h4>Imports</h4>
    <form @submit.prevent="addImport">
      <label>
        Resource
        <select v-model="resource">
          <option v-for="r in resources" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>
      <label> Amount <input v-model.number="amount" type="number" min="1" /> </label>
      <label> From <input v-model="partner" type="text" placeholder="Country" /> </label>
      <label> Starting <input v-model="from" type="date" /> </label>
      <label> Until <input v-model="until" type="date" /> </label>
      <span class="muted">costs {{ cost }} civs</span>
      <button type="submit" :disabled="!canAddImport">Add</button>
    </form>
    <ul v-if="sortedImports.length > 0">
      <li v-for="i in sortedImports" :key="i.id">
        {{ i.from }}<template v-if="i.until"> to {{ i.until }}</template
        >: {{ i.amount }} {{ i.resource
        }}<template v-if="i.partner"> from {{ i.partner }}</template> ({{ importCost(i, costs) }}
        civs)
        <button @click="removeAdjustment('imports', i.id)">Remove</button>
      </li>
    </ul>
    <h4>Civs received from trade</h4>
    <form @submit.prevent="addReceived">
      <label> Date <input v-model="receivedDate" type="date" /> </label>
      <label> Civs <input v-model.number="receivedCivs" type="number" min="0" /> </label>
      <button type="submit" :disabled="receivedCivs === null">Add</button>
    </form>
    <ul v-if="sortedReceived.length > 0">
      <li v-for="r in sortedReceived" :key="r.id">
        {{ r.date }}: {{ r.civs }} civs
        <button @click="removeAdjustment('received', r.id)">Remove</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
input[type='number'] {
  width: 7rem;
}
ul {
  padding: 0;
  list-style: none;
}
.muted {
  color: #666;
}
</style>
