import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Trophy, Radio, Calendar, MapPin, ChevronLeft } from 'lucide-react'
import { useTournamentData } from '@/hooks/useTournamentData'
import { isSupabaseConfigured } from '@/lib/supabase'
import { computeGroupStanding } from '@/lib/scoring'
import { SupabaseConfigBanner } from '@/components/SupabaseConfigBanner'
import { BracketView } from '@/components/BracketView'
import { ErrorState, LoadingState } from '@/components/StateViews'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateOnly, formatDateTime } from '@/lib/utils'
import {
  MATCH_STATUS_LABELS,
  STAGE_LABELS,
  TOURNAMENT_STATUS_LABELS,
} from '@/types/database'

type TabKey = 'live' | 'standings' | 'bracket' | 'groups' | 'players'

export function PublicTournamentPage() {
  const { slug } = useParams<{ slug: string }>()
  const {
    tournament,
    players,
    teams,
    groups,
    matches,
    tieBreakEvents,
    loading,
    error,
    realtimeStatus,
    refresh,
  } = useTournamentData(undefined, slug)

  const [tab, setTab] = useState<TabKey>('live')

  const standings = useMemo(
    () => groups.map((g) => computeGroupStanding(g, matches, tieBreakEvents)),
    [groups, matches, tieBreakEvents]
  )

  const koMatches = useMemo(
    () =>
      matches.filter((m) =>
        ['quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.stage)
      ),
    [matches]
  )

  const liveMatches = useMemo(
    () => matches.filter((m) => m.status === 'in_progress'),
    [matches]
  )

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <SupabaseConfigBanner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-navy-950 via-navy-900 to-navy-800 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/tournaments"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" /> Danh sách giải đấu
            </Link>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-1 text-xs font-semibold text-emerald-200">
              <Radio
                className={
                  realtimeStatus === 'connected'
                    ? 'h-3.5 w-3.5 animate-pulse text-emerald-400'
                    : 'h-3.5 w-3.5'
                }
              />
              {realtimeStatus === 'connected' ? 'Cập nhật Realtime' : 'Đang kết nối...'}
            </span>
          </div>

          {tournament && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">{TOURNAMENT_STATUS_LABELS[tournament.status]}</Badge>
                <Badge variant="outline" className="border-white/20 bg-white/10 text-white">
                  Chế độ Người xem (Chỉ đọc)
                </Badge>
              </div>
              <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold flex items-center gap-2.5">
                <Trophy className="h-7 w-7 text-amber-400 shrink-0" />
                {tournament.name}
              </h1>
              <div className="mt-2 flex flex-wrap gap-4 text-xs sm:text-sm text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" /> {formatDateOnly(tournament.event_date)}
                </span>
                {tournament.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" /> {tournament.location}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : !tournament ? null : (
          <>
            {/* Navigation Tabs */}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['live', `Tỷ số & Lịch đấu (${matches.length})`],
                  ['standings', 'Bảng xếp hạng'],
                  ['bracket', 'Sơ đồ loại trực tiếp'],
                  ['groups', `4 Bảng & ${teams.length} Đội`],
                  ['players', `Vận động viên (${players.length})`],
                ] as [TabKey, string][]
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={tab === key ? 'default' : 'outline'}
                  onClick={() => setTab(key)}
                >
                  {label}
                </Button>
              ))}
            </div>

            {tab === 'live' && (
              <div className="space-y-6">
                {liveMatches.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-base font-extrabold text-orange-700 flex items-center gap-2">
                      <Radio className="h-4 w-4 animate-pulse" /> Đang thi đấu trực tiếp ({liveMatches.length})
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {liveMatches.map((m) => (
                        <Card key={m.id} className="border-2 border-orange-400">
                          <CardContent className="p-4 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-navy-900">
                                #{m.match_number} • {STAGE_LABELS[m.stage]}
                                {m.group ? ` Bảng ${m.group.group_name}` : ''}
                              </span>
                              <Badge variant="live">{m.court?.court_name || 'Đang đấu'}</Badge>
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span className="font-bold text-sm text-navy-950 truncate">
                                {m.team_a?.team_name}
                              </span>
                              <div className="flex gap-1 shrink-0">
                                {(m.sets || []).map((s) => (
                                  <span
                                    key={s.id}
                                    className="rounded bg-navy-950 text-white px-2.5 py-1 font-mono text-sm font-black"
                                  >
                                    {s.score_a} - {s.score_b}
                                  </span>
                                ))}
                              </div>
                              <span className="font-bold text-sm text-navy-950 truncate text-right">
                                {m.team_b?.team_name}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle>Toàn bộ lịch & kết quả trận đấu</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    {matches.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-6">Chưa có lịch thi đấu.</p>
                    ) : (
                      matches.map((m) => (
                        <div
                          key={m.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-bold text-navy-900">#{m.match_number}</span>
                              <Badge
                                variant={
                                  m.status === 'completed'
                                    ? 'success'
                                    : m.status === 'in_progress'
                                      ? 'live'
                                      : 'secondary'
                                }
                              >
                                {MATCH_STATUS_LABELS[m.status]}
                              </Badge>
                              <span className="text-slate-500">
                                {STAGE_LABELS[m.stage]}
                                {m.group ? ` • Bảng ${m.group.group_name}` : ''} •{' '}
                                {m.court?.court_name || 'Chưa gán sân'} • {formatDateTime(m.scheduled_at)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-bold">
                              <span className={m.winner_team_id === m.team_a_id ? 'text-emerald-700' : ''}>
                                {m.team_a?.team_name || 'TBD'}
                              </span>
                              <span className="mx-2 text-slate-400 font-normal">vs</span>
                              <span className={m.winner_team_id === m.team_b_id ? 'text-emerald-700' : ''}>
                                {m.team_b?.team_name || 'TBD'}
                              </span>
                            </p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            {(m.sets || []).map((s) => (
                              <span
                                key={s.id}
                                className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-sm font-extrabold text-navy-950"
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
            )}

            {tab === 'standings' && (
              <div className="grid gap-5 lg:grid-cols-2">
                {standings.length === 0 ? (
                  <p className="text-sm text-slate-500">Chưa có bảng xếp hạng.</p>
                ) : (
                  standings.map((res) => (
                    <Card key={res.groupId} className="overflow-hidden">
                      <CardHeader className="bg-navy-950 text-white py-3">
                        <CardTitle className="text-white text-base">Bảng {res.groupName}</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 overflow-x-auto">
                        <table className="w-full text-xs sm:text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] uppercase">
                            <tr>
                              <th className="py-2.5 px-3 text-left">#</th>
                              <th className="py-2.5 px-2 text-left">Đội</th>
                              <th className="py-2.5 px-2 text-center">Trận</th>
                              <th className="py-2.5 px-2 text-center">T</th>
                              <th className="py-2.5 px-2 text-center">B</th>
                              <th className="py-2.5 px-3 text-right">HS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {res.rows.map((r, idx) => (
                              <tr key={r.team_id} className={idx < 2 ? 'bg-emerald-50/40' : ''}>
                                <td className="py-2.5 px-3 font-bold">{r.rank}</td>
                                <td className="py-2.5 px-2 font-semibold">{r.team_name}</td>
                                <td className="py-2.5 px-2 text-center font-mono">{r.played}</td>
                                <td className="py-2.5 px-2 text-center font-mono font-bold text-emerald-700">
                                  {r.won}
                                </td>
                                <td className="py-2.5 px-2 text-center font-mono text-red-600">{r.lost}</td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold">
                                  {r.point_diff > 0 ? `+${r.point_diff}` : r.point_diff}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}

            {tab === 'bracket' && (
              koMatches.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-slate-500">
                    Vòng loại trực tiếp (Tứ kết → Chung kết) chưa bắt đầu.
                  </CardContent>
                </Card>
              ) : (
                <BracketView matches={koMatches} />
              )
            )}

            {tab === 'groups' && (
              <div className="grid gap-4 sm:grid-cols-2">
                {groups.map((g) => (
                  <Card key={g.id}>
                    <CardHeader className="pb-2">
                      <CardTitle>Bảng {g.group_name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {(g.group_teams || []).map((gt) => (
                        <div
                          key={gt.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                        >
                          <span className="font-bold text-navy-950">{gt.team?.team_name}</span>
                          <Badge variant={gt.team?.team_type === 'TB-_TBY' ? 'tbMinus' : 'tbyPlus'}>
                            {gt.team?.team_type === 'TB-_TBY' ? 'TB-+TBY' : 'TBY+'}
                          </Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {tab === 'players' && (
              <Card>
                <CardHeader>
                  <CardTitle>Danh sách vận động viên ({players.length})</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold text-slate-900">{p.player?.full_name}</span>
                      <Badge
                        variant={
                          p.skill_level === 'TB-'
                            ? 'tbMinus'
                            : p.skill_level === 'TBY'
                              ? 'tby'
                              : 'tbyPlus'
                        }
                      >
                        {p.skill_level}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  )
}
