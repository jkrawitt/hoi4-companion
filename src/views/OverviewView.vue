<script setup lang="ts">
/** The whole picture of the country at a chosen date, built from what the plans have done to it. */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import EffectList from '@/components/focus/EffectList.vue'
import GameDataImport from '@/components/GameDataImport.vue'
import DateScrubber from '@/components/overview/DateScrubber.vue'
import StatTotals from '@/components/overview/StatTotals.vue'
import type { StatTotal } from '@/domain/campaign/countryState'
import { START_ID } from '@/domain/focus'
import { capitalize, humanize } from '@/domain/effects/lines'
import { POLITICS_GROUPS } from '@/domain/politics'
import { formatDate, parseDate, useCampaign } from '@/stores/campaign'

const {
  country,
  hasData,
  plan,
  state,
  research,
  researchStatus,
  researchTotals,
  politics,
  politicsSchedule,
  viewDate,
} = useCampaign()

const techNames = computed(
  () => new Map((research.value?.techs ?? []).map((t) => [t.id, t.name] as const)),
)
const techName = (id: string) => techNames.value.get(id) ?? id

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
const techModifiers = computed(() => asItems(researchTotals.value))
const modifiers = computed(() => asItems(state.value.modifierTotals))
const rules = computed(() => state.value.rules)
const popularity = computed(() =>
  asLevels(state.value.popularity).map((p, i) => ({
    ...p,
    key: state.value.popularity[i].subject,
  })),
)
/** The national spirits: ideas that do not fill a politics slot (laws, advisors, designers). */
const spirits = computed(() => state.value.ideas.filter((idea) => !idea.slot))

/** What fills each politics slot on the date, grouped like the politics screen. */
const staff = computed(() => {
  const groupOf = new Map((politics.value?.options ?? []).map((o) => [o.slot, o.group] as const))
  return POLITICS_GROUPS.map((group) => ({
    ...group,
    slots: Object.entries(state.value.politics.held)
      .filter(([slot]) => groupOf.get(slot) === group.id)
      .map(([slot, ideas]) => ({ slot, title: capitalize(humanize(slot)), ideas })),
  })).filter((group) => group.slots.length > 0)
})
const viewed = computed(() => parseDate(viewDate.value))
const power = computed(() => ({
  balance: politicsSchedule.value.balanceAt(viewed.value),
  gain: politicsSchedule.value.gainAt(viewed.value),
  next: politicsSchedule.value.items.find((item) => item.date > viewed.value),
}))
const optionName = (id: string) => politics.value?.options.find((o) => o.id === id)?.name ?? id
const round = (n: number, decimals = 1) => Number(n.toFixed(decimals))
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

      <section v-if="politics">
        <h3>Political power</h3>
        <p>
          {{ round(power.balance) }} political power, +{{ round(power.gain, 2) }} a day.
          <template v-if="power.next">
            Next purchase: {{ optionName(power.next.optionId) }} on
            {{ formatDate(power.next.date) }}.
          </template>
          <RouterLink to="/politics">Plan political power</RouterLink>
        </p>
        <div v-for="group in staff" :key="group.id" class="group">
          <h4>{{ group.name }}</h4>
          <ul class="ideas">
            <li v-for="slot in group.slots" :key="slot.slot" class="idea">
              <div class="muted">{{ slot.title }}</div>
              <div v-for="idea in slot.ideas" :key="idea.id">
                <strong>{{ idea.name }}</strong>
                <div class="muted">
                  <template v-if="idea.focusId === START_ID">at game start</template>
                  <template v-else>since {{ formatDate(idea.since) }}</template>
                </div>
                <EffectList :effects="idea.modifiers" />
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h3>National spirits</h3>
        <p v-if="spirits.length === 0" class="muted">None.</p>
        <ul class="ideas">
          <li v-for="idea in spirits" :key="idea.id" class="idea">
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

      <section v-if="techModifiers.length > 0">
        <h3>Modifiers from technology</h3>
        <p class="muted">
          From the technologies the country has on this date: the ones it starts with, the ones
          focuses hand out and the research planned by then.
        </p>
        <StatTotals :items="techModifiers" />
      </section>

      <section v-if="stats.length > 0">
        <h3>Stats</h3>
        <StatTotals :items="stats" />
      </section>

      <section v-if="research">
        <h3>Research</h3>
        <p>
          {{ researchStatus.slots }} research slots; {{ researchStatus.finished.length }} planned
          technologies done<template v-if="researchStatus.inProgress.length > 0">
            and {{ researchStatus.inProgress.length }} in progress</template
          >.
          <RouterLink to="/research">Plan research</RouterLink>
        </p>
        <ul v-if="researchStatus.inProgress.length > 0" class="totals">
          <li v-for="item in researchStatus.inProgress" :key="item.techId">
            {{ techName(item.techId) }} (done {{ formatDate(item.end) }})
          </li>
        </ul>
        <template v-if="researchStatus.unusedBonuses.length > 0">
          <p class="muted">Research bonuses not used yet:</p>
          <ul class="totals">
            <li
              v-for="b in researchStatus.unusedBonuses"
              :key="`${b.bonus.ref.focusId}${b.bonus.ref.index}`"
              class="good"
            >
              {{ b.bonus.name }}: +{{ Math.round(b.bonus.bonus * 100) }}% for
              {{ (b.bonus.targetNames ?? b.bonus.targets).join(', ') }} ({{ b.left }}x left)
            </li>
          </ul>
        </template>
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
.group h4 {
  margin: 0.5rem 0 0.25rem;
}
.conditional {
  margin: 0.5rem 0;
}
</style>
