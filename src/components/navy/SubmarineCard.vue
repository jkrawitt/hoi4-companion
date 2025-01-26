<script setup lang="ts">
import SubmarineAnalysis from './SubmarineAnalysis.vue'

export type Submarine = {
  BaseStats: SubmarineBaseStats
  CombatStats: SubmarineCombatStats
  MiscStats: SubmarineMiscStats
  ProductionCost: number
}

type SubmarineBaseStats = {
  MaxSpeed: number
  MaxRange: number
  Organization: number
  HP: number
  Reliability: number
  SupplyUse: number
  Manpower: number
}

type SubmarineCombatStats = {
  LightAttack: number
  LightPiercing: number
  HeavyAttack: number
  HeavyPiercing: number
  TorpedoAttack: number
  DepthCharges: number
  Armor: number
  AntiAir: number
}

type SubmarineMiscStats = {
  FuelUsage: number
  SurfaceVisibility: number
  SurfaceDetection: number
  SubVisibility: number
  SubDetection: number
  Minelaying: number
  Minesweeping: number
  WeatherPenalty: number
}

type SubmarineHull = {
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

type SubmarineEngine = {
  SubVisibilityFactor: number
  MaxSpeedFactor: number
  FuelUsage: number
  ProductionCostFactor: number
}

type SubmarineWeapon = {
  TorpedoAttack: number
  MaxSpeedFactor: number
  TorpedoHitChanceFactor: number
  ProductionCost: number
}

const SubmarineHull1: SubmarineHull = {
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

const SubmarineEngine1: SubmarineEngine = {
  SubVisibilityFactor: 1,
  MaxSpeedFactor: 1.05,
  FuelUsage: 7,
  ProductionCostFactor: 1.1,
}

const SubmarineTorpedoes1: SubmarineWeapon = {
  TorpedoAttack: 13,
  MaxSpeedFactor: 0.99,
  TorpedoHitChanceFactor: 1,
  ProductionCost: 80,
}

const calculateSubmarine = (
  hull: SubmarineHull,
  engine: SubmarineEngine,
  weapons: SubmarineWeapon[],
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
  }

  weapons.forEach((weapon) => {
    sub.CombatStats.TorpedoAttack += weapon.TorpedoAttack
    sub.BaseStats.MaxSpeed *= weapon.MaxSpeedFactor
    sub.ProductionCost += weapon.ProductionCost
  })

  return sub
}

// const AnalyzeSubmarine = (sub: Submarine, year: number) => {
//   return "this sub is pretty good! it has lots of torpedo attack: " + sub.CombatStats.TorpedoAttack
// }

const testSub = calculateSubmarine(SubmarineHull1, SubmarineEngine1, [
  SubmarineTorpedoes1,
  SubmarineTorpedoes1,
])
</script>

<template>
  <div>{{ testSub }}</div>
  <SubmarineAnalysis :year="1936" :sub="testSub"></SubmarineAnalysis>
  
</template>
