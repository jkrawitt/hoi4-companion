<script setup lang="ts">
import FocusPlanner from '@/components/focus/FocusPlanner.vue'
</script>

<template>
  <!-- One root element, which KeepAlive needs to cache the page. -->
  <div>
    <FocusPlanner />
  </div>
</template>
