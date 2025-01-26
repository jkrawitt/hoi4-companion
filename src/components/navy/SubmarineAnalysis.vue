<script setup lang="ts">
import type { Submarine } from './SubmarineCard.vue'

defineProps<{
  year: number
  sub: Submarine
}>()

const baseDockyardOutput = 2.5

const torpedoHitProfile = 100
const depthChargeHitProfile = 100
const torpedoBaseHitChance = 0.1

const depthChargeBaseHitChance = 0.11

const minTorpedoDamage = (sub: Submarine) => {
  return sub.CombatStats.TorpedoAttack * 0.975
}

const maxTorpedoDamage = (sub: Submarine) => {
  return sub.CombatStats.TorpedoAttack * 1.475
}

const hitProfile = (sub: Submarine) => {
  return (sub.MiscStats.SubVisibility * 100) / (0.5 * sub.BaseStats.MaxSpeed + 20)
}

const torpedoConvoyHitChance = () => {
  return torpedoBaseHitChance * Math.pow(85 / torpedoHitProfile, 2)
}

const depthChargeHitChance = (sub: Submarine) => {
  return (
    depthChargeBaseHitChance * Math.min(Math.pow(hitProfile(sub) / depthChargeHitProfile, 2), 1)
  )
}

const attackRevealChance = (sub: Submarine, positioning: number) => {
  return 1 * 0.035 * (sub.MiscStats.SubVisibility / 100) * (3 - 2 * positioning)
}

const dailyAttackRevealChance = (attackRevealChance: number) => {
  return 1 - Math.pow(1 - attackRevealChance, 6)
}

const passiveRevealChance = (sub: Submarine, enemyDetection: number) => {
  return Math.pow((sub.MiscStats.SubVisibility / 100 + enemyDetection / 100) * 11, 3) / 100000
}

const dailyPassiveRevealChance = (passiveRevealChance: number) => {
  return 1 - Math.pow(1 - passiveRevealChance, 24)
}
</script>

<template>
  <br />
  <div>Analysis for this submarine in the year {{ year }}:</div>
  <br />
  <div>Production statistics:</div>
  <div>
    A singe submarine would cost an IC of {{ sub.ProductionCost }}, or
    {{ sub.ProductionCost / 2.5 }} days worth of dockyard production. A 15 dockyard production line
    will produce one of these ships every {{ sub.ProductionCost / baseDockyardOutput / 15 }} days.
  </div>
  <div>
    A 10 sub wolfpack would cost an IC of {{ sub.ProductionCost * 10 }}. A 15 dockyard production
    line will produce one of these wolfpacks every {{ (sub.ProductionCost / 2.5 / 15) * 10 }} days.
  </div>
  <div>IC to Torpedo Attack ratio: {{ sub.ProductionCost / sub.CombatStats.TorpedoAttack }}</div>
  <br>
  <div>Combat simulations (experimental):</div>
  <div>Attacking:</div>
  <div>Relevant stats: Torpedo Attack</div>
  <div>
    Each time your submarine fires at a convoy, it has a {{ torpedoConvoyHitChance() * 100 }}%
    chance to hit.
  </div>
  <div>
    Your submarine has {{ sub.CombatStats.TorpedoAttack }} torpedo attack. This means that each time
    a torpedo hits, your submarine will deal between {{ minTorpedoDamage(sub) }} and
    {{ maxTorpedoDamage(sub) }} damage.
  </div>
  <div>
    As convoys have 60 HP, your submarine will take between
    {{ Math.ceil(60 / maxTorpedoDamage(sub)) }} and {{ Math.ceil(60 / minTorpedoDamage(sub)) }} hits
    to sink a convoy.
  </div>
  <br />
  <div>Defending:</div>
  <div>Relevant stats: Sub Visibility, Max Speed</div>
  <div>Your submarine has {{ sub.MiscStats.SubVisibility }} visibility.</div>
  <div>
    If you are fighting any ship with sub detection (not a convoy), there is a
    {{ attackRevealChance(sub, 1) * 100 }}% chance for your submarine to be revealed each time it
    fires. (Every 4 hours by default, assuming 100% positioning).
  </div>
  <div>
    This accounts to a {{ dailyAttackRevealChance(attackRevealChance(sub, 1)) * 100 }}% chance of
    being revealed by firing each day.
  </div>
  <div>
    If you are fighting any ship with sub detection (not a convoy), there is a
    {{ passiveRevealChance(sub, 25) * 100 }}% chance for your submarine to be revealed passively
    every hour. (assuming 100% positioning and 25 average enemy sub detection).
  </div>
  <div>
    This accounts to a
    {{ dailyPassiveRevealChance(passiveRevealChance(sub, 25)) * 100 }}% chance of being revealed
    passively each day.
  </div>
  <br />
  <div>
    Your submarine has {{ sub.MiscStats.SubVisibility }} visibility and
    {{ sub.BaseStats.MaxSpeed }} maximum speed. This means that, if revealed, a depth charge attack
    targeting this submarine will hit {{ depthChargeHitChance(sub) * 100 }}% of the time.
  </div>
</template>
