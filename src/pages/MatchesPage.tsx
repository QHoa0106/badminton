import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Swords, ClipboardCheck } from 'lucide-react'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SelectNative } from '@/components/ui/input'
import { EmptyState } from '@/components/StateViews'
import { formatDateTime } from '@/lib/utils'
import { MATCH_STATUS_LABELS, STAGE_LABELS } from '@/types/database'

export function MatchesPage() {
  const { id } = useParams<{ id: string }>()
  const { matches, courts } = useTournamentContext()
  const [stageFilter, setStageFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [courtFilter, setCourtFilter] = useState('ALL')

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (stageFilter !== 'ALL' && m.stage !== stageFilter) return false
      if (statusFilter !== 'ALL' && m.status !== statusFilter) return false
      if (courtFilter !== 'ALL' && (m.court_id || 'NONE') !== courtFilter) return false
      return true
    })
  }, [matches, stageFilter, statusFilter, courtFilter])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950">Danh sách trận đấu ({filtered.length})</h2>
          <p className="text-sm text-slate-600">
            Theo dõi toàn bộ các trận vòng bảng, tie-break và vòng loại trực tiếp.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex">
          <SelectNative value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="sm:w-36">
            <option value="ALL">Mọi vòng</option>
            <option value="group">Vòng bảng</option>
            <option value="tie_break">Tie-break</option>
            <option value="quarterfinal">Tứ kết</option>
            <option value="semifinal">Bán kết</option>
            <option value="third_place">Tranh hạng 3</option>
            <option value="final">Chung kết</option>
          </SelectNative>

          <SelectNative value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-36">
            <option value="ALL">Mọi trạng thái</option>
            <option value="scheduled">Chưa diễn ra</option>
            <option value="in_progress">Đang diễn ra</option>
            <option value="completed">Đã hoàn thành</option>
          </SelectNative>

          <SelectNative value={courtFilter} onChange={(e) => setCourtFilter(e.target.value)} className="sm:w-32">
            <option value="ALL">Mọi sân</option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.court_name}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Swords className="h-7 w-7" />}
          title="Chưa có trận đấu phù hợp"
          description="Thử thay đổi bộ lọc hoặc sinh lịch thi đấu ở mục Lịch & Sân đấu."
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((m) => (
            <Card key={m.id}>
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-extrabold text-navy-900">
                      Trận #{m.match_number}
                    </span>
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
                    <Badge variant="outline">
                      {STAGE_LABELS[m.stage]}
                      {m.group ? ` • Bảng ${m.group.group_name}` : ''}
                      {m.bracket_slot ? ` • ${m.bracket_slot}` : ''}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      BO{m.best_of} • {m.target_points}đ (cách biệt {m.win_by})
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm font-bold">
                    <span
                      className={
                        m.winner_team_id && m.winner_team_id === m.team_a_id
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                      }
                    >
                      {m.team_a?.team_name || 'Chờ xác định'}
                    </span>
                    <span className="text-xs font-normal text-slate-400">vs</span>
                    <span
                      className={
                        m.winner_team_id && m.winner_team_id === m.team_b_id
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                      }
                    >
                      {m.team_b?.team_name || 'Chờ xác định'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500">
                    {m.court?.court_name || 'Chưa gán sân'} • {formatDateTime(m.scheduled_at)}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <div className="flex items-center gap-1.5">
                    {(m.sets || []).map((s) => (
                      <span
                        key={s.id}
                        className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-sm font-extrabold text-navy-950"
                      >
                        {s.score_a} - {s.score_b}
                      </span>
                    ))}
                  </div>
                  <Button asChild size="sm">
                    <Link to={`/tournament/${id}/referee?match=${m.id}`}>
                      <ClipboardCheck className="h-4 w-4" /> Nhập điểm
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
