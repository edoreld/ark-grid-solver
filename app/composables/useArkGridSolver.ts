import type { Core, Astrogem, SolverResult, CoreRarity } from '~/types/arkgrid'
import { CORE_CONFIG, BREAKPOINT_WEIGHTS, SUN_MOON_DESTINY_BONUS, getCoreCategory, calculateTotalWillpower, calculateTotalPoints, getBreakpointsHit, calculateScore, generateId } from '~/types/arkgrid'

function expandAstrogems(astrogems: Astrogem[]): Astrogem[] {
  const expanded: Astrogem[] = []
  for (const gem of astrogems) {
    const qty = gem.quantity ?? 1
    for (let i = 0; i < qty; i++) {
      expanded.push({
        ...gem,
        id: i === 0 ? gem.id : generateId(),
        quantity: 1
      })
    }
  }
  return expanded
}

function isOrderSunCore(core: Core): boolean {
  return core.type === 'Order of the Sun'
}

function isOrderMoonCore(core: Core): boolean {
  return core.type === 'Order of the Moon'
}

function findValidCombinations(
  core: Core,
  availableAstrogems: Astrogem[],
  maxAstrogems: number = 4
): Astrogem[][] {
  const coreCategory = getCoreCategory(core.type)
  const maxWillpower = CORE_CONFIG[core.rarity].maxWillpower
  const compatibleGems = availableAstrogems.filter(gem => gem.category === coreCategory)

  const validCombinations: Astrogem[][] = []

  function generateCombinations(
    startIndex: number,
    currentCombo: Astrogem[],
    currentWillpower: number
  ) {
    if (currentCombo.length > 0) {
      validCombinations.push([...currentCombo])
    }

    if (currentCombo.length >= maxAstrogems) return

    for (let i = startIndex; i < compatibleGems.length; i++) {
      const gem = compatibleGems[i]!
      const newWillpower = currentWillpower + gem.willpower
      if (newWillpower > maxWillpower) continue

      currentCombo.push(gem)
      generateCombinations(i + 1, currentCombo, newWillpower)
      currentCombo.pop()
    }
  }

  generateCombinations(0, [], 0)
  validCombinations.unshift([])

  return validCombinations
}

export function solveArkGrid(cores: Core[], allAstrogems: Astrogem[]): SolverResult[] {
  if (cores.length === 0) return []

  const expandedAstrogems = expandAstrogems(allAstrogems)

  const orderAstrogems = expandedAstrogems.filter(gem => gem.category === 'Order')
  const chaosAstrogems = expandedAstrogems.filter(gem => gem.category === 'Chaos')
  const orderCores = cores.filter(core => getCoreCategory(core.type) === 'Order')
  const chaosCores = cores.filter(core => getCoreCategory(core.type) === 'Chaos')

  const orderResults = solveCategoryOptimal(orderCores, orderAstrogems)
  const chaosResults = solveCategoryOptimal(chaosCores, chaosAstrogems)

  const resultsMap = new Map<string, SolverResult>()
  for (const result of [...orderResults, ...chaosResults]) {
    resultsMap.set(result.coreId, result)
  }

  return cores.map(core => resultsMap.get(core.id)!).filter(Boolean)
}

function solveCategoryOptimal(cores: Core[], astrogems: Astrogem[]): SolverResult[] {
  if (cores.length === 0) return []

  let bestAssignment: Map<string, Astrogem[]> = new Map()
  let bestTotalScore = -1

  const sortedCores = [...cores].sort((a, b) => {
    const rarityOrder: Record<CoreRarity, number> = { Ancient: 0, Relic: 1, Legendary: 2, Epic: 3 }
    return rarityOrder[a.rarity] - rarityOrder[b.rarity]
  })

  const hasOrderSunCore = cores.some(c => isOrderSunCore(c))
  const hasOrderMoonCore = cores.some(c => isOrderMoonCore(c))
  const canGetDestinyBonus = hasOrderSunCore && hasOrderMoonCore
  const destinyBonusValue = canGetDestinyBonus ? SUN_MOON_DESTINY_BONUS : 0

  const maxRemainingScores: number[] = new Array(sortedCores.length + 1).fill(0)
  for (let i = sortedCores.length - 1; i >= 0; i--) {
    const core = sortedCores[i]!
    const breakpoints = CORE_CONFIG[core.rarity].breakpoints
    const coreMaxScore = breakpoints.reduce((s, bp) => s + (BREAKPOINT_WEIGHTS[bp] || 0), 0)
    maxRemainingScores[i] = maxRemainingScores[i + 1]! + coreMaxScore
  }

  const gemIndexMap = new Map<string, number>()
  astrogems.forEach((gem, idx) => gemIndexMap.set(gem.id, idx))

  const allCoreCombos: { gems: Astrogem[], gemIndices: number[], score: number, points: number }[][] = []
  for (const core of sortedCores) {
    const combos = findValidCombinations(core, astrogems)
    const scoredCombos = combos.map((gems) => {
      const points = calculateTotalPoints(gems)
      const score = calculateScore(points, core.rarity)
      const gemIndices = gems.map(g => gemIndexMap.get(g.id)!)
      return { gems, gemIndices, score, points }
    })
    scoredCombos.sort((a, b) => b.score - a.score)
    allCoreCombos.push(scoredCombos)
  }

  const usedGems: boolean[] = new Array(astrogems.length).fill(false)
  const currentAssignment: (Astrogem[] | null)[] = new Array(sortedCores.length).fill(null)

  const search = (coreIndex: number, currentScore: number) => {
    if (coreIndex === sortedCores.length) {
      let totalScore = currentScore
      if (canGetDestinyBonus) {
        const sunCoreIdx = sortedCores.findIndex(c => isOrderSunCore(c))
        const moonCoreIdx = sortedCores.findIndex(c => isOrderMoonCore(c))
        if (sunCoreIdx !== -1 && moonCoreIdx !== -1) {
          const sunGems = currentAssignment[sunCoreIdx] || []
          const moonGems = currentAssignment[moonCoreIdx] || []
          const sunPoints = calculateTotalPoints(sunGems)
          const moonPoints = calculateTotalPoints(moonGems)
          if (sunPoints >= 14 && moonPoints >= 14) {
            totalScore += SUN_MOON_DESTINY_BONUS
          }
        }
      }
      if (totalScore > bestTotalScore) {
        bestTotalScore = totalScore
        bestAssignment = new Map()
        sortedCores.forEach((core, idx) => {
          bestAssignment.set(core.id, currentAssignment[idx] || [])
        })
      }
      return
    }

    if (currentScore + maxRemainingScores[coreIndex]! + destinyBonusValue <= bestTotalScore) {
      return
    }

    const combos = allCoreCombos[coreIndex]!

    for (const combo of combos) {
      let hasConflict = false
      for (const idx of combo.gemIndices) {
        if (usedGems[idx]) {
          hasConflict = true
          break
        }
      }
      if (hasConflict) continue

      for (const idx of combo.gemIndices) {
        usedGems[idx] = true
      }
      currentAssignment[coreIndex] = combo.gems

      search(coreIndex + 1, currentScore + combo.score)

      for (const idx of combo.gemIndices) {
        usedGems[idx] = false
      }
      currentAssignment[coreIndex] = null
    }
  }

  search(0, 0)

  const results: SolverResult[] = []
  for (const core of cores) {
    const assignedGems = bestAssignment.get(core.id) || []
    const totalPoints = calculateTotalPoints(assignedGems)
    const totalWillpower = calculateTotalWillpower(assignedGems)
    const breakpointsHit = getBreakpointsHit(totalPoints, core.rarity)
    const score = calculateScore(totalPoints, core.rarity)

    results.push({
      coreId: core.id,
      astrogems: assignedGems,
      totalPoints,
      totalWillpower,
      breakpointsHit,
      score
    })
  }

  return results
}

export function getMaxPossibleScore(cores: Core[]): number {
  const baseScore = cores.reduce((total, core) => {
    const breakpoints = CORE_CONFIG[core.rarity].breakpoints
    return total + breakpoints.reduce((sum, bp) => sum + (BREAKPOINT_WEIGHTS[bp] || 0), 0)
  }, 0)

  const orderCores = cores.filter(core => getCoreCategory(core.type) === 'Order')

  let destinyBonus = 0
  if (orderCores.some(c => isOrderSunCore(c)) && orderCores.some(c => isOrderMoonCore(c))) {
    destinyBonus += SUN_MOON_DESTINY_BONUS
  }

  return baseScore + destinyBonus
}

export function getDestinyBonus(cores: Core[], results: SolverResult[]): number {
  const orderSunCore = cores.find(c => isOrderSunCore(c))
  const orderMoonCore = cores.find(c => isOrderMoonCore(c))

  if (!orderSunCore || !orderMoonCore) return 0

  const sunResult = results.find(r => r.coreId === orderSunCore.id)
  const moonResult = results.find(r => r.coreId === orderMoonCore.id)

  if (!sunResult || !moonResult) return 0

  if (sunResult.totalPoints >= 14 && moonResult.totalPoints >= 14) {
    return SUN_MOON_DESTINY_BONUS
  }

  return 0
}

export function useArkGridSolver() {
  return {
    solveArkGrid,
    getMaxPossibleScore,
    getDestinyBonus
  }
}
