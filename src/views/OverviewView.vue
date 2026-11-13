<script setup lang="ts">
/** The whole picture of the country at a chosen date, built from what the plans have done to it. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import EffectList from '@/components/focus/EffectList.vue'
import GameDataImport from '@/components/GameDataImport.vue'
import DateScrubber from '@/components/overview/DateScrubber.vue'
import StatTotals from '@/components/overview/StatTotals.vue'
import type { StatTotal } from '@/domain/campaign/countryState'
import { formatDate, useCampaign } from '@/stores/campaign'

const { country, hasData, plan, state } = useCampaign()

const asItems = (totals: StatTotal[]) =>
  totals.map((t) => ({ key: t.key, stat: t.stat, value: String(t.total) }))

const statChanges = computed(() => asItems(state.value.statChanges))
const modifiers = computed(() => asItems(state.value.modifierTotals))
const rules = computed(() => state.value.rules)
const popularity = computed(() =>
  state.value.popularity.map((p) => ({
    key: p.subject,
    stat: p.stat,
    value: String(p.total),
  })),
)
const hasGovernment = computed(
  () => state.value.rulingParty || state.value.leader || popularity.value.length > 0,
)
</script>

<template>
  <div>
    <h2>{{ country.name }}</h2>

    <section v-if="!hasData">
      <p>Import the focus tree from your game folder to get started.</p>
      <GameDataImport />
    </section>

    <section v-else-if="plan.length === 0">
      <p>
        Nothing is planned yet.
        <RouterLink to="/focus">Choose focuses in the planner</RouterLink> and they will show up
        here.
      </p>
    </section>

    <template v-else>
      <p class="muted">
        Changes from your focus plan. The country's starting national spirits and stats are not
        included yet.
      </p>
      <DateScrubber />

      <section v-if="hasGovernment">
        <h3>Government</h3>
        <p v-if="state.rulingParty">Ruling party: {{ state.rulingParty }}</p>
        <p v-if="state.leader">Leader: {{ state.leader }}</p>
        <StatTotals :items="popularity" />
      </section>

      <section>
        <h3>National spirits</h3>
        <p v-if="state.ideas.length === 0" class="muted">None gained yet.</p>
        <ul class="ideas">
          <li v-for="idea in state.ideas" :key="idea.id" class="idea">
            <strong>{{ idea.name }}</strong>
            <div class="muted">
              since {{ formatDate(idea.since) }} (<RouterLink to="/focus">{{
                idea.focusName
              }}</RouterLink
              >)<template v-if="idea.until"> until {{ formatDate(idea.until) }}</template>
            </div>
            <EffectList :effects="idea.modifiers" />
          </li>
        </ul>
      </section>

      <section v-if="modifiers.length > 0 || rules.length > 0">
        <h3>Modifiers from national spirits</h3>
        <StatTotals :items="modifiers" />
        <StatTotals :items="rules" />
      </section>

      <section v-if="statChanges.length > 0">
        <h3>One-off changes so far</h3>
        <StatTotals :items="statChanges" />
      </section>

      <section v-if="state.conditional.length > 0">
        <details>
          <summary>Not counted: effects that depend on a condition</summary>
          <div v-for="(c, i) in state.conditional" :key="i" class="conditional">
            <strong>{{ c.focusName }}</strong>
            <EffectList :effects="c.lines" />
          </div>
        </details>
      </section>
    </template>
  </div>
</template>

<style scoped>
.muted {
  color: #666;
}
.ideas {
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
.idea {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.conditional {
  margin: 0.5rem 0;
}
</style>
