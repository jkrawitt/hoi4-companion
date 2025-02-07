<script setup lang="ts">
import SubmarineAnalysis from './SubmarineAnalysis.vue'
import { type Ship } from '../ShipStatsTable.vue'
import ShipStatsTable from '../ShipStatsTable.vue'
import SubmarineCustomizer from './SubmarineCustomizer.vue'
import { ref } from 'vue'

export interface Submarine extends Ship {
  Hull: SubmarineHull
  Engine: SubmarineEngine
  Modules: SubmarineModule[]
  TorpedoHitChanceFactor: number
}

export interface SubmarineModule {
  id: string
  Category: string
  ProductionCost: number
}

export interface SubmarineHull {
  id: string
  Manpower: number
  SurfaceVisibility: number
  MaxSpeed: number
  WeatherPenalty: number
  Reliability: number
  ProductionCost: number
  SurfaceDetection: number
  SubVisibility: number
  MaxRange: number
  Hp: number
  FuelUsage: number
  CustomModules: number
}

export interface SubmarineEngine extends SubmarineModule {
  SubVisibilityFactor: number
  MaxSpeedFactor: number
  FuelUsage: number
  ProductionCostFactor: number
}

export interface SubmarineTorpedo extends SubmarineModule {
  TorpedoAttack: number
  TorpedoHitChanceFactor: number
  MaxSpeedFactor: number
  ReliabilityFactor: number
}

interface SubmarineMinelaying extends SubmarineModule {
  Minelaying: number
  MaxSpeedFactor: number
}

interface SubmarineRadar extends SubmarineModule {
  SurfaceDetection: number
  SubDetection: number
}

interface SubmarineSnorkel extends SubmarineModule {
  SubVisibilityFactor: number
}

const selectedHull = ref<SubmarineHull | null>(null)
const handleHullChange = (hull: SubmarineHull | null) => {
  selectedHull.value = hull
}

const selectedEngine = ref<SubmarineEngine | null>(null)
const handleEngineChange = (engine: SubmarineEngine | null) => {
  selectedEngine.value = engine
}

const selectedFixedModule = ref<SubmarineModule | null>(null)
const handleFixedModuleChange = (module: SubmarineModule | null) => {
  selectedFixedModule.value = module
}

const calculateSubmarine = (
  hull: SubmarineHull,
  engine: SubmarineEngine,
  modules: SubmarineModule[],
): Submarine => {
  const sub: Submarine = {
    BaseStats: {
      MaxSpeed: hull.MaxSpeed * engine.MaxSpeedFactor,
      MaxRange: hull.MaxRange,
      Organization: 30,
      HP: hull.Hp,
      Reliability: hull.Reliability,
      SupplyUse: 0.04,
      Manpower: hull.Manpower,
    },
    CombatStats: {
      LightAttack: 0,
      LightPiercing: 0,
      HeavyAttack: 0,
      HeavyPiercing: 0,
      TorpedoAttack: 0,
      DepthCharges: 0,
      Armor: 0,
      AntiAir: 0,
    },
    MiscStats: {
      FuelUsage: hull.FuelUsage + engine.FuelUsage,
      SurfaceVisibility: hull.SurfaceVisibility,
      SurfaceDetection: hull.SurfaceDetection,
      SubVisibility: hull.SubVisibility,
      SubDetection: 0,
      Minelaying: 0,
      Minesweeping: 0,
      WeatherPenalty: hull.WeatherPenalty,
    },
    ProductionCost: hull.ProductionCost * engine.ProductionCostFactor,
    Hull: hull,
    Engine: engine,
    Modules: modules,
    TorpedoHitChanceFactor: 0,
  }

  modules.forEach((module) => {
    applySubmarineModule(sub, module)
  })

  return sub
}

const applySubmarineModule = (sub: Submarine, module: SubmarineModule) => {
  switch (module.Category) {
    case 'torpedo':
      return applySubmarineTorpedoStats(sub, module as SubmarineTorpedo)
    case 'mines':
      return applySubmarineMineStats(sub, module as SubmarineMinelaying)
    case 'radar':
      return applySubmarineRadarStats(sub, module as SubmarineRadar)
    case 'snorkel':
      return applySubmarineSnorkelStats(sub, module as SubmarineSnorkel)
    default:
      throw new Error('unknown module')
  }
}

const applySubmarineTorpedoStats = (sub: Submarine, torpedo: SubmarineTorpedo) => {
  sub.CombatStats.TorpedoAttack += torpedo.TorpedoAttack
  sub.TorpedoHitChanceFactor += torpedo.TorpedoHitChanceFactor
  sub.BaseStats.MaxSpeed *= torpedo.MaxSpeedFactor
  sub.BaseStats.Reliability *= torpedo.ReliabilityFactor
  sub.ProductionCost += torpedo.ProductionCost
  return sub
}

const applySubmarineMineStats = (sub: Submarine, mines: SubmarineMinelaying) => {
  sub.MiscStats.Minelaying += mines.Minelaying
  sub.BaseStats.MaxSpeed *= mines.MaxSpeedFactor
  sub.ProductionCost += mines.ProductionCost
  return sub
}

const applySubmarineRadarStats = (sub: Submarine, radar: SubmarineRadar) => {
  sub.MiscStats.SurfaceDetection += radar.SurfaceDetection
  sub.MiscStats.SubDetection += radar.SubDetection
  sub.ProductionCost += radar.ProductionCost
  return sub
}

const applySubmarineSnorkelStats = (sub: Submarine, snorkel: SubmarineSnorkel) => {
  sub.MiscStats.SubVisibility *= snorkel.SubVisibilityFactor
  sub.ProductionCost += snorkel.ProductionCost
  return sub
}
</script>

<template>
  <SubmarineCustomizer
    @update-hull="handleHullChange"
    @update-engine="handleEngineChange"
    @update-fixed-module="handleFixedModuleChange"
  ></SubmarineCustomizer>
  <ShipStatsTable
    v-if="selectedHull != null && selectedEngine != null && selectedFixedModule != null"
    :ship="calculateSubmarine(selectedHull, selectedEngine, [selectedFixedModule])"
  ></ShipStatsTable>
  <SubmarineAnalysis
    v-if="selectedHull != null && selectedEngine != null && selectedFixedModule != null"
    :year="1936"
    :sub="calculateSubmarine(selectedHull, selectedEngine, [selectedFixedModule])"
  ></SubmarineAnalysis>
</template>
