export interface TeamDrawPlanEntry {
  team_type: 'TB-_TBY' | 'TBY+_TBY+'
}

export function normalizeTeamDrawRevealCount(
  plan: TeamDrawPlanEntry[],
  revealedPlayerCount: number
): number {
  if (revealedPlayerCount % 2 !== 0) return revealedPlayerCount

  const completedTeamCount = revealedPlayerCount / 2
  if (completedTeamCount === 0) return revealedPlayerCount

  const previousTeam = plan[completedTeamCount - 1]
  const nextTeam = plan[completedTeamCount]
  const remainingMixedTeams = plan
    .slice(completedTeamCount)
    .filter((team) => team.team_type === 'TB-_TBY')

  if (
    previousTeam?.team_type === 'TB-_TBY' &&
    nextTeam?.team_type === 'TB-_TBY' &&
    remainingMixedTeams.length === 1
  ) {
    return revealedPlayerCount + 2
  }

  return revealedPlayerCount
}
