import { describe, expect, it } from 'vitest'
import { normalizeTeamDrawRevealCount } from '../teamDraw'

describe('normalizeTeamDrawRevealCount', () => {
  it('auto-reveals the only remaining mixed team after the fifth one', () => {
    const plan = [
      ...Array.from({ length: 6 }, () => ({ team_type: 'TB-_TBY' as const })),
      ...Array.from({ length: 6 }, () => ({ team_type: 'TBY+_TBY+' as const })),
    ]

    expect(normalizeTeamDrawRevealCount(plan, 10)).toBe(12)
  })

  it('does not auto-reveal while more than one mixed team remains', () => {
    const plan = [
      ...Array.from({ length: 6 }, () => ({ team_type: 'TB-_TBY' as const })),
      ...Array.from({ length: 6 }, () => ({ team_type: 'TBY+_TBY+' as const })),
    ]

    expect(normalizeTeamDrawRevealCount(plan, 8)).toBe(8)
  })

  it('does not auto-reveal a half-drawn team', () => {
    const plan = [
      ...Array.from({ length: 6 }, () => ({ team_type: 'TB-_TBY' as const })),
      ...Array.from({ length: 6 }, () => ({ team_type: 'TBY+_TBY+' as const })),
    ]

    expect(normalizeTeamDrawRevealCount(plan, 11)).toBe(11)
  })
})
