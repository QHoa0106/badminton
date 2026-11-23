import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Users,
  Shield,
  Grid2x2,
  Swords,
  CheckCircle2,
  Flame,
  Clock,
  Trophy,
  ArrowRight,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { computeGroupStanding, validatePlayerRoster } from '@/lib/scoring'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'
import { MATCH_STATUS_LABELS, STAGE_LABELS, TOURNAMENT_STATUS_LABELS } from '@/types/database'

export function DashboardPage() {
  const { id } = useParams<{ id: string }>()
  const { tournament, players, teams, groups, matches, tieBreakEvents, myRole } =
    useTournamentContext()

  const roster = useMemo(() => validatePlayerRoster(players), [players])

  const matchStats = useMemo(() => {
    const completed = matches.filter((m) => m.status === 'completed').length
    const inProgress = matches.filter((m) => m.status === 'in_progress').length
    const scheduled = matches.filter(
      (m) => m.status === 'scheduled' || m.status === 'pending_tiebreak'
    ).length
    return { total: matches.length, completed, inProgress, scheduled }
  }, [matches])

  const standings = useMemo(
    () => groups.map((g) => computeGroupStanding(g, matches, tieBreakEvents)),
    [groups, matches, tieBreakEvents]
  )

  const chartData = [
    { name: 'Hoàn thành', value: matchStats.completed, color: '#059669' },
    { name: 'Đang đấu', value: matchStats.inProgress, color: '#ea580c' },
    { name: 'Chưa đấu', value: matchStats.scheduled, color: '#64748b' },
  ]

  const recentCompleted = useMemo(
    () =>
      matches
        .filter((m) => m.status === 'completed')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5),
    [matches]
  )

  const upcomingMatches = useMemo(
    () =>
      matches
        .filter((m) => m.status === 'in_progress' || m.status === 'scheduled')
        .sort((a, b) => {
          if (a.status === 'in_progress' && b.status !== 'in_progress') return -1
          if (b.status === 'in_progress' && a.status !== 'in_progress') return 1
          return a.match_number - b.match_number
        })
        .slice(0, 5),
    [matches]
  )

  if (!tournament) return null

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-navy-950 via-navy-900 to-navy-800 p-6 text-white shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="success">{TOURNAMENT_STATUS_LABELS[tournament.status]}</Badge>
              {tournament.is_public && (
                <Badge variant="outline" className="border-emerald-400/40 bg-emerald-500/10 text-emerald-200">
                  Đang công khai
                </Badge>
              )}
            </div>
            <h2 className="mt-2 text-2xl font-extrabold">{tournament.name}</h2>
            <p className="text-sm text-slate-300 mt-1">
              {tournament.location || 'Chưa cập nhật địa điểm'} • Cấu hình 24 VĐV — 12 đôi — 4 bảng — 8 đội Tứ kết
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="success" size="sm">
              <Link to={`/tournament/${id}/referee`}>
                Vào nhập tỷ số <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {myRole === 'admin' && (
              <Button asChild variant="secondary" size="sm">
                <Link to={`/tournament/${id}/players`}>Quản lý VĐV</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">Vận động viên</p>
              <p className="text-2xl font-extrabold text-navy-950 mt-1">{roster.total} / 24</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                TB-: {roster.counts['TB-']} • TBY: {roster.counts.TBY} • TBY+: {roster.counts['TBY+']}
              </p>
            </div>
            <div className="rounded-xl bg-sky-100 p-2.5 text-sky-700">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">Đội & Bảng đấu</p>
              <p className="text-2xl font-extrabold text-navy-950 mt-1">
                {teams.length} đội / {groups.length} bảng
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">Mục tiêu: 12 đội, 4 bảng A-D</p>
            </div>
            <div className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
              <Shield className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">Đã hoàn thành</p>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1">
                {matchStats.completed} / {matchStats.total}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">Tổng số trận toàn giải</p>
            </div>
            <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500">Đang diễn ra</p>
              <p className="text-2xl font-extrabold text-orange-600 mt-1">{matchStats.inProgress}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Chưa đấu: {matchStats.scheduled} trận</p>
            </div>
            <div className="rounded-xl bg-orange-100 p-2.5 text-orange-600">
              <Flame className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart + Group Leaders */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-navy-700" /> Tiến độ trận đấu
            </CardTitle>
          </CardHeader>
          <CardContent>
            {matchStats.total === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">Chưa có trận đấu nào được tạo.</p>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" /> Bảng xếp hạng thu gọn & Đội dẫn đầu
            </CardTitle>
            <Link
              to={`/tournament/${id}/standings`}
              className="text-xs font-semibold text-navy-700 hover:underline"
            >
              Xem chi tiết →
            </Link>
          </CardHeader>
          <CardContent>
            {standings.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                Chưa chia bảng đấu. Hãy hoàn thành bốc thăm ghép đội và random chia 4 bảng.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {standings.map((st) => (
                  <div key={st.groupId} className="rounded-xl border border-slate-200 p-3 bg-slate-50/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-navy-900">Bảng {st.groupName}</span>
                      {st.needsTieBreak && <Badge variant="warning">Cần tie-break</Badge>}
                    </div>
                    <div className="space-y-1.5">
                      {st.rows.map((r, idx) => (
                        <div
                          key={r.team_id}
                          className="flex items-center justify-between text-xs bg-white rounded-lg px-2.5 py-1.5 border border-slate-100"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={
                                idx === 0
                                  ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white'
                                  : idx === 1
                                    ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-700 text-[10px] font-bold text-white'
                                    : 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600'
                              }
                            >
                              {r.rank}
                            </span>
                            <span className="font-medium truncate">{r.team_name}</span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] text-slate-600 ml-2">
                            {r.won}T / HS {r.point_diff >= 0 ? `+${r.point_diff}` : r.point_diff}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming & Recent Matches */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-600" /> Trận đang diễn ra & sắp tới
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {upcomingMatches.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">Không có trận sắp diễn ra.</p>
            ) : (
              upcomingMatches.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-navy-800">#{m.match_number}</span>
                      <Badge variant={m.status === 'in_progress' ? 'live' : 'secondary'}>
                        {MATCH_STATUS_LABELS[m.status]}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {STAGE_LABELS[m.stage]}
                        {m.group ? ` • Bảng ${m.group.group_name}` : ''}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900 truncate">
                      {m.team_a?.team_name || 'Chờ xác định'} vs {m.team_b?.team_name || 'Chờ xác định'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {m.court?.court_name || 'Chưa gán sân'} • {formatDateTime(m.scheduled_at)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/tournament/${id}/referee?match=${m.id}`}>Nhập điểm</Link>
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Grid2x2 className="h-4 w-4 text-emerald-600" /> Kết quả gần nhất
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {recentCompleted.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">Chưa có trận đấu hoàn thành.</p>
            ) : (
              recentCompleted.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-bold text-navy-800">#{m.match_number}</span>
                      <span>{STAGE_LABELS[m.stage]}</span>
                      {m.group && <span>• Bảng {m.group.group_name}</span>}
                    </div>
                    <p className="mt-1 text-sm font-semibold truncate">
                      <span className={m.winner_team_id === m.team_a_id ? 'text-emerald-700' : 'text-slate-600'}>
                        {m.team_a?.team_name}
                      </span>
                      {' vs '}
                      <span className={m.winner_team_id === m.team_b_id ? 'text-emerald-700' : 'text-slate-600'}>
                        {m.team_b?.team_name}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(m.sets || []).map((s) => (
                      <span
                        key={s.id}
                        className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-navy-900"
                      >
                        {s.score_a}-{s.score_b}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
