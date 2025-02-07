<script setup lang="ts">
import { ref } from 'vue'
import type {
  SubmarineEngine,
  SubmarineHull,
  SubmarineModule,
  SubmarineTorpedo,
} from './SubmarineCard.vue'

const hullType = ref<SubmarineHull | null>(null)
const engineType = ref<SubmarineEngine | null>(null)
const fixedModule = ref<SubmarineModule | null>(null)

const emit = defineEmits<{
  (event: 'updateHull', value: SubmarineHull | null): void
  (event: 'updateEngine', value: SubmarineEngine | null): void
  (event: 'updateFixedModule', value: SubmarineModule | null): void
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
  CustomModules: 1,
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
  CustomModules: 1,
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
  CustomModules: 3,
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
  CustomModules: 3,
}

const SubmarineEngine1: SubmarineEngine = {
  id: 'Submarine Engine I',
  Category: 'engine',
  SubVisibilityFactor: 1,
  MaxSpeedFactor: 1.05,
  FuelUsage: 7,
  ProductionCostFactor: 1.1,
  ProductionCost: 0,
}
const SubmarineEngine2: SubmarineEngine = {
  id: 'Submarine Engine II',
  Category: 'engine',
  SubVisibilityFactor: 1,
  MaxSpeedFactor: 1.1,
  FuelUsage: 8,
  ProductionCostFactor: 1.125,
  ProductionCost: 0,
}
const SubmarineEngine3: SubmarineEngine = {
  id: 'Submarine Engine III',
  Category: 'engine',
  SubVisibilityFactor: 1,
  MaxSpeedFactor: 1.15,
  FuelUsage: 10,
  ProductionCostFactor: 1.15,
  ProductionCost: 0,
}
const SubmarineEngine4: SubmarineEngine = {
  id: 'Submarine Engine IV',
  Category: 'engine',
  SubVisibilityFactor: 1,
  MaxSpeedFactor: 1.2,
  FuelUsage: 10,
  ProductionCostFactor: 1.2,
  ProductionCost: 0,
}

const SubmarineTorpedoes1: SubmarineTorpedo = {
  id: 'Torpedo Tubes I',
  Category: 'torpedo',
  TorpedoAttack: 13,
  TorpedoHitChanceFactor: 0.01,
  MaxSpeedFactor: 0.99,
  ReliabilityFactor: 1,
  ProductionCost: 80,
}
const SubmarineTorpedoes2: SubmarineTorpedo = {
  id: 'Torpedo Tubes II',
  Category: 'torpedo',
  TorpedoAttack: 18,
  TorpedoHitChanceFactor: 0.01,
  MaxSpeedFactor: 0.98,
  ReliabilityFactor: 1,
  ProductionCost: 100,
}
const SubmarineTorpedoes3: SubmarineTorpedo = {
  id: 'Torpedo Tubes III',
  Category: 'torpedo',
  TorpedoAttack: 22,
  TorpedoHitChanceFactor: 0.015,
  MaxSpeedFactor: 0.97,
  ReliabilityFactor: 1,
  ProductionCost: 120,
}
const SubmarineTorpedoes4: SubmarineTorpedo = {
  id: 'Torpedo Tubes IV',
  Category: 'torpedo',
  TorpedoAttack: 28,
  TorpedoHitChanceFactor: 0.02,
  MaxSpeedFactor: 0.96,
  ReliabilityFactor: 1,
  ProductionCost: 140,
}

const submarineHulls = [SubmarineHull1, SubmarineHull2, SubmarineHull3, SubmarineHull4]
const submarineEngines = [SubmarineEngine1, SubmarineEngine2, SubmarineEngine3, SubmarineEngine4]
const submarineModules = [
  SubmarineTorpedoes1,
  SubmarineTorpedoes2,
  SubmarineTorpedoes3,
  SubmarineTorpedoes4,
]

const onHullChange = () => {
  const hull = submarineHulls.find((h) => hullType.value !== null && h.id === hullType.value.id)
  emit('updateHull', hull || null)
}

const onEngineChange = () => {
  const engine = submarineEngines.find(
    (e) => engineType.value !== null && e.id === engineType.value.id,
  )
  emit('updateEngine', engine || null)
}

const onFixedModuleChange = () => {
  const module = submarineModules.find(
    (m) => fixedModule.value !== null && m.id === fixedModule.value.id,
  )
  emit('updateFixedModule', module || null)
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
  <select name="engine type" v-model="engineType" v-on:change="onEngineChange">
    <option v-for="engine in submarineEngines" :key="engine.id" :value="engine">
      {{ engine.id }}
    </option>
  </select>
  <select name="module" v-model="fixedModule" v-on:change="onFixedModuleChange">
    <option v-for="module in submarineModules" :key="module.id" :value="module">
      {{ module.id }}
    </option>
  </select>
  <br />
</template>
