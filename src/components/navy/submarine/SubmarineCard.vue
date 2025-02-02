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

interface SubmarineModule {
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
}

interface SubmarineEngine extends SubmarineModule {
  SubVisibilityFactor: number
  MaxSpeedFactor: number
  FuelUsage: number
  ProductionCostFactor: number
}

interface SubmarineTorpedo extends SubmarineModule {
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

const SubmarineEngine1: SubmarineEngine = {
  Category: 'engine',
  SubVisibilityFactor: 1,
  MaxSpeedFactor: 1.05,
  FuelUsage: 7,
  ProductionCostFactor: 1.1,
  ProductionCost: 0,
}

const SubmarineTorpedoes1: SubmarineTorpedo = {
  Category: 'torpedo',
  TorpedoAttack: 13,
  TorpedoHitChanceFactor: 0.01,
  MaxSpeedFactor: 0.99,
  ReliabilityFactor: 1,
  ProductionCost: 80,
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
  <SubmarineCustomizer @update-hull="handleHullChange"></SubmarineCustomizer>
  <ShipStatsTable
    v-if="selectedHull != null"
    :ship="
      calculateSubmarine(selectedHull, SubmarineEngine1, [SubmarineTorpedoes1, SubmarineTorpedoes1])
    "
  ></ShipStatsTable>
  <SubmarineAnalysis
    v-if="selectedHull != null"
    :year="1936"
    :sub="
      calculateSubmarine(selectedHull, SubmarineEngine1, [SubmarineTorpedoes1, SubmarineTorpedoes1])
    "
  ></SubmarineAnalysis>
</template>
