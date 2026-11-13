<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { countries } from '@/data/countries'
import { useCampaign } from '@/stores/campaign'

const campaign = useCampaign()
</script>

<template>
  <header class="top">
    <h1>HoI4 Companion</h1>
    <nav>
      <RouterLink to="/">Overview</RouterLink>
      <RouterLink to="/focus">Focus plan</RouterLink>
      <RouterLink to="/research">Research plan</RouterLink>
    </nav>
    <label class="country">
      Country
      <select v-model="campaign.countryTag.value">
        <option v-for="c in countries" :key="c.tag" :value="c.tag">{{ c.name }}</option>
      </select>
    </label>
  </header>

  <RouterView v-slot="{ Component }">
    <KeepAlive>
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>

<style scoped>
.top {
  display: flex;
  align-items: baseline;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #ddd;
}
h1 {
  margin: 0;
  font-size: 1.4rem;
}
nav {
  display: flex;
  gap: 1rem;
}
nav a {
  color: inherit;
  text-decoration: none;
  padding-bottom: 2px;
}
nav a.router-link-exact-active {
  font-weight: 700;
  border-bottom: 2px solid #2f4f6f;
}
.country {
  margin-left: auto;
}
</style>
