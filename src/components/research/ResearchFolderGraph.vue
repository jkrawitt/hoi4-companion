<script setup lang="ts">
/**
 * One technology folder at a time, laid out on the folder's own grid like the game's research
 * screen. Clicking a tech queues it with the prerequisites it needs (or removes it and what
 * depends on it); each card shows whether the country starts with it, when it is planned to be
 * done, or why it cannot be chosen.
 */
import { computed, ref } from 'vue'
import EffectList from '../focus/EffectList.vue'
import { aheadOfTime } from '@/domain/plan/researchPlan'
import type {
  AheadOfTime,
  ResearchDefines,
  ResearchSchedule,
  TechFolder,
  Technology,
} from '@/domain/research'
import { formatDate } from '@/stores/campaign'

const props = defineProps<{
  techs: Technology[]
  folders: TechFolder[]
  /** Ids of the queued techs, in queue order. */
  queue: string[]
  startTechs: Set<string>
  schedule: ResearchSchedule
  /** Techs that cannot be added because they conflict with the queue. */
  blockedIds: Set<string>
  /** The research numbers, for the ahead-of-time penalty. */
  defines: ResearchDefines
  /** Planned techs finished by this date count as done. */
  viewDate: Date
  /** When a tech added to the queue would get a slot; none when the country has no slots. */
  freeAt?: Date
}>()

const emit = defineEmits<{ (event: 'toggle', id: string): void }>()

// Grid geometry in px. `x` is a column and `y` a row on the folder's grid, in the game's slots
// (see `placeInTrees`); in a sideways folder the years run along the columns.
const X_UNIT = 112
const Y_UNIT = 64
const CARD_W = 104
const CARD_H = 52
const PAD = 20

const chosen = ref('')
const folderId = computed(() =>
  props.folders.some((f) => f.id === chosen.value) ? chosen.value : (props.folders[0]?.id ?? ''),
)
const byId = computed(() => new Map(props.techs.map((t) => [t.id, t])))
const nameOf = (id: string) => byId.value.get(id)?.name ?? id

const inFolder = computed(() =>
  props.techs.flatMap((tech) => {
    const place = tech.folders.find((f) => f.id === folderId.value)
    return place ? [{ tech, x: place.x, y: place.y }] : []
  }),
)
const minX = computed(() => Math.min(0, ...inFolder.value.map((t) => t.x)))
const minY = computed(() => Math.min(0, ...inFolder.value.map((t) => t.y)))

const boxes = computed(() =>
  inFolder.value.map(({ tech, x, y }) => ({
    tech,
    left: PAD + (x - minX.value) * X_UNIT,
    top: PAD + (y - minY.value) * Y_UNIT,
  })),
)
const boxOf = computed(() => new Map(boxes.value.map((b) => [b.tech.id, b])))

const size = computed(() => ({
  width: Math.max(0, ...boxes.value.map((b) => b.left + CARD_W)) + PAD,
  height: Math.max(0, ...boxes.value.map((b) => b.top + CARD_H)) + PAD,
}))

const sideways = computed(
  () => props.folders.find((f) => f.id === folderId.value)?.sideways === true,
)

type Box = { left: number; top: number }

/** From the bottom of the parent to the top of the child, for trees that run downwards. */
const downPath = (parent: Box, child: Box) => {
  const sx = parent.left + CARD_W / 2
  const sy = parent.top + CARD_H
  const midY = (sy + child.top) / 2
  return `M${sx} ${sy} V${midY} H${child.left + CARD_W / 2} V${child.top}`
}

/** From the right of the parent to the left of the child, for trees that run sideways. */
const sidewaysPath = (parent: Box, child: Box) => {
  const sx = parent.left + CARD_W
  const sy = parent.top + CARD_H / 2
  const midX = (sx + child.left) / 2
  return `M${sx} ${sy} H${midX} V${child.top + CARD_H / 2} H${child.left}`
}

interface Line {
  key: string
  d: string
  kind: 'required' | 'either' | 'exclusive'
}

const lines = computed<Line[]>(() => {
  const result: Line[] = []
  for (const { tech, left, top } of boxes.value) {
    for (const group of tech.prerequisites) {
      for (const parentId of group) {
        const parent = boxOf.value.get(parentId)
        if (!parent) continue
        result.push({
          key: `${parentId}>${tech.id}`,
          d: sideways.value ? sidewaysPath(parent, { left, top }) : downPath(parent, { left, top }),
          kind: group.length > 1 ? 'either' : 'required',
        })
      }
    }
    for (const otherId of tech.exclusiveWith) {
      const other = boxOf.value.get(otherId)
      // Draw each pair once.
      if (!other || otherId < tech.id) continue
      const [a, b] = left <= other.left ? [{ left, top }, other] : [other, { left, top }]
      result.push({
        key: `${tech.id}|${otherId}`,
        d: `M${a.left + CARD_W} ${a.top + CARD_H / 2} L${b.left} ${b.top + CARD_H / 2}`,
        kind: 'exclusive',
      })
    }
  }
  return result
})

const orderOf = computed(() => new Map(props.queue.map((id, i) => [id, i + 1])))
const itemOf = computed(() => new Map(props.schedule.items.map((item) => [item.techId, item])))

/**
 * The ahead-of-time penalty a tech would carry: on the day it starts in the queue, or else if it
 * were added now, which is when the earliest research slot is free. Nothing for techs the country has, or ones that
 * cannot be researched.
 */
const aheadOf = (tech: Technology): AheadOfTime | null => {
  if (props.startTechs.has(tech.id) || !tech.researchable) return null
  const item = itemOf.value.get(tech.id)
  if (!item && !props.freeAt) return null
  const ahead = item ? item.ahead : aheadOfTime(tech, props.freeAt!, 0, props.defines)
  return ahead.years > 0 ? ahead : null
}

const aheadText = (ahead: AheadOfTime) => {
  const years = Math.round(ahead.years * 10) / 10
  const cost =
    ahead.penalty > 1 ? `x${Math.round(ahead.penalty * 100) / 100} cost` : 'no extra cost'
  const bonus = ahead.ignored > 0 ? `, the bonus ignores ${ahead.ignored} years` : ''
  return `${years} ${years === 1 ? 'year' : 'years'} ahead of time: ${cost}${bonus}`
}

/** What a card says about its tech. */
const stateOf = (tech: Technology) => {
  if (props.startTechs.has(tech.id)) return { kind: 'start', text: 'at start' }
  const item = itemOf.value.get(tech.id)
  if (item) {
    const done = item.end <= props.viewDate
    return {
      kind: done ? 'done' : 'planned',
      text: `${done ? 'done' : 'ready'} ${formatDate(item.end)}`,
    }
  }
  if (orderOf.value.has(tech.id)) return { kind: 'stuck', text: 'cannot finish' }
  if (!tech.researchable) return { kind: 'special', text: 'not researchable' }
  if (props.blockedIds.has(tech.id)) return { kind: 'blocked', text: 'excluded' }
  return { kind: 'free', text: `${tech.startYear} · ${tech.cost}x` }
}

const isDisabled = (tech: Technology) =>
  props.startTechs.has(tech.id) ||
  (!orderOf.value.has(tech.id) && (!tech.researchable || props.blockedIds.has(tech.id)))

// Hover details. The tooltip is `position: fixed` so the scrolling viewport cannot clip it.
const TOOLTIP_W = 340
const hovered = ref<{ tech: Technology; left: number; top: number } | null>(null)

const showDetails = (tech: Technology, event: Event) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const fitsRight = rect.right + 8 + TOOLTIP_W <= window.innerWidth
  hovered.value = {
    tech,
    left: fitsRight ? rect.right + 8 : Math.max(8, rect.left - 8 - TOOLTIP_W),
    top: Math.min(rect.top, Math.max(8, window.innerHeight - 320)),
  }
}
const hideDetails = () => (hovered.value = null)
</script>

<template>
  <div class="tabs" role="tablist">
    <button
      v-for="folder in folders"
      :key="folder.id"
      role="tab"
      :aria-selected="folder.id === folderId"
      :class="{ active: folder.id === folderId }"
      @click="chosen = folder.id"
    >
      {{ folder.name }}
    </button>
  </div>
  <div class="legend">
    <span class="swatch required"></span> needed <span class="swatch either"></span> one of several
    <span class="swatch exclusive"></span> mutually exclusive
    <span class="swatch early"></span> early for its year (costs more)
  </div>
  <div class="viewport">
    <div class="canvas" :style="{ width: `${size.width}px`, height: `${size.height}px` }">
      <svg :width="size.width" :height="size.height">
        <path v-for="line in lines" :key="line.key" :d="line.d" :class="['line', line.kind]" />
      </svg>
      <button
        v-for="box in boxes"
        :key="box.tech.id"
        :class="['card', stateOf(box.tech).kind, { early: aheadOf(box.tech) }]"
        :style="{
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${CARD_W}px`,
          height: `${CARD_H}px`,
        }"
        :disabled="isDisabled(box.tech)"
        @click="emit('toggle', box.tech.id)"
        @mouseenter="showDetails(box.tech, $event)"
        @mouseleave="hideDetails"
        @focus="showDetails(box.tech, $event)"
        @blur="hideDetails"
      >
        <span v-if="orderOf.has(box.tech.id)" class="order">{{ orderOf.get(box.tech.id) }}</span>
        <span class="name">{{ box.tech.name }}</span>
        <span class="state">{{ stateOf(box.tech).text }}</span>
      </button>
    </div>
  </div>
  <div
    v-if="hovered"
    class="tooltip"
    role="tooltip"
    :style="{ left: `${hovered.left}px`, top: `${hovered.top}px`, width: `${TOOLTIP_W}px` }"
  >
    <strong>{{ hovered.tech.name }}</strong>
    <div class="meta">
      {{ hovered.tech.startYear }} · cost {{ hovered.tech.cost }}x
      <template v-if="hovered.tech.categories.length > 0">
        · {{ hovered.tech.categories.map((c) => c.replace(/_/g, ' ')).join(', ') }}
      </template>
    </div>
    <div v-if="hovered.tech.prerequisites.length > 0" class="meta">
      Requires
      <template v-for="(group, i) in hovered.tech.prerequisites" :key="i">
        <template v-if="i > 0">, and </template>{{ group.map(nameOf).join(' or ') }}
      </template>
    </div>
    <div v-if="aheadOf(hovered.tech)" class="meta early-note">
      {{
        itemOf.has(hovered.tech.id)
          ? 'When it starts in the queue:'
          : `If started when a slot is free (${formatDate(props.freeAt!)}):`
      }}
      {{ aheadText(aheadOf(hovered.tech)!) }}
    </div>
    <div v-if="hovered.tech.exclusiveWith.length > 0" class="meta">
      Excludes {{ hovered.tech.exclusiveWith.map(nameOf).join(', ') }}
    </div>
    <div v-if="!hovered.tech.researchable" class="meta">
      Cannot be researched in a slot (a special project or granted by a focus).
    </div>
    <template v-if="hovered.tech.modifiers.length > 0">
      <div class="heading">Effects</div>
      <EffectList :effects="hovered.tech.modifiers" />
    </template>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.tabs button.active {
  font-weight: 700;
  border-color: #2f4f6f;
  background: #e6edf4;
}
.tooltip {
  position: fixed;
  z-index: 10;
  box-sizing: border-box;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.35;
  color: #222;
  background: #fff;
  border: 1px solid #666;
  border-radius: 4px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
  pointer-events: none;
}
.tooltip .meta {
  color: #555;
}
.tooltip .heading {
  margin-top: 6px;
  font-weight: 600;
}
.viewport {
  overflow: auto;
  max-height: 70vh;
  border: 1px solid #ccc;
  background: #f6f6f3;
}
.canvas {
  position: relative;
}
svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.line {
  fill: none;
  stroke-width: 2;
}
.line.required {
  stroke: #888;
}
.line.either {
  stroke: #5b7fa6;
  stroke-dasharray: 6 4;
}
.line.exclusive {
  stroke: #c0392b;
  stroke-dasharray: 2 4;
}
.card {
  position: absolute;
  box-sizing: border-box;
  margin: 0;
  padding: 2px 4px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  gap: 1px;
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  color: #222;
  background: #fff;
  border: 2px solid #999;
  border-radius: 4px;
  cursor: pointer;
}
.card:hover:not(:disabled) {
  border-color: #333;
}
.card.start {
  border-color: #2f4f6f;
  background: #e6edf4;
  cursor: default;
}
.card.planned {
  border-color: #2f7d4f;
  background: #e9f6ee;
}
.card.done {
  border-color: #2f7d4f;
  background: #cfeedb;
}
/* Early for its year: an amber bar underneath, as the cost goes up until its year comes. */
.card.early {
  box-shadow: inset 0 -4px 0 #e0a030;
}
.early-note {
  color: #8a5a00;
}
.card.stuck {
  border-color: #b3261e;
  background: #fbeceb;
}
.card.special,
.card.blocked {
  opacity: 0.45;
  cursor: not-allowed;
  border-style: dashed;
}
.name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-weight: 600;
}
.state {
  color: #666;
  font-size: 11px;
}
.order {
  position: absolute;
  top: -9px;
  left: -9px;
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  box-sizing: border-box;
  border-radius: 9px;
  background: #2f7d4f;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
}
.legend {
  margin-bottom: 0.5rem;
  font-size: 13px;
  color: #444;
}
.swatch {
  display: inline-block;
  width: 24px;
  margin: 0 4px 0 12px;
  border-top: 2px solid;
  vertical-align: middle;
}
.swatch.required {
  border-color: #888;
}
.swatch.either {
  border-color: #5b7fa6;
  border-top-style: dashed;
}
.swatch.exclusive {
  border-color: #c0392b;
  border-top-style: dotted;
}
.swatch.early {
  border-top: 4px solid #e0a030;
}
</style>
