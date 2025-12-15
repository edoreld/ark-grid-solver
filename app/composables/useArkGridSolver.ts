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

function calculateDestinyBonus(cores: Core[], assignment: Map<string, Astrogem[]>): number {
  const sunCore = cores.find(c => isOrderSunCore(c))
  const moonCore = cores.find(c => isOrderMoonCore(c))

  if (!sunCore || !moonCore) return 0

  const sunGems = assignment.get(sunCore.id) || []
  const moonGems = assignment.get(moonCore.id) || []

  const sunPoints = calculateTotalPoints(sunGems)
  const moonPoints = calculateTotalPoints(moonGems)

  if (sunPoints >= 14 && moonPoints >= 14) {
    return SUN_MOON_DESTINY_BONUS
  }

  return 0
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

export type ProgressCallback = (progress: number) => void

export async function solveArkGrid(
  cores: Core[],
  allAstrogems: Astrogem[],
  onProgress?: ProgressCallback
): Promise<SolverResult[]> {
  if (cores.length === 0) return []

  const expandedAstrogems = expandAstrogems(allAstrogems)

  const orderAstrogems = expandedAstrogems.filter(gem => gem.category === 'Order')
  const chaosAstrogems = expandedAstrogems.filter(gem => gem.category === 'Chaos')
  const orderCores = cores.filter(core => getCoreCategory(core.type) === 'Order')
  const chaosCores = cores.filter(core => getCoreCategory(core.type) === 'Chaos')

  const orderFirstCoreCombos = orderCores.length > 0
    ? findValidCombinations(orderCores.sort((a, b) => {
      const rarityOrder: Record<CoreRarity, number> = { Ancient: 0, Relic: 1, Legendary: 2, Epic: 3 }
      return rarityOrder[a.rarity] - rarityOrder[b.rarity]
    })[0]!, orderAstrogems).length
    : 0
  const chaosFirstCoreCombos = chaosCores.length > 0
    ? findValidCombinations(chaosCores.sort((a, b) => {
      const rarityOrder: Record<CoreRarity, number> = { Ancient: 0, Relic: 1, Legendary: 2, Epic: 3 }
      return rarityOrder[a.rarity] - rarityOrder[b.rarity]
    })[0]!, chaosAstrogems).length
    : 0
  const totalFirstLevelCombos = orderFirstCoreCombos + chaosFirstCoreCombos

  let completedFirstLevelCombos = 0

  const progressCallback = onProgress
    ? () => {
        completedFirstLevelCombos++
        onProgress(Math.min(100, Math.round((completedFirstLevelCombos / totalFirstLevelCombos) * 100)))
      }
    : undefined

  const orderResults = await solveCategoryOptimal(orderCores, orderAstrogems, progressCallback)
  const chaosResults = await solveCategoryOptimal(chaosCores, chaosAstrogems, progressCallback)

  const resultsMap = new Map<string, SolverResult>()
  for (const result of [...orderResults, ...chaosResults]) {
    resultsMap.set(result.coreId, result)
  }

  return cores.map(core => resultsMap.get(core.id)!).filter(Boolean)
}

async function solveCategoryOptimal(
  cores: Core[],
  astrogems: Astrogem[],
  onFirstLevelComplete?: () => void
): Promise<SolverResult[]> {
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

  const searchWithSorted = (coreIndex: number, usedGemIds: Set<string>, currentAssignment: Map<string, Astrogem[]>, currentScore: number) => {
    if (coreIndex === sortedCores.length) {
      const destinyBonus = calculateDestinyBonus(cores, currentAssignment)
      const totalScore = currentScore + destinyBonus
      if (totalScore > bestTotalScore) {
        bestTotalScore = totalScore
        bestAssignment = new Map(currentAssignment)
      }
      return
    }

    const core = sortedCores[coreIndex]
    if (!core) return

    const remainingCores = sortedCores.slice(coreIndex)
    const maxPossibleRemaining = remainingCores.reduce((sum, c) => {
      const breakpoints = CORE_CONFIG[c.rarity].breakpoints
      return sum + breakpoints.reduce((s, bp) => s + (BREAKPOINT_WEIGHTS[bp] || 0), 0)
    }, 0)
    const maxDestinyBonus = canGetDestinyBonus ? SUN_MOON_DESTINY_BONUS : 0
    if (currentScore + maxPossibleRemaining + maxDestinyBonus <= bestTotalScore) {
      return
    }

    const availableGems = astrogems.filter(gem => !usedGemIds.has(gem.id))
    const combos = findValidCombinations(core, availableGems)

    for (const combo of combos) {
      const totalPoints = calculateTotalPoints(combo)
      const comboScore = calculateScore(totalPoints, core.rarity)

      const newUsedIds = new Set(usedGemIds)
      combo.forEach(gem => newUsedIds.add(gem.id))
      currentAssignment.set(core.id, combo)
      searchWithSorted(coreIndex + 1, newUsedIds, currentAssignment, currentScore + comboScore)

      currentAssignment.delete(core.id)
    }
  }

  const firstCore = sortedCores[0]
  if (firstCore) {
    const firstCoreCombos = findValidCombinations(firstCore, astrogems)
    let comboCount = 0

    for (const combo of firstCoreCombos) {
      const totalPoints = calculateTotalPoints(combo)
      const comboScore = calculateScore(totalPoints, firstCore.rarity)

      const usedGemIds = new Set<string>()
      combo.forEach(gem => usedGemIds.add(gem.id))

      const currentAssignment = new Map<string, Astrogem[]>()
      currentAssignment.set(firstCore.id, combo)

      searchWithSorted(1, usedGemIds, currentAssignment, comboScore)

      if (onFirstLevelComplete) {
        onFirstLevelComplete()
        comboCount++
        // Only yield to UI every 10 combinations to minimize overhead
        if (comboCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
    }
  }

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
