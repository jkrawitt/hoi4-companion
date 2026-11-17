<script setup lang="ts">
import CampaignTimeline from '@/components/timeline/CampaignTimeline.vue'
</script>

<template>
  <!-- One root element, which KeepAlive needs to cache the page. -->
  <div>
    <CampaignTimeline />
  </div>
</template>
