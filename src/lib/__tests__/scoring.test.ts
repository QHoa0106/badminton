import { describe, expect, it } from 'vitest'
import {
  computeGroupStanding,
  detectScheduleWarnings,
  evaluateMatch,
  evaluateSet,
  validateGroupDistribution,
  validatePlayerRoster,
} from '@/lib/scoring'
import type { Group, Match, Team, TieBreakEvent } from '@/types/database'

describe('Luật tính điểm 1 set (không giới hạn tối đa, cách biệt 2)', () => {
  it('30-28 là thắng set vòng bảng (mục tiêu 30)', () => {
    const res = evaluateSet(30, 28, 30, 2)
    expect(res).toEqual({ isValid: true, isCompleted: true, winner: 'A' })
  })

  it('30-29 CHƯA thắng set vòng bảng', () => {
    const res = evaluateSet(30, 29, 30, 2)
    expect(res).toEqual({ isValid: true, isCompleted: false, winner: null })
  })

  it('31-29 và 32-30 và 45-43 đều là thắng hợp lệ (không giới hạn max)', () => {
    expect(evaluateSet(31, 29, 30, 2)).toEqual({ isValid: true, isCompleted: true, winner: 'A' })
    expect(evaluateSet(30, 32, 30, 2)).toEqual({ isValid: true, isCompleted: true, winner: 'B' })
    expect(evaluateSet(45, 43, 30, 2)).toEqual({ isValid: true, isCompleted: true, winner: 'A' })
  })

  it('từ chối điểm âm hoặc không phải số nguyên', () => {
    expect(evaluateSet(-1, 10, 30, 2).isValid).toBe(false)
    expect(evaluateSet(10.5, 10, 30, 2).isValid).toBe(false)
  })
})

describe('Thuật toán BO3 (Tứ kết/Bán kết 15đ, Chung kết/Hạng 3 21đ)', () => {
  it('xác định thắng 2-0 không cần đánh set 3', () => {
    const res = evaluateMatch(
      [
        { set_number: 1, score_a: 15, score_b: 12 },
        { set_number: 2, score_a: 17, score_b: 15 },
      ],
      15,
      3,
      2
    )
    expect(res.isCompleted).toBe(true)
    expect(res.winner).toBe('A')
    expect(res.setsWonA).toBe(2)
    expect(res.setsWonB).toBe(0)
  })

  it('xác định thắng 2-1 ở set 3 với Chung kết 21đ', () => {
    const res = evaluateMatch(
      [
        { set_number: 1, score_a: 21, score_b: 19 },
        { set_number: 2, score_a: 20, score_b: 22 },
        { set_number: 3, score_a: 23, score_b: 21 },
      ],
      21,
      3,
      2
    )
    expect(res.isCompleted).toBe(true)
    expect(res.winner).toBe('A')
    expect(res.setsWonA).toBe(2)
    expect(res.setsWonB).toBe(1)
  })
})

describe('Kiểm tra cơ cấu 24 VĐV (6 TB-, 6 TBY, 12 TBY+)', () => {
  it('hợp lệ khi có đúng 6 TB-, 6 TBY, 12 TBY+', () => {
    const roster = [
      ...Array.from({ length: 6 }, () => ({ skill_level: 'TB-' as const, status: 'active' as const })),
      ...Array.from({ length: 6 }, () => ({ skill_level: 'TBY' as const, status: 'active' as const })),
      ...Array.from({ length: 12 }, () => ({ skill_level: 'TBY+' as const, status: 'active' as const })),
    ]
    const res = validatePlayerRoster(roster)
    expect(res.isReadyForDraw).toBe(true)
    expect(res.errors).toHaveLength(0)
  })

  it('báo lỗi khi sai số lượng nhóm trình độ', () => {
    const roster = [
      ...Array.from({ length: 5 }, () => ({ skill_level: 'TB-' as const, status: 'active' as const })),
      ...Array.from({ length: 7 }, () => ({ skill_level: 'TBY' as const, status: 'active' as const })),
      ...Array.from({ length: 12 }, () => ({ skill_level: 'TBY+' as const, status: 'active' as const })),
    ]
    const res = validatePlayerRoster(roster)
    expect(res.isReadyForDraw).toBe(false)
    expect(res.errors.length).toBe(2)
  })
})

describe('Kiểm tra phân bổ chia 4 bảng A, B, C, D', () => {
  it('chấp nhận đúng 2 bảng mixed-only và 2 bảng plus-only', () => {
    const groups = [
      {
        group_name: 'A',
        teams: [
          { id: '1', team_type: 'TB-_TBY' as const },
          { id: '2', team_type: 'TB-_TBY' as const },
          { id: '3', team_type: 'TB-_TBY' as const },
        ],
      },
      {
        group_name: 'B',
        teams: [
          { id: '4', team_type: 'TBY+_TBY+' as const },
          { id: '5', team_type: 'TBY+_TBY+' as const },
          { id: '6', team_type: 'TBY+_TBY+' as const },
        ],
      },
      {
        group_name: 'C',
        teams: [
          { id: '7', team_type: 'TB-_TBY' as const },
          { id: '8', team_type: 'TB-_TBY' as const },
          { id: '9', team_type: 'TB-_TBY' as const },
        ],
      },
      {
        group_name: 'D',
        teams: [
          { id: '10', team_type: 'TBY+_TBY+' as const },
          { id: '11', team_type: 'TBY+_TBY+' as const },
          { id: '12', team_type: 'TBY+_TBY+' as const },
        ],
      },
    ]
    expect(validateGroupDistribution(groups).valid).toBe(true)
  })

  it('từ chối khi một bảng trộn hai nhóm đội', () => {
    const groups = [
      {
        group_name: 'A',
        teams: [
          { id: '1', team_type: 'TB-_TBY' as const },
          { id: '2', team_type: 'TB-_TBY' as const },
          { id: '3', team_type: 'TBY+_TBY+' as const },
        ],
      },
      {
        group_name: 'B',
        teams: [
          { id: '4', team_type: 'TB-_TBY' as const },
          { id: '5', team_type: 'TB-_TBY' as const },
          { id: '6', team_type: 'TB-_TBY' as const },
        ],
      },
      {
        group_name: 'C',
        teams: [
          { id: '7', team_type: 'TBY+_TBY+' as const },
          { id: '8', team_type: 'TBY+_TBY+' as const },
          { id: '9', team_type: 'TBY+_TBY+' as const },
        ],
      },
      {
        group_name: 'D',
        teams: [
          { id: '10', team_type: 'TBY+_TBY+' as const },
          { id: '11', team_type: 'TBY+_TBY+' as const },
          { id: '12', team_type: 'TBY+_TBY+' as const },
        ],
      },
    ]
    expect(validateGroupDistribution(groups).valid).toBe(false)
  })

  it('từ chối khi các bảng không xếp xen kẽ theo thứ tự A-D', () => {
    const groups = [
      {
        group_name: 'A',
        teams: [
          { id: '1', team_type: 'TB-_TBY' as const },
          { id: '2', team_type: 'TB-_TBY' as const },
          { id: '3', team_type: 'TB-_TBY' as const },
        ],
      },
      {
        group_name: 'B',
        teams: [
          { id: '4', team_type: 'TBY+_TBY+' as const },
          { id: '5', team_type: 'TBY+_TBY+' as const },
          { id: '6', team_type: 'TBY+_TBY+' as const },
        ],
      },
      {
        group_name: 'C',
        teams: [
          { id: '7', team_type: 'TBY+_TBY+' as const },
          { id: '8', team_type: 'TBY+_TBY+' as const },
          { id: '9', team_type: 'TBY+_TBY+' as const },
        ],
      },
      {
        group_name: 'D',
        teams: [
          { id: '10', team_type: 'TB-_TBY' as const },
          { id: '11', team_type: 'TB-_TBY' as const },
          { id: '12', team_type: 'TB-_TBY' as const },
        ],
      },
    ]
    expect(validateGroupDistribution(groups).valid).toBe(false)
  })
})

function makeTeam(id: string, name: string): Team {
  return {
    id,
    tournament_id: 't1',
    team_type: 'TB-_TBY',
    team_name: name,
    status: 'confirmed',
    created_at: '2026-01-01T00:00:00Z',
  }
}

function makeGroup(): Group {
  return {
    id: 'gA',
    tournament_id: 't1',
    group_name: 'A',
    distribution_type: '2_mixed_1_plus',
    status: 'confirmed',
    manual_resolution_note: null,
    manual_resolved_by: null,
    manual_resolved_at: null,
    group_teams: [
      { id: 'gt1', group_id: 'gA', team_id: 'T1', manual_rank: null, team: makeTeam('T1', 'Đội 1') },
      { id: 'gt2', group_id: 'gA', team_id: 'T2', manual_rank: null, team: makeTeam('T2', 'Đội 2') },
      { id: 'gt3', group_id: 'gA', team_id: 'T3', manual_rank: null, team: makeTeam('T3', 'Đội 3') },
    ],
  }
}

function makeMatch(
  id: string,
  stage: Match['stage'],
  a: string,
  b: string,
  sa: number,
  sb: number,
  tbEventId: string | null = null
): Match {
  return {
    id,
    tournament_id: 't1',
    group_id: 'gA',
    tie_break_event_id: tbEventId,
    match_number: 1,
    stage,
    bracket_slot: null,
    team_a_id: a,
    team_b_id: b,
    winner_team_id: sa > sb ? a : b,
    court_id: null,
    scheduled_at: null,
    assigned_referee_id: null,
    target_points: stage === 'group' ? 30 : 15,
    best_of: 1,
    win_by: 2,
    status: 'completed',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    sets: [
      {
        id: `s-${id}`,
        match_id: id,
        set_number: 1,
        score_a: sa,
        score_b: sb,
        status: 'completed',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  }
}

describe('Bảng xếp hạng & Tie-break 2 đội / 3 đội (không cộng điểm tie-break vào hiệu số vòng bảng)', () => {
  it('phát hiện hòa cả 3 đội (cùng 1 thắng, hiệu số 0) và yêu cầu Mini Round Robin', () => {
    const group = makeGroup()
    const matches: Match[] = [
      makeMatch('m1', 'group', 'T1', 'T2', 30, 25),
      makeMatch('m2', 'group', 'T2', 'T3', 30, 25),
      makeMatch('m3', 'group', 'T3', 'T1', 30, 25),
    ]
    const res = computeGroupStanding(group, matches, [])
    expect(res.needsTieBreak).toBe(true)
    expect(res.tieBreakTypeNeeded).toBe('three_team_round_robin')
    expect(res.resolved).toBe(false)
    expect(res.qualifiedTop2).toBeNull()
  })

  it('giải quyết hòa 2 đội bằng tie-break 15đ và KHÔNG cộng điểm tie-break vào hiệu số vòng bảng', () => {
    const group = makeGroup()
    // T1 thắng cả 2 (2T), T2 và T3 cùng 0T? Không: tạo tình huống T1 thắng T2 30-20, T1 thắng T3 30-20 -> T2 và T3 hòa nhau nếu T2 vs T3?
    // Để T2 và T3 cùng 1T và cùng hiệu số: không thể với 3 đội nếu T1 cũng 1T.
    // Tạo tình huống thực tế: T1 vs T2 (30-28), T2 vs T3 (30-25), T3 vs T1 (30-27):
    // T1: 1T, ghi 57, thua 58, HS -1
    // T2: 1T, ghi 58, thua 55, HS +3
    // T3: 1T, ghi 55, thua 57, HS -2 -> không hòa.
    // Để 2 đội hòa cùng 1T và cùng HS (T1 & T2 cùng HS -1, T3 HS +2):
    // T3 thắng T1 30-29, T3 thua T2 27-30 -> T3: 1T, ghi 57, thua 59?
    // Đơn giản: T1 thắng T2 30-28, T2 thắng T3 30-28, T3 thắng T1 30-28 -> cả 3 hòa HS 0.
    // Để 2 đội hòa: T1 thắng T2 30-25 (+5/-5), T2 thắng T3 30-20 (+10/-10), T3 thắng T1 30-20 (+10/-10):
    // T1: HS -5, T2: HS +5, T3: HS 0 -> khác nhau.
    // Để T1 và T2 cùng HS +2, T3 HS -4: T1 thắng T2 30-26 (+4/-4), T2 thắng T3 30-24 (+6/-6), T3 thắng T1 30-28 (+2/-2):
    // T1: +4 - 2 = +2; T2: -4 + 6 = +2; T3: -6 + 2 = -4! Chính xác!
    const groupMatches: Match[] = [
      makeMatch('m1', 'group', 'T1', 'T2', 30, 26),
      makeMatch('m2', 'group', 'T2', 'T3', 30, 24),
      makeMatch('m3', 'group', 'T3', 'T1', 30, 28),
    ]

    const beforeTb = computeGroupStanding(group, groupMatches, [])
    expect(beforeTb.needsTieBreak).toBe(true)
    expect(beforeTb.tieBreakTypeNeeded).toBe('two_team')
    expect(beforeTb.tiedTeamIds.sort()).toEqual(['T1', 'T2'])

    const tbEvent: TieBreakEvent = {
      id: 'tb1',
      tournament_id: 't1',
      group_id: 'gA',
      event_type: 'two_team',
      status: 'completed',
      reason: '',
      resolved_by: null,
      created_at: '2026-01-02T00:00:00Z',
      completed_at: '2026-01-02T01:00:00Z',
    }
    const tbMatch = makeMatch('m4', 'tie_break', 'T1', 'T2', 12, 15, 'tb1')

    const afterTb = computeGroupStanding(group, [...groupMatches, tbMatch], [tbEvent])
    expect(afterTb.resolved).toBe(true)
    expect(afterTb.qualifiedTop2).toEqual(['T2', 'T1'])

    // Kiểm tra hiệu số vòng bảng KHÔNG bị cộng điểm tie-break (vẫn giữ +2 cho T1 và T2)
    const rowT2 = afterTb.rows.find((r) => r.team_id === 'T2')!
    const rowT1 = afterTb.rows.find((r) => r.team_id === 'T1')!
    expect(rowT2.point_diff).toBe(2)
    expect(rowT1.point_diff).toBe(2)
  })
})

describe('Cảnh báo xung đột lịch thi đấu', () => {
  it('phát hiện trùng sân và trùng đội ở cùng thời điểm', () => {
    const m1: Match = {
      ...makeMatch('m1', 'group', 'T1', 'T2', 0, 0),
      match_number: 1,
      court_id: 'c1',
      scheduled_at: '2026-05-01T09:00:00Z',
    }
    const m2: Match = {
      ...makeMatch('m2', 'group', 'T1', 'T3', 0, 0),
      match_number: 2,
      court_id: 'c1',
      scheduled_at: '2026-05-01T09:00:00Z',
    }
    const warnings = detectScheduleWarnings([m1, m2], 4)
    expect(warnings.some((w) => w.type === 'court_conflict')).toBe(true)
    expect(warnings.some((w) => w.type === 'team_conflict')).toBe(true)
  })
})
