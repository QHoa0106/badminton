import type {
  Group,
  Match,
  MatchSet,
  SkillLevel,
  StandingRow,
  Team,
  TieBreakEvent,
  TournamentPlayer,
} from '@/types/database'

/**
 * Kiểm tra xem 1 set đã kết thúc theo luật cầu lông nội bộ hay chưa:
 * - Đạt tối thiểu targetPoints (30 / 15 / 21)
 * - Hơn đối thủ ít nhất winBy (mặc định 2 điểm)
 * - Không giới hạn điểm tối đa
 */
export function evaluateSet(
  scoreA: number,
  scoreB: number,
  targetPoints: number,
  winBy = 2
): { isValid: boolean; isCompleted: boolean; winner: 'A' | 'B' | null } {
  if (
    !Number.isInteger(scoreA) ||
    !Number.isInteger(scoreB) ||
    scoreA < 0 ||
    scoreB < 0
  ) {
    return { isValid: false, isCompleted: false, winner: null }
  }

  const reachedTarget = scoreA >= targetPoints || scoreB >= targetPoints
  const diff = Math.abs(scoreA - scoreB)
  const isCompleted = reachedTarget && diff >= winBy

  if (!isCompleted) {
    return { isValid: true, isCompleted: false, winner: null }
  }

  return {
    isValid: true,
    isCompleted: true,
    winner: scoreA > scoreB ? 'A' : 'B',
  }
}

/**
 * Đánh giá kết quả toàn trận (BO1 hoặc BO3) từ danh sách các set
 */
export function evaluateMatch(
  sets: Pick<MatchSet, 'set_number' | 'score_a' | 'score_b'>[],
  targetPoints: number,
  bestOf: number,
  winBy = 2
): {
  setsWonA: number
  setsWonB: number
  winner: 'A' | 'B' | null
  isCompleted: boolean
  completedSetCount: number
} {
  const needed = Math.floor(bestOf / 2) + 1
  let setsWonA = 0
  let setsWonB = 0
  let completedSetCount = 0

  const ordered = [...sets].sort((a, b) => a.set_number - b.set_number).slice(0, bestOf)
  for (const s of ordered) {
    const res = evaluateSet(s.score_a, s.score_b, targetPoints, winBy)
    if (res.isCompleted && res.winner) {
      completedSetCount += 1
      if (res.winner === 'A') setsWonA += 1
      else setsWonB += 1
    }
  }

  if (setsWonA >= needed) {
    return { setsWonA, setsWonB, winner: 'A', isCompleted: true, completedSetCount }
  }
  if (setsWonB >= needed) {
    return { setsWonA, setsWonB, winner: 'B', isCompleted: true, completedSetCount }
  }
  return { setsWonA, setsWonB, winner: null, isCompleted: false, completedSetCount }
}

/**
 * Kiểm tra điều kiện đủ 24 VĐV theo cơ cấu: 6 TB-, 6 TBY, 12 TBY+
 */
export function validatePlayerRoster(players: Pick<TournamentPlayer, 'skill_level' | 'status'>[]) {
  const active = players.filter((p) => p.status === 'active')
  const counts: Record<SkillLevel, number> = {
    'TB-': 0,
    TBY: 0,
    'TBY+': 0,
  }
  for (const p of active) {
    counts[p.skill_level] = (counts[p.skill_level] || 0) + 1
  }
  const total = active.length
  const errors: string[] = []
  if (counts['TB-'] !== 6) errors.push(`Nhóm TB- cần đúng 6 VĐV (hiện có ${counts['TB-']})`)
  if (counts.TBY !== 6) errors.push(`Nhóm TBY cần đúng 6 VĐV (hiện có ${counts.TBY})`)
  if (counts['TBY+'] !== 12) errors.push(`Nhóm TBY+ cần đúng 12 VĐV (hiện có ${counts['TBY+']})`)

  return {
    counts,
    total,
    isReadyForDraw: errors.length === 0,
    errors,
  }
}

/**
 * Kiểm tra điều kiện chia 4 bảng:
 * - 4 bảng A, B, C, D, mỗi bảng 3 đội
 * - Đúng 2 bảng có (2 TB-_TBY + 1 TBY+_TBY+)
 * - Đúng 2 bảng có (1 TB-_TBY + 2 TBY+_TBY+)
 */
export function validateGroupDistribution(
  groups: { group_name: string; teams: Pick<Team, 'id' | 'team_type'>[] }[]
): { valid: boolean; reason?: string } {
  if (groups.length !== 4) {
    return { valid: false, reason: 'Phải có đúng 4 bảng đấu' }
  }

  let twoMixedCount = 0
  let oneMixedCount = 0
  const seenTeams = new Set<string>()

  for (const g of groups) {
    if (g.teams.length !== 3) {
      return { valid: false, reason: `Bảng ${g.group_name} phải có đúng 3 đội` }
    }
    let mixed = 0
    let plus = 0
    for (const t of g.teams) {
      if (seenTeams.has(t.id)) {
        return { valid: false, reason: 'Có đội bị trùng lặp giữa các bảng' }
      }
      seenTeams.add(t.id)
      if (t.team_type === 'TB-_TBY') mixed += 1
      else if (t.team_type === 'TBY+_TBY+') plus += 1
    }
    if (mixed === 2 && plus === 1) twoMixedCount += 1
    else if (mixed === 1 && plus === 2) oneMixedCount += 1
    else {
      return {
        valid: false,
        reason: `Bảng ${g.group_name} có phân bổ không hợp lệ (${mixed} TB-+TBY, ${plus} TBY+)`,
      }
    }
  }

  if (twoMixedCount !== 2 || oneMixedCount !== 2) {
    return {
      valid: false,
      reason: 'Phải có đúng 2 bảng (2 TB-+TBY, 1 TBY+) và 2 bảng (1 TB-+TBY, 2 TBY+)',
    }
  }

  return { valid: true }
}

export interface GroupStandingResolution {
  groupId: string
  groupName: 'A' | 'B' | 'C' | 'D'
  rows: StandingRow[]
  allGroupMatchesCompleted: boolean
  tiedGroups: StandingRow[][]
  needsTieBreak: boolean
  tieBreakTypeNeeded: 'none' | 'two_team' | 'three_team_round_robin' | 'decider' | 'admin_decision'
  tiedTeamIds: string[]
  resolved: boolean
  qualifiedTop2: [string, string] | null
  activeTieBreakEvents: TieBreakEvent[]
  tieBreakSummary?: {
    team_id: string
    won: number
    point_diff: number
    points_for: number
  }[]
}

/**
 * Tính bảng xếp hạng 1 bảng đấu CHỈ TỪ các trận vòng bảng chính thức (stage = 'group'),
 * KHÔNG cộng điểm tie-break vào hiệu số vòng bảng.
 * Sau đó xét kết quả tie-break (nếu có) hoặc quyết định thủ công của Admin (manual_rank)
 * để xác định thứ hạng cuối cùng và phát hiện có cần tie-break tiếp hay không.
 */
export function computeGroupStanding(
  group: Group,
  allMatches: Match[],
  tieBreakEvents: TieBreakEvent[]
): GroupStandingResolution {
  const groupTeams = group.group_teams || []
  const groupMatches = allMatches.filter((m) => m.group_id === group.id && m.stage === 'group')
  const completedGroupMatches = groupMatches.filter(
    (m) => m.status === 'completed' && m.winner_team_id
  )
  const allGroupMatchesCompleted = groupMatches.length === 3 && completedGroupMatches.length === 3

  // Thống kê vòng bảng chính thức
  const statsMap = new Map<string, StandingRow>()
  for (const gt of groupTeams) {
    if (!gt.team) continue
    statsMap.set(gt.team_id, {
      team_id: gt.team_id,
      team_name: gt.team.team_name,
      team_type: gt.team.team_type,
      played: 0,
      won: 0,
      lost: 0,
      points_for: 0,
      points_against: 0,
      point_diff: 0,
      manual_rank: gt.manual_rank,
      rank: 1,
      is_tied: false,
    })
  }

  for (const m of completedGroupMatches) {
    if (!m.team_a_id || !m.team_b_id) continue
    const rowA = statsMap.get(m.team_a_id)
    const rowB = statsMap.get(m.team_b_id)
    if (!rowA || !rowB) continue

    const scoreA = (m.sets || []).reduce((acc, s) => acc + s.score_a, 0)
    const scoreB = (m.sets || []).reduce((acc, s) => acc + s.score_b, 0)

    rowA.played += 1
    rowB.played += 1
    rowA.points_for += scoreA
    rowA.points_against += scoreB
    rowB.points_for += scoreB
    rowB.points_against += scoreA

    if (m.winner_team_id === m.team_a_id) {
      rowA.won += 1
      rowB.lost += 1
    } else if (m.winner_team_id === m.team_b_id) {
      rowB.won += 1
      rowA.lost += 1
    }
  }

  const rows = Array.from(statsMap.values()).map((r) => ({
    ...r,
    point_diff: r.points_for - r.points_against,
  }))

  // Sắp xếp vòng bảng chính thức theo: 1. Số trận thắng, 2. Hiệu số điểm
  rows.sort((a, b) => {
    if (b.won !== a.won) return b.won - a.won
    if (b.point_diff !== a.point_diff) return b.point_diff - a.point_diff
    return a.team_name.localeCompare(b.team_name, 'vi')
  })

  // Nếu Admin đã quyết định thủ công (manual_rank 1,2,3)
  const hasManualResolution =
    rows.length === 3 && rows.every((r) => r.manual_rank !== null)

  const groupTbEvents = tieBreakEvents
    .filter((e) => e.group_id === group.id && e.status !== 'cancelled')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  if (hasManualResolution) {
    rows.sort((a, b) => (a.manual_rank || 99) - (b.manual_rank || 99))
    rows.forEach((r, idx) => {
      r.rank = idx + 1
      r.is_tied = false
    })
    return {
      groupId: group.id,
      groupName: group.group_name,
      rows,
      allGroupMatchesCompleted,
      tiedGroups: [],
      needsTieBreak: false,
      tieBreakTypeNeeded: 'none',
      tiedTeamIds: [],
      resolved: allGroupMatchesCompleted,
      qualifiedTop2: allGroupMatchesCompleted ? [rows[0].team_id, rows[1].team_id] : null,
      activeTieBreakEvents: groupTbEvents,
    }
  }

  // Gom nhóm các đội bằng nhau về (won, point_diff)
  const buckets = new Map<string, StandingRow[]>()
  for (const r of rows) {
    const key = `${r.won}|${r.point_diff}`
    const list = buckets.get(key) || []
    list.push(r)
    buckets.set(key, list)
  }

  const tbMatches = allMatches.filter((m) => m.group_id === group.id && m.stage === 'tie_break')
  const latestTbEvent = groupTbEvents[groupTbEvents.length - 1]
  let tieBreakSummary: GroupStandingResolution['tieBreakSummary']

  // Nếu đã có tie-break event hoàn thành, dùng kết quả tie-break để phá vỡ hòa trong các bucket
  if (latestTbEvent && latestTbEvent.status === 'completed') {
    const latestMatches = tbMatches.filter(
      (m) => m.tie_break_event_id === latestTbEvent.id && m.status === 'completed'
    )
    const tbStats = new Map<string, { won: number; point_diff: number; points_for: number }>()
    for (const m of latestMatches) {
      if (!m.team_a_id || !m.team_b_id) continue
      const sA = (m.sets || []).reduce((acc, s) => acc + s.score_a, 0)
      const sB = (m.sets || []).reduce((acc, s) => acc + s.score_b, 0)

      const a = tbStats.get(m.team_a_id) || { won: 0, point_diff: 0, points_for: 0 }
      const b = tbStats.get(m.team_b_id) || { won: 0, point_diff: 0, points_for: 0 }
      a.points_for += sA
      a.point_diff += sA - sB
      b.points_for += sB
      b.point_diff += sB - sA
      if (m.winner_team_id === m.team_a_id) a.won += 1
      else if (m.winner_team_id === m.team_b_id) b.won += 1
      tbStats.set(m.team_a_id, a)
      tbStats.set(m.team_b_id, b)
    }

    tieBreakSummary = Array.from(tbStats.entries()).map(([team_id, st]) => ({
      team_id,
      ...st,
    }))

    // Sắp xếp lại các đội trong bucket có mặt trong tie-break theo:
    // 1. Số trận thắng tie-break
    // 2. Hiệu số điểm tie-break
    // 3. Tổng điểm ghi trong tie-break
    rows.sort((a, b) => {
      if (b.won !== a.won) return b.won - a.won
      if (b.point_diff !== a.point_diff) return b.point_diff - a.point_diff
      const ta = tbStats.get(a.team_id)
      const tb = tbStats.get(b.team_id)
      if (ta && tb) {
        if (tb.won !== ta.won) return tb.won - ta.won
        if (tb.point_diff !== ta.point_diff) return tb.point_diff - ta.point_diff
        if (tb.points_for !== ta.points_for) return tb.points_for - ta.points_for
      }
      return a.team_name.localeCompare(b.team_name, 'vi')
    })

    // Kiểm tra xem sau tie-break còn hòa không
    const stillTied: StandingRow[][] = []
    let i = 0
    while (i < rows.length) {
      const groupCluster = [rows[i]]
      let j = i + 1
      while (j < rows.length) {
        const prev = rows[i]
        const cur = rows[j]
        const sameGroupStats = prev.won === cur.won && prev.point_diff === cur.point_diff
        const ta = tbStats.get(prev.team_id)
        const tb = tbStats.get(cur.team_id)
        const sameTbStats =
          !ta || !tb
            ? true
            : ta.won === tb.won && ta.point_diff === tb.point_diff && ta.points_for === tb.points_for
        if (sameGroupStats && sameTbStats) {
          groupCluster.push(cur)
          j += 1
        } else {
          break
        }
      }
      if (groupCluster.length > 1) {
        groupCluster.forEach((r) => (r.is_tied = true))
        stillTied.push(groupCluster)
      }
      i = j
    }

    rows.forEach((r, idx) => {
      r.rank = idx + 1
    })

    if (stillTied.length === 0) {
      return {
        groupId: group.id,
        groupName: group.group_name,
        rows,
        allGroupMatchesCompleted,
        tiedGroups: [],
        needsTieBreak: false,
        tieBreakTypeNeeded: 'none',
        tiedTeamIds: [],
        resolved: allGroupMatchesCompleted && rows.length >= 2,
        qualifiedTop2:
          allGroupMatchesCompleted && rows.length >= 2 ? [rows[0].team_id, rows[1].team_id] : null,
        activeTieBreakEvents: groupTbEvents,
        tieBreakSummary,
      }
    }

    const firstStillTied = stillTied[0]
    return {
      groupId: group.id,
      groupName: group.group_name,
      rows,
      allGroupMatchesCompleted,
      tiedGroups: stillTied,
      needsTieBreak: allGroupMatchesCompleted,
      tieBreakTypeNeeded: firstStillTied.length === 2 ? 'decider' : 'admin_decision',
      tiedTeamIds: firstStillTied.map((r) => r.team_id),
      resolved: false,
      qualifiedTop2: null,
      activeTieBreakEvents: groupTbEvents,
      tieBreakSummary,
    }
  }

  // Chưa có tie-break hoàn thành: đánh dấu các nhóm đồng điểm vòng bảng
  const tiedGroups = Array.from(buckets.values()).filter((list) => list.length > 1)
  for (const tg of tiedGroups) {
    for (const r of tg) r.is_tied = true
  }
  rows.forEach((r, idx) => {
    r.rank = idx + 1
  })

  const hasPendingTb = groupTbEvents.some((e) => e.status === 'pending' || e.status === 'in_progress')
  const needsTieBreak = allGroupMatchesCompleted && tiedGroups.length > 0
  const firstTie = tiedGroups[0] || []

  let tieBreakTypeNeeded: GroupStandingResolution['tieBreakTypeNeeded'] = 'none'
  if (needsTieBreak) {
    tieBreakTypeNeeded = firstTie.length === 3 ? 'three_team_round_robin' : 'two_team'
  }

  const resolved = allGroupMatchesCompleted && !needsTieBreak && !hasPendingTb && rows.length >= 2

  return {
    groupId: group.id,
    groupName: group.group_name,
    rows,
    allGroupMatchesCompleted,
    tiedGroups,
    needsTieBreak,
    tieBreakTypeNeeded,
    tiedTeamIds: firstTie.map((r) => r.team_id),
    resolved,
    qualifiedTop2: resolved ? [rows[0].team_id, rows[1].team_id] : null,
    activeTieBreakEvents: groupTbEvents,
  }
}

export interface ScheduleWarning {
  type: 'court_conflict' | 'team_conflict' | 'unscheduled' | 'no_courts'
  message: string
  matchIds: string[]
}

/**
 * Kiểm tra cảnh báo lịch thi đấu:
 * - Thiếu sân
 * - Trận chưa được lên lịch
 * - Một sân có nhiều trận cùng thời điểm
 * - Một đội bị xếp hai trận cùng thời điểm
 */
export function detectScheduleWarnings(
  matches: Match[],
  activeCourtCount: number
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = []

  if (activeCourtCount === 0) {
    warnings.push({
      type: 'no_courts',
      message: 'Giải đấu chưa có sân thi đấu nào đang hoạt động.',
      matchIds: [],
    })
  }

  const unscheduled = matches.filter((m) => !m.scheduled_at || !m.court_id)
  if (unscheduled.length > 0) {
    warnings.push({
      type: 'unscheduled',
      message: `Có ${unscheduled.length} trận chưa được gán đủ sân hoặc thời gian thi đấu.`,
      matchIds: unscheduled.map((m) => m.id),
    })
  }

  // Nhóm theo thời điểm (làm tròn theo phút)
  const courtTimeMap = new Map<string, Match[]>()
  const teamTimeMap = new Map<string, Match[]>()

  for (const m of matches) {
    if (!m.scheduled_at) continue
    const timeKey = new Date(m.scheduled_at).toISOString().slice(0, 16)

    if (m.court_id) {
      const ck = `${m.court_id}|${timeKey}`
      const list = courtTimeMap.get(ck) || []
      list.push(m)
      courtTimeMap.set(ck, list)
    }

    if (m.team_a_id) {
      const tk = `${m.team_a_id}|${timeKey}`
      const list = teamTimeMap.get(tk) || []
      list.push(m)
      teamTimeMap.set(tk, list)
    }
    if (m.team_b_id) {
      const tk = `${m.team_b_id}|${timeKey}`
      const list = teamTimeMap.get(tk) || []
      list.push(m)
      teamTimeMap.set(tk, list)
    }
  }

  for (const [, list] of courtTimeMap) {
    if (list.length > 1) {
      const courtName = list[0].court?.court_name || 'Cùng sân'
      warnings.push({
        type: 'court_conflict',
        message: `${courtName} có ${list.length} trận trùng giờ (#${list.map((x) => x.match_number).join(', #')}).`,
        matchIds: list.map((x) => x.id),
      })
    }
  }

  for (const [, list] of teamTimeMap) {
    if (list.length > 1) {
      warnings.push({
        type: 'team_conflict',
        message: `Có đội bị xếp trùng giờ ở các trận #${list.map((x) => x.match_number).join(', #')}.`,
        matchIds: list.map((x) => x.id),
      })
    }
  }

  return warnings
}
