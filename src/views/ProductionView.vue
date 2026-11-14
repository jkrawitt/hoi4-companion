<script setup lang="ts">
/** The factories of the country at the chosen date: summary tiles and the states they sit in. */
import { computed, ref } from 'vue'
import ConstructionQueue, {
  type ConstructionDraft,
} from '@/components/production/ConstructionQueue.vue'
import GameDataImport from '@/components/GameDataImport.vue'
import DateScrubber from '@/components/overview/DateScrubber.vue'
import { useCampaign } from '@/stores/campaign'

const { country, hasData, production, industry } = useCampaign()

/** The queue's add row; a state row's `+` fills in its state. */
const draft = ref<ConstructionDraft>({
  state: production.value?.states[0]?.id ?? 0,
  building: 'industrial_complex',
  levels: 1,
})
const queueFor = (state: number) => (draft.value = { ...draft.value, state })

const count = (type: string) => industry.value?.factories.find((f) => f.type === type)?.count ?? 0
const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
const resources = (r: Record<string, number>) =>
  Object.entries(r)
    .map(([type, n]) => `${type} ${n}`)
    .join(', ')
const otherFactories = computed(
  () =>
    industry.value?.factories.filter(
      (f) => !['industrial_complex', 'arms_factory', 'dockyard'].includes(f.type) && f.count > 0,
    ) ?? [],
)
</script>

<template>
  <div>
    <h2>{{ country.name }}: production</h2>

    <section v-if="!hasData || !production || !industry">
      <p>Import the game data from your game folder to get started.</p>
      <GameDataImport />
    </section>

    <template v-else>
      <p class="muted">
        The factories the country starts with, plus the ones built by your focus plan and the
        construction queue below, placed in the states they are built in.
      </p>
      <DateScrubber />

      <section class="tiles">
        <div class="tile">
          <span>Civilian factories</span><strong>{{ count('industrial_complex') }}</strong>
        </div>
        <div class="tile">
          <span>Military factories</span><strong>{{ count('arms_factory') }}</strong>
        </div>
        <div class="tile">
          <span>Naval dockyards</span><strong>{{ count('dockyard') }}</strong>
        </div>
        <div class="tile">
          <span>Consumer goods</span>
          <strong>{{ percent(industry.consumerGoods.percent) }}</strong>
          <small>{{ industry.consumerGoods.factories }} factories</small>
        </div>
        <div class="tile">
          <span>Available civilian factories</span><strong>{{ industry.availableCivs }}</strong>
        </div>
        <div class="tile">
          <span>Building slots used</span>
          <strong>{{ industry.slots.used }} / {{ industry.slots.total }}</strong>
          <small>{{ industry.slots.free }} free</small>
        </div>
      </section>
      <p class="muted">
        Consumer goods are an estimate: the formula has not been checked against the game.
      </p>
      <ul v-if="otherFactories.length > 0" class="totals">
        <li v-for="f in otherFactories" :key="f.type">{{ f.name }}: {{ f.count }}</li>
      </ul>

      <section>
        <h3>States</h3>
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Category</th>
              <th>Slots</th>
              <th>Infrastructure</th>
              <th>Civ</th>
              <th>Mil</th>
              <th>Dock</th>
              <th>Resources</th>
              <th>From focuses</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in industry.states" :key="s.id">
              <td>{{ s.name }}</td>
              <td>{{ s.category }}</td>
              <td>{{ s.used }} / {{ s.slots }}</td>
              <td>{{ s.infrastructure }}</td>
              <td>{{ s.civ }}</td>
              <td>{{ s.mil }}</td>
              <td>{{ s.dock }}</td>
              <td>{{ resources(s.resources) }}</td>
              <td>
                <ul class="totals">
                  <li v-for="(n, i) in s.fromFocuses" :key="i">
                    {{ n.focusName }}: {{ n.text }}
                    <span v-if="n.guessed" class="muted">(game picks; guessed)</span>
                  </li>
                </ul>
              </td>
              <td>
                <button title="Queue a building in this state" @click="queueFor(s.id)">+</button>
              </td>
            </tr>
          </tbody>
        </table>
        <template v-if="industry.unplaced.length > 0">
          <p class="muted">Built by focuses, in no state of the country (counted above):</p>
          <ul class="totals">
            <li v-for="(u, i) in industry.unplaced" :key="i">{{ u.focusName }}: {{ u.text }}</li>
          </ul>
        </template>
      </section>
      <ConstructionQueue v-model:draft="draft" />
    </template>
  </div>
</template>

<style scoped>
.muted {
  color: #666;
}
.tiles {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  margin: 1rem 0 0.5rem;
}
.tile {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.tile span,
.tile small {
  color: #666;
  font-size: 0.85rem;
}
.tile strong {
  font-size: 1.4rem;
}
.totals {
  margin: 0;
  padding: 0;
  list-style: none;
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
</style>
