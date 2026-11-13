<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Focus } from '@/domain/focus'
import { layoutFocuses } from '@/domain/plan/focusLayout'
import EffectList from './EffectList.vue'

const props = defineProps<{
  focuses: Record<string, Focus>
  /** Ordered focus ids in the current plan. */
  plan: string[]
  /** Focuses that cannot be selected because they conflict with the current plan. */
  blockedIds: Set<string>
}>()

const emit = defineEmits<{ (event: 'toggle', id: string): void }>()

// Grid geometry in px. A grid unit is half a card wide, as in the game, where focuses on
// neighbouring rows are often offset by 1 and on the same row by 2.
const X_UNIT = 80
const Y_UNIT = 120
const CARD_W = 152
const CARD_H = 88
const PAD = 20

const positions = computed(() => layoutFocuses(Object.values(props.focuses)))

const boxes = computed(() =>
  Object.values(props.focuses).map((focus) => ({
    focus,
    left: PAD + positions.value[focus.id].x * X_UNIT,
    top: PAD + positions.value[focus.id].y * Y_UNIT,
  })),
)

const size = computed(() => ({
  width: Math.max(0, ...boxes.value.map((b) => b.left + CARD_W)) + PAD,
  height: Math.max(0, ...boxes.value.map((b) => b.top + CARD_H)) + PAD,
}))

interface Line {
  key: string
  d: string
  kind: 'required' | 'either' | 'exclusive'
}

const lines = computed<Line[]>(() => {
  const at = (id: string) => {
    const p = positions.value[id]
    return { left: PAD + p.x * X_UNIT, top: PAD + p.y * Y_UNIT }
  }
  const result: Line[] = []
  for (const focus of Object.values(props.focuses)) {
    const to = at(focus.id)
    for (const group of focus.prerequisites) {
      for (const parentId of group) {
        if (!props.focuses[parentId]) continue
        const from = at(parentId)
        const sx = from.left + CARD_W / 2
        const sy = from.top + CARD_H
        const ex = to.left + CARD_W / 2
        const ey = to.top
        const midY = (sy + ey) / 2
        result.push({
          key: `${parentId}>${focus.id}`,
          d: `M${sx} ${sy} V${midY} H${ex} V${ey}`,
          kind: group.length > 1 ? 'either' : 'required',
        })
      }
    }
    for (const otherId of focus.mutuallyExclusive) {
      // Draw each pair once.
      if (!props.focuses[otherId] || otherId < focus.id) continue
      const other = at(otherId)
      const y1 = to.top + CARD_H / 2
      const y2 = other.top + CARD_H / 2
      const [left, right] = to.left <= other.left ? [to, other] : [other, to]
      result.push({
        key: `${focus.id}|${otherId}`,
        d: `M${left.left + CARD_W} ${y1} L${right.left} ${y2}`,
        kind: 'exclusive',
      })
    }
  }
  return result
})

// Hover details. The tooltip is `position: fixed` so the scrolling viewport cannot clip it.
const TOOLTIP_W = 340
const hovered = ref<{ focus: Focus; left: number; top: number } | null>(null)

const showDetails = (focus: Focus, event: Event) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const fitsRight = rect.right + 8 + TOOLTIP_W <= window.innerWidth
  hovered.value = {
    focus,
    left: fitsRight ? rect.right + 8 : Math.max(8, rect.left - 8 - TOOLTIP_W),
    top: Math.min(rect.top, Math.max(8, window.innerHeight - 320)),
  }
}
const hideDetails = () => (hovered.value = null)

const nameOf = (id: string) => props.focuses[id]?.name ?? id

const orderOf = computed(() => {
  const order = new Map<string, number>()
  props.plan.forEach((id, i) => {
    if (!order.has(id)) order.set(id, i + 1)
  })
  return order
})
</script>

<template>
  <div class="legend">
    <span class="swatch required"></span> required <span class="swatch either"></span> one of
    several <span class="swatch exclusive"></span> mutually exclusive
  </div>
  <div class="viewport">
    <div class="canvas" :style="{ width: `${size.width}px`, height: `${size.height}px` }">
      <svg :width="size.width" :height="size.height">
        <path v-for="line in lines" :key="line.key" :d="line.d" :class="['line', line.kind]" />
      </svg>
      <button
        v-for="box in boxes"
        :key="box.focus.id"
        :class="[
          'card',
          { planned: orderOf.has(box.focus.id), blocked: blockedIds.has(box.focus.id) },
        ]"
        :style="{
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${CARD_W}px`,
          height: `${CARD_H}px`,
        }"
        :disabled="blockedIds.has(box.focus.id)"
        @click="emit('toggle', box.focus.id)"
        @mouseenter="showDetails(box.focus, $event)"
        @mouseleave="hideDetails"
        @focus="showDetails(box.focus, $event)"
        @blur="hideDetails"
      >
        <span v-if="orderOf.has(box.focus.id)" class="order">{{ orderOf.get(box.focus.id) }}</span>
        <span class="name">{{ box.focus.name }}</span>
        <span class="days">{{ box.focus.days }}d</span>
      </button>
    </div>
  </div>
  <div
    v-if="hovered"
    class="tooltip"
    role="tooltip"
    :style="{ left: `${hovered.left}px`, top: `${hovered.top}px`, width: `${TOOLTIP_W}px` }"
  >
    <strong>{{ hovered.focus.name }}</strong>
    <div class="meta">{{ hovered.focus.days }} days</div>
    <p v-if="hovered.focus.description" class="desc">{{ hovered.focus.description }}</p>
    <div v-if="hovered.focus.prerequisites.length > 0" class="meta">
      Requires
      <template v-for="(group, i) in hovered.focus.prerequisites" :key="i">
        <template v-if="i > 0">, and </template>{{ group.map(nameOf).join(' or ') }}
      </template>
    </div>
    <div v-if="hovered.focus.mutuallyExclusive.length > 0" class="meta">
      Excludes {{ hovered.focus.mutuallyExclusive.map(nameOf).join(', ') }}
    </div>
    <template v-if="hovered.focus.effects.length > 0">
      <div class="heading">Effects</div>
      <EffectList :effects="hovered.focus.effects" />
    </template>
  </div>
</template>

<style scoped>
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
.tooltip .desc {
  margin: 6px 0;
  font-style: italic;
  white-space: pre-line;
}
.tooltip .heading {
  margin-top: 6px;
  font-weight: 600;
}
.tooltip :deep(.effects) {
  margin-top: 2px;
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
  padding: 4px 6px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  gap: 2px;
  font: inherit;
  font-size: 13px;
  line-height: 1.25;
  color: #222;
  background: #fff;
  border: 2px solid #999;
  border-radius: 4px;
  cursor: pointer;
}
.card:hover {
  border-color: #333;
}
.card.planned {
  border-color: #2f7d4f;
  background: #e9f6ee;
}
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
.days {
  color: #666;
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
</style>
