<script setup lang="ts">
/** The whole picture of the country at a chosen date, built from what the plans have done to it. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import EffectList from '@/components/focus/EffectList.vue'
import GameDataImport from '@/components/GameDataImport.vue'
import DateScrubber from '@/components/overview/DateScrubber.vue'
import StatTotals from '@/components/overview/StatTotals.vue'
import type { StatTotal } from '@/domain/campaign/countryState'
import { START_ID } from '@/domain/campaign/countryState'
import { formatDate, useCampaign } from '@/stores/campaign'

const { country, hasData, plan, state } = useCampaign()

const asItems = (totals: StatTotal[]) =>
  totals.map((t) => ({ key: t.key, stat: t.stat, value: String(t.total) }))
/** Values that are the country's actual level (stability 65%), so no `+` in front. */
const asLevels = (totals: StatTotal[]) =>
  totals.map((t) => ({
    key: t.key,
    stat: { ...t.stat, showPlus: false },
    value: String(t.total),
  }))

const stats = computed(() => asLevels(state.value.statChanges))
const modifiers = computed(() => asItems(state.value.modifierTotals))
const rules = computed(() => state.value.rules)
const popularity = computed(() =>
  asLevels(state.value.popularity).map((p, i) => ({
    ...p,
    key: state.value.popularity[i].subject,
  })),
)
const hasGovernment = computed(() => state.value.rulingParty || popularity.value.length > 0)
</script>

<template>
  <div>
    <h2>{{ country.name }}</h2>

    <section v-if="!hasData">
      <p>Import the focus tree from your game folder to get started.</p>
      <GameDataImport />
    </section>

    <template v-else>
      <p class="muted">
        The country at game start, plus the changes from your focus plan.
        <template v-if="plan.length === 0">
          Nothing is planned yet:
          <RouterLink to="/focus">choose focuses in the planner</RouterLink>.
        </template>
      </p>
      <DateScrubber />

      <section v-if="hasGovernment">
        <h3>Government</h3>
        <p v-if="state.rulingParty">Ruling party: {{ state.rulingParty }}</p>
        <StatTotals :items="popularity" />
      </section>

      <section v-if="state.leader">
        <h3>Leader</h3>
        <p>
          <strong>{{ state.leader.name }}</strong
          ><template v-if="state.leader.ideology"> ({{ state.leader.ideology }})</template>
        </p>
        <EffectList :effects="state.leader.traits" />
      </section>

      <section>
        <h3>National spirits</h3>
        <p v-if="state.ideas.length === 0" class="muted">None.</p>
        <ul class="ideas">
          <li v-for="idea in state.ideas" :key="idea.id" class="idea">
            <strong>{{ idea.name }}</strong>
            <div class="muted">
              <template v-if="idea.focusId === START_ID">at game start</template>
              <template v-else
                >since {{ formatDate(idea.since) }} (<RouterLink to="/focus">{{
                  idea.focusName
                }}</RouterLink
                >)</template
              ><template v-if="idea.until"> until {{ formatDate(idea.until) }}</template>
            </div>
            <EffectList :effects="idea.modifiers" />
          </li>
        </ul>
      </section>

      <section v-if="modifiers.length > 0 || rules.length > 0">
        <h3>Modifiers from leader traits and national spirits</h3>
        <StatTotals :items="modifiers" />
        <StatTotals :items="rules" />
      </section>

      <section v-if="stats.length > 0">
        <h3>Stats</h3>
        <StatTotals :items="stats" />
      </section>

      <section v-if="state.resources.length > 0">
        <h3>Resources added</h3>
        <ul class="totals">
          <li v-for="r in state.resources" :key="r.type" class="good">
            {{ r.name }}: +{{ r.total }}
          </li>
        </ul>
      </section>

      <section v-if="state.buildings.length > 0 || state.buildingSlots !== 0">
        <h3>Buildings added</h3>
        <ul class="totals">
          <li v-if="state.buildingSlots !== 0" class="good">
            Building slots: +{{ state.buildingSlots }}
          </li>
          <li v-for="b in state.buildings" :key="`${b.type}-${b.instant}`" class="good">
            {{ b.name }}: +{{ b.total }}<template v-if="b.instant"> (built instantly)</template>
          </li>
        </ul>
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
.totals {
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.good {
  color: #1f7a3d;
}
.conditional {
  margin: 0.5rem 0;
}
</style>
