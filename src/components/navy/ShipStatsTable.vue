<script setup lang="ts">
import { addZeros, roundDecimal } from '@/utils'
import { computed } from 'vue'

const props = defineProps<{
  ship: Ship
}>()
// defineProps<{
//   ship: Ship
// }>()

export interface Ship {
  BaseStats: ShipBaseStats
  CombatStats: ShipCombatStats
  MiscStats: ShipMiscStats
  ProductionCost: number
}

type ShipBaseStats = {
  MaxSpeed: number
  MaxRange: number
  Organization: number
  HP: number
  Reliability: number
  SupplyUse: number
  Manpower: number
}

type ShipCombatStats = {
  LightAttack: number
  LightPiercing: number
  HeavyAttack: number
  HeavyPiercing: number
  TorpedoAttack: number
  DepthCharges: number
  Armor: number
  AntiAir: number
}

type ShipMiscStats = {
  FuelUsage: number
  SurfaceVisibility: number
  SurfaceDetection: number
  SubVisibility: number
  SubDetection: number
  Minelaying: number
  Minesweeping: number
  WeatherPenalty: number
}

interface TableCellData {
  header: string
  value: number
  unit: string
  decimals: number
}

type CellDictionary = Record<string, TableCellData>

const shipTableCellData = computed<CellDictionary>(() => ({
  ['1,1']: {
    header: 'Max Speed:',
    value: props.ship.BaseStats.MaxSpeed,
    unit: ' kn',
    decimals: 1,
  },
  ['2,1']: {
    header: 'Max Range:',
    value: props.ship.BaseStats.MaxRange,
    unit: ' km',
    decimals: 0,
  },
  ['3,1']: {
    header: 'Organization:',
    value: props.ship.BaseStats.Organization,
    unit: '',
    decimals: 1,
  },
  ['4,1']: {
    header: 'HP:',
    value: props.ship.BaseStats.HP,
    unit: '',
    decimals: 1,
  },
  ['5,1']: {
    header: 'Reliability:',
    value: props.ship.BaseStats.Reliability,
    unit: '%',
    decimals: 1,
  },
  ['6,1']: {
    header: 'Supply Use:',
    value: props.ship.BaseStats.SupplyUse,
    unit: '',
    decimals: 2,
  },
  ['7,1']: {
    header: 'Manpower:',
    value: props.ship.BaseStats.Manpower,
    unit: '',
    decimals: 0,
  },
  ['1,2']: {
    header: 'Light Attack:',
    value: props.ship.CombatStats.LightAttack,
    unit: '',
    decimals: 1,
  },
  ['2,2']: {
    header: 'Light Piercing:',
    value: props.ship.CombatStats.LightPiercing,
    unit: '',
    decimals: 1,
  },
  ['3,2']: {
    header: 'Heavy Attack:',
    value: props.ship.CombatStats.HeavyAttack,
    unit: '',
    decimals: 1,
  },
  ['4,2']: {
    header: 'Heavy Piercing:',
    value: props.ship.CombatStats.HeavyPiercing,
    unit: '',
    decimals: 1,
  },
  ['5,2']: {
    header: 'Torpedo Attack:',
    value: props.ship.CombatStats.TorpedoAttack,
    unit: '',
    decimals: 1,
  },
  ['6,2']: {
    header: 'Depth Charges:',
    value: props.ship.CombatStats.DepthCharges,
    unit: '',
    decimals: 1,
  },
  ['7,2']: {
    header: 'Armor:',
    value: props.ship.CombatStats.Armor,
    unit: '',
    decimals: 1,
  },
  ['8,2']: {
    header: 'Anti-air:',
    value: props.ship.CombatStats.AntiAir,
    unit: '',
    decimals: 1,
  },
  ['1,3']: {
    header: 'Fuel Usage:',
    value: props.ship.MiscStats.FuelUsage,
    unit: '',
    decimals: 2,
  },
  ['2,3']: {
    header: 'Surface Visibility:',
    value: props.ship.MiscStats.SurfaceVisibility,
    unit: '',
    decimals: 1,
  },
  ['3,3']: {
    header: 'Surface detection:',
    value: props.ship.MiscStats.SurfaceDetection,
    unit: '',
    decimals: 1,
  },
  ['4,3']: {
    header: 'Sub Visibility:',
    value: props.ship.MiscStats.SubVisibility,
    unit: '',
    decimals: 1,
  },
  ['5,3']: {
    header: 'Sub detection:',
    value: props.ship.MiscStats.SubDetection,
    unit: '',
    decimals: 1,
  },
  ['6,3']: {
    header: 'Minelaying:',
    value: props.ship.MiscStats.Minelaying,
    unit: '',
    decimals: 2,
  },
  ['7,3']: {
    header: 'Minesweeping:',
    value: props.ship.MiscStats.Minesweeping,
    unit: '',
    decimals: 2,
  },
  ['8,3']: {
    header: 'Weather Penalty:',
    value: props.ship.MiscStats.WeatherPenalty,
    unit: '%',
    decimals: 0,
  },
}))

const getShipCell = (key: string) => {
  return shipTableCellData.value[key] || null
}

const getCellDataHeader = (x: number, y: number) => {
  const coordinatesString = x + ',' + y
  const cellData = getShipCell(coordinatesString)
  if (cellData !== null) {
    return cellData.header
  }
  return ''
}

const getCellDataCleanValue = (x: number, y: number) => {
  const coordinatesString = x + ',' + y
  const cellData = getShipCell(coordinatesString)
  if (cellData !== null) {
    return cleanValue(cellData.value, cellData.unit, cellData.decimals)
  }
  return ''
}

const cleanValue = (value: number, unit: string, decimals: number) => {
  if (unit === '%') {
    value *= 100
  }
  const cleanedValue = addZeros(roundDecimal(value, decimals).toString(), decimals)
  return cleanedValue + unit
}
</script>

<template>
  <span>
    <table border="1">
      <thead>
        <tr>
          <th>Base Stats</th>
          <th>Combat Stats</th>
          <th>Misc. Stats</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in 12" :key="row">
          <td v-for="col in 3" :key="col">
            <div class="justify-td">
              <span class="left-td">{{ getCellDataHeader(row, col) }}</span>
              <span class="right-td">{{ getCellDataCleanValue(row, col) }}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </span>
</template>

<style>
table {
  font-family: 'Courier';
  font-size: small;
}

th {
  text-align: left;
  padding: 0px 5px;
  font-size: large;
}

tr {
  height: 22.5px;
}

td {
  width: 200px;
  padding: 0px 5px;
}

.justify-td {
  display: flex;
  justify-content: space-between;
}

.left-td {
  text-align: left;
}

.right-td {
  text-align: right;
}
</style>
