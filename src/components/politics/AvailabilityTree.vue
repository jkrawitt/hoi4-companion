<script setup lang="ts">
import type { CheckView } from '@/domain/campaign/checkView'

defineProps<{ view: CheckView }>()

const mark = (holds: boolean | undefined) => (holds === undefined ? '?' : holds ? '✓' : '✗')
const label = (view: CheckView) => view.text || (view.join === 'any' ? 'Any of:' : 'All of:')
</script>

<template>
  <div class="check" :class="{ yes: view.holds === true, no: view.holds === false }">
    <span class="mark">{{ mark(view.holds) }}</span>
    <span class="text">{{ label(view) }}</span>
    <ul v-if="view.children.length > 0">
      <li v-for="(child, i) in view.children" :key="i">
        <AvailabilityTree :view="child" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.check {
  color: #666;
}
.check.yes {
  color: #1d6b2f;
}
.check.no {
  color: #a32020;
}
.mark {
  display: inline-block;
  width: 1.1em;
  font-weight: 700;
}
ul {
  margin: 0.1rem 0 0.1rem 0.9rem;
  padding: 0;
  list-style: none;
}
</style>
