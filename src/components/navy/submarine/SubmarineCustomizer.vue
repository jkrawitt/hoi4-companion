<script setup lang="ts">
import { ref } from 'vue'
import type { SubmarineHull } from './SubmarineCard.vue'

const hullType = ref<SubmarineHull | null>(null)
// const emit = defineEmits(['updateHull'])
const emit = defineEmits<{
  (event: 'updateHull', value: SubmarineHull | null): void
}>()

const SubmarineHull1: SubmarineHull = {
  id: 'Early Submarine Hull',
  Manpower: 200,
  SurfaceVisibility: 1,
  MaxSpeed: 13,
  WeatherPenalty: 1,
  Reliability: 0.6,
  ProductionCost: 320,
  SurfaceDetection: 20,
  SubVisibility: 25,
  MaxRange: 2000,
  Hp: 10,
  FuelUsage: 1,
}
const SubmarineHull2: SubmarineHull = {
  id: '1936 Submarine Hull',
  Manpower: 200,
  SurfaceVisibility: 1,
  MaxSpeed: 17,
  WeatherPenalty: 1,
  Reliability: 0.7,
  ProductionCost: 350,
  SurfaceDetection: 20,
  SubVisibility: 22,
  MaxRange: 4000,
  Hp: 20,
  FuelUsage: 1,
}
const SubmarineHull3: SubmarineHull = {
  id: '1940 Submarine Hull',
  Manpower: 200,
  SurfaceVisibility: 1,
  MaxSpeed: 18,
  WeatherPenalty: 1,
  Reliability: 0.75,
  ProductionCost: 420,
  SurfaceDetection: 20,
  SubVisibility: 20,
  MaxRange: 5000,
  Hp: 30,
  FuelUsage: 1,
}
const SubmarineHull4: SubmarineHull = {
  id: '1944 Submarine Hull',
  Manpower: 200,
  SurfaceVisibility: 1,
  MaxSpeed: 18,
  WeatherPenalty: 1,
  Reliability: 0.8,
  ProductionCost: 550,
  SurfaceDetection: 20,
  SubVisibility: 15,
  MaxRange: 6000,
  Hp: 35,
  FuelUsage: 1,
}

const submarineHulls = [SubmarineHull1, SubmarineHull2, SubmarineHull3, SubmarineHull4]

const onHullChange = () => {
  const hull = submarineHulls.find((h) => hullType.value !== null && h.id === hullType.value.id)
  emit('updateHull', hull || null)
}
</script>

<template>
  <h1>Submarine Customizer & Analyzer</h1>
  <div>Choose your parts:</div>
  <select name="hull type" v-model="hullType" v-on:change="onHullChange">
    <!-- <option :value="null">Select a hull</option> -->
    <option v-for="hull in submarineHulls" :key="hull.id" :value="hull">
      {{ hull.id }}
    </option>
  </select>
  <br />
</template>
