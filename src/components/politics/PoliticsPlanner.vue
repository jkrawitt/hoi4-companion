<script setup lang="ts">
import { computed } from 'vue'
import EffectList from '../focus/EffectList.vue'
import AvailabilityTree from './AvailabilityTree.vue'
import GameDataImport from '../GameDataImport.vue'
import { capitalize, humanize } from '@/domain/effects/lines'
import { purchaseCost, replacedBy, totalsOf } from '@/domain/plan/politicsPlan'
import {
  POLITICS_GROUPS,
  type PoliticalOption,
  type PurchaseIssue,
  type UnscheduledPurchaseReason,
} from '@/domain/politics'
import { formatDate, parseDate, useCampaign } from '@/stores/campaign'
import { useShowOnOverview } from '../overviewLink'
import { yearBanners } from '../yearBanners'

const showOnOverview = useShowOnOverview()
const {
  politics,
  hasData,
  viewDate,
  state,
  availableOnViewDate,
  decisionListed,
  availabilityOnViewDate,
  politicsPlan,
  politicsSchedule,
  addPurchase,
  movePurchase,
  removePurchase,
  setNotBefore,
  resetPolitics,
} = useCampaign()

const REASONS: Record<UnscheduledPurchaseReason, string> = {
  'unknown-option': 'Not found in the game data.',
  'not-held': 'Nothing to dismiss: it is not held at this point.',
  'slots-full': 'The slot is full. Dismiss an advisor first.',
  'is-leader': 'The character leads the country.',
  'not-recruited': 'The character is never recruited.',
  unavailable: 'Never becomes available.',
  unaffordable: 'The political power gain is never enough.',
  'already-taken': 'A decision that can only be taken once is already taken earlier in the queue.',
  'out-of-time': 'Not bought within the years the plan looks ahead.',
}

const issueText = (issue: PurchaseIssue) =>
  issue.kind === 'already-held'
    ? 'Already held, so nothing is bought.'
    : issue.kind === 'cost-unknown'
      ? 'Its cost is a variable the planner cannot know, so it is taken to be free.'
      : 'Its availability cannot be checked, so it is assumed to be available.'

const options = computed(() => politics.value?.options ?? [])
const byId = computed(() => new Map(options.value.map((o) => [o.id, o])))

/** The politics screen: each group with its slots, and the options that fill each slot. */
const groups = computed(() =>
  POLITICS_GROUPS.map((group) => {
    const shown = options.value.filter((o) => o.kind !== 'decision' || decisionListed(o))
    const slots = [...new Set(shown.filter((o) => o.group === group.id).map((o) => o.slot))].map(
      (slot) => ({
        slot,
        title:
          group.id === 'decisions'
            ? (politics.value?.categoryNames[slot] ?? capitalize(humanize(slot)))
            : capitalize(humanize(slot)),
        size: politics.value?.slots[slot] ?? 1,
        held: state.value.politics.held[slot] ?? [],
        options: shown.filter((o) => o.slot === slot),
      }),
    )
    return { ...group, slots }
  }).filter((group) => group.slots.length > 0),
)

const totals = computed(() => totalsOf(state.value.modifierTotals))
const costNow = (option: PoliticalOption) => {
  if (option.kind === 'decision') return purchaseCost(option, totals.value)
  const held = (state.value.politics.held[option.slot] ?? []).map((idea) => idea.id)
  return purchaseCost(option, totals.value, replacedBy(option, held, politics.value?.options ?? []))
}
const isHeld = (option: PoliticalOption) =>
  (option.kind !== 'decision' &&
    state.value.politics.held[option.slot]?.some((idea) => idea.id === option.id)) ??
  false
const queued = (option: PoliticalOption) =>
  politicsPlan.value.some((item) => item.optionId === option.id && !item.dismiss)

const bonusText = (option: PoliticalOption) =>
  Object.entries(option.researchBonus ?? {})
    .map(
      ([category, bonus]) =>
        `${politics.value?.categoryNames[category] ?? humanize(category)} +${Math.round(bonus * 100)}%`,
    )
    .join(', ')

/** Rows are in queue order; a banner marks the year a purchase happens in. */
const rows = computed(() => {
  const nextBanner = yearBanners()
  return politicsPlan.value.map((item, index) => {
    const option = byId.value.get(item.optionId)
    const scheduled = politicsSchedule.value.items.find((s) => s.index === index)
    const left = politicsSchedule.value.unscheduled.find((u) => u.index === index)
    const banner = nextBanner(scheduled?.date)
    return { index, item, option, scheduled, left, banner }
  })
})

const viewed = computed(() => parseDate(viewDate.value))
const balance = computed(() => politicsSchedule.value.balanceAt(viewed.value))
const gain = computed(() => politicsSchedule.value.gainAt(viewed.value))
const teams = computed(() => politicsSchedule.value.designTeamsAt(viewed.value))
const teamCost = computed(() => politics.value?.defines.designTeamCost ?? 0)
const nextPurchase = computed(() =>
  politicsSchedule.value.items.find((item) => item.date > viewed.value),
)
const round = (n: number, decimals = 1) => Number(n.toFixed(decimals))
</script>

<template>
  <h2>Political Power Planner</h2>

  <GameDataImport v-if="!hasData || !politics" />

  <template v-else>
    <p class="hint">
      Click a law, designer, advisor or decision to queue buying it. Each is bought the first day
      the political power is there and it is available, in queue order: an item that cannot be
      afforded yet holds up the ones behind it. The gain formula is a best guess and is not checked
      against the game.
    </p>
    <p>
      On {{ viewDate }}: <strong>{{ round(balance) }}</strong> political power, +{{
        round(gain, 2)
      }}
      a day.
      <template v-if="teams > 0">Design teams: -{{ round(teamCost, 2) }} x {{ teams }}.</template>
      <template v-if="nextPurchase">
        Next purchase:
        {{ byId.get(nextPurchase.optionId)?.name }} on {{ formatDate(nextPurchase.date) }}.
      </template>
    </p>
    <div class="settings">
      <button :disabled="politicsPlan.length === 0" @click="resetPolitics">Reset queue</button>
    </div>

    <div class="layout">
      <div class="screen">
        <section v-for="group in groups" :key="group.id">
          <h3>{{ group.name }}</h3>
          <div v-for="slot in group.slots" :key="slot.slot" class="slot">
            <div class="slot-head">
              <strong>{{ slot.title }}</strong>
              <span v-if="group.id !== 'decisions'" class="muted">
                {{ slot.held.length }}/{{ slot.size }} on {{ viewDate }}:
                {{ slot.held.map((idea) => idea.name).join(', ') || 'empty' }}
              </span>
            </div>
            <ul class="options">
              <li
                v-for="option in slot.options"
                :key="option.id"
                class="option"
                :class="{
                  held: isHeld(option),
                  queued: queued(option),
                  unavailable: option.kind === 'decision' && !availableOnViewDate(option, true),
                }"
              >
                <button
                  class="pick"
                  :title="isHeld(option) ? 'Already held on this date' : 'Queue buying it'"
                  @click="addPurchase(option.id)"
                >
                  {{ option.name }}
                </button>
                <span class="muted cost">{{
                  option.variableCost ? 'cost varies' : `${costNow(option)} PP`
                }}</span>
                <span v-if="availabilityOnViewDate(option)" class="info" tabindex="0">
                  i
                  <div class="tip">
                    <strong>Available on {{ viewDate }}</strong>
                    <AvailabilityTree :view="availabilityOnViewDate(option)!" />
                  </div>
                </span>
                <span v-else></span>
                <button
                  v-if="isHeld(option) && option.kind === 'advisor'"
                  title="Queue dismissing this advisor"
                  @click="addPurchase(option.id, true)"
                >
                  Dismiss
                </button>
                <span v-if="option.kind === 'advisor' && !option.recruited" class="muted">
                  (not recruited)
                </span>
                <div class="tip">
                  <strong>{{ option.name }}</strong>
                  <div v-if="option.researchBonus" class="good">
                    Research bonus: {{ bonusText(option) }}
                  </div>
                  <EffectList :effects="option.modifiers" />
                </div>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <section class="queue">
        <h3>Queue</h3>
        <p v-if="politicsPlan.length === 0">
          Add laws, designers, advisors or decisions to build a queue.
        </p>
        <ol v-else class="plan">
          <template v-for="row in rows" :key="row.index">
            <li v-if="row.banner !== null" class="year-banner">{{ row.banner }}</li>
            <li class="entry">
              <strong>
                <template v-if="row.item.dismiss">Dismiss </template
                >{{ row.option?.name ?? row.item.optionId }}
              </strong>
              <div v-if="row.scheduled">
                <a
                  href="#"
                  title="See the country on this date"
                  @click.prevent="showOnOverview(row.scheduled.date)"
                  >{{ formatDate(row.scheduled.date) }}</a
                >
                <span class="muted">
                  , {{ row.scheduled.cost }} PP, {{ round(row.scheduled.balanceAfter) }} left
                </span>
              </div>
              <div v-if="row.left" class="problem">{{ REASONS[row.left.reason] }}</div>
              <div v-for="(issue, i) in row.scheduled?.issues ?? []" :key="i" class="problem">
                {{ issueText(issue) }}
              </div>
              <div class="controls">
                <label>
                  Not before
                  <input
                    type="date"
                    :value="row.item.notBefore ?? ''"
                    @change="
                      setNotBefore(
                        row.index,
                        ($event.target as HTMLInputElement).value || undefined,
                      )
                    "
                  />
                </label>
                <button
                  :disabled="row.index === 0"
                  title="Move up"
                  @click="movePurchase(row.index, -1)"
                >
                  ↑
                </button>
                <button
                  :disabled="row.index === politicsPlan.length - 1"
                  title="Move down"
                  @click="movePurchase(row.index, 1)"
                >
                  ↓
                </button>
                <button title="Remove from the queue" @click="removePurchase(row.index)">
                  Remove
                </button>
              </div>
            </li>
          </template>
        </ol>
      </section>
    </div>

    <GameDataImport />
  </template>
</template>

<style scoped>
.hint {
  margin-left: 0.5rem;
  color: #666;
}
.settings {
  margin-bottom: 1rem;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr);
  gap: 2rem;
  align-items: start;
}
.slot {
  margin-bottom: 0.75rem;
}
.slot-head {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.options {
  margin: 0.25rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.option {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 24rem) 4.5rem 1.25rem auto auto;
  align-items: baseline;
  gap: 0 0.75rem;
  justify-content: start;
}
.option .pick {
  text-align: left;
  justify-self: start;
}
.option .cost {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.option.held .pick {
  font-weight: 700;
}
.option.unavailable .pick {
  opacity: 0.55;
}
.option.queued .pick {
  outline: 2px solid #2f4f6f;
}
.tip {
  display: none;
  position: absolute;
  z-index: 10;
  top: 100%;
  left: 0;
  min-width: 260px;
  max-width: 420px;
  padding: 0.5rem;
  background: #fff;
  border: 1px solid #999;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.info {
  position: relative;
  justify-self: center;
  width: 1.1rem;
  height: 1.1rem;
  line-height: 1.1rem;
  text-align: center;
  border: 1px solid #888;
  border-radius: 50%;
  font-size: 0.75rem;
  font-style: italic;
  color: #555;
  cursor: help;
}
.info .tip {
  top: 0;
  left: 100%;
  margin-left: 0.4rem;
  font-size: 1rem;
  font-style: normal;
  line-height: normal;
  text-align: left;
  color: #222;
  cursor: default;
}
.info:hover > .tip,
.info:focus > .tip,
.pick:hover ~ .tip {
  display: block;
}
.plan {
  padding: 0;
  list-style: none;
}
.plan > .entry {
  padding: 0.5rem 0;
  border-top: 1px solid #ddd;
}
.good {
  color: #1f7a3d;
}
.problem {
  color: #b3261e;
}
.controls {
  margin-top: 0.25rem;
}
button {
  margin-right: 0.25rem;
}
</style>
