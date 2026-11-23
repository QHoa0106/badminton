import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Trophy, AlertTriangle, Swords, GitBranch, Gavel, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { computeGroupStanding, type GroupStandingResolution } from '@/lib/scoring'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SelectNative, Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/StateViews'

function getDatabaseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const value = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
    }
    if (typeof value.message === 'string' && value.message) {
      const extra = typeof value.details === 'string' && value.details !== value.message
        ? value.details
        : typeof value.hint === 'string' && value.hint !== value.message
          ? value.hint
          : ''
      return extra ? `${value.message} ${extra}` : value.message
    }
  }
  return fallback
}

export function StandingsPage() {
  const { id } = useParams<{ id: string }>()
  const { tournament, groups, matches, tieBreakEvents, myRole, refresh } = useTournamentContext()
  const isAdmin = myRole === 'admin'

  const [creatingTb, setCreatingTb] = useState<string | null>(null)
  const [generatingKo, setGeneratingKo] = useState(false)

  // Admin manual resolution modal
  const [resolveTarget, setResolveTarget] = useState<GroupStandingResolution | null>(null)
  const [rank1, setRank1] = useState('')
  const [rank2, setRank2] = useState('')
  const [rank3, setRank3] = useState('')
  const [reason, setReason] = useState('')
  const [savingResolve, setSavingResolve] = useState(false)

  const resolutions = useMemo(
    () => groups.map((g) => computeGroupStanding(g, matches, tieBreakEvents)),
    [groups, matches, tieBreakEvents]
  )

  const hasKnockout = matches.some((m) =>
    ['quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.stage)
  )

  const allGroupsResolved =
    resolutions.length === 4 && resolutions.every((r) => r.resolved && r.qualifiedTop2 !== null)

  if (!tournament) return null

  const handleCreateTieBreak = async (res: GroupStandingResolution) => {
    setCreatingTb(res.groupId)
    try {
      const { error } = await supabase.rpc('generate_tie_break_matches', {
        p_tournament_id: tournament.id,
        p_group_id: res.groupId,
        p_team_ids: res.tiedTeamIds,
        p_event_type: res.tieBreakTypeNeeded === 'decider' ? 'decider' : null,
      })
      if (error) throw error
      toast.success(`Đã tạo trận Tie-break cho Bảng ${res.groupName} (1 set 15 điểm, cách biệt 2)!`)
      await refresh()
    } catch (err: unknown) {
      toast.error(getDatabaseErrorMessage(err, 'Không thể tạo trận tie-break'))
    } finally {
      setCreatingTb(null)
    }
  }

  const openManualResolve = (res: GroupStandingResolution) => {
    setResolveTarget(res)
    setRank1(res.rows[0]?.team_id || '')
    setRank2(res.rows[1]?.team_id || '')
    setRank3(res.rows[2]?.team_id || '')
    setReason('')
  }

  const handleSaveManualResolve = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resolveTarget) return
    if (new Set([rank1, rank2, rank3]).size !== 3) {
      toast.error('Phải chọn đủ 3 đội khác nhau cho các hạng 1, 2, 3')
      return
    }
    if (reason.trim().length < 3) {
      toast.error('Bắt buộc phải ghi rõ lý do quyết định thứ hạng')
      return
    }
    setSavingResolve(true)
    try {
      const { error } = await supabase.rpc('resolve_group_standings', {
        p_tournament_id: tournament.id,
        p_group_id: resolveTarget.groupId,
        p_ordered_team_ids: [rank1, rank2, rank3],
        p_reason: reason.trim(),
      })
      if (error) throw error
      toast.success(`Admin đã quyết định thứ hạng Bảng ${resolveTarget.groupName} và lưu lịch sử!`)
      setResolveTarget(null)
      await refresh()
    } catch (err: unknown) {
      toast.error(getDatabaseErrorMessage(err, 'Lỗi xác nhận thứ hạng'))
    } finally {
      setSavingResolve(false)
    }
  }

  const handleGenerateKnockout = async () => {
    if (!allGroupsResolved) {
      toast.error('Chưa thể sinh vòng Tứ kết vì vẫn còn bảng chưa xong hoặc còn tie-break.')
      return
    }
    setGeneratingKo(true)
    try {
      const qualified: Record<string, [string, string]> = {}
      for (const r of resolutions) {
        if (r.qualifiedTop2) qualified[r.groupName] = r.qualifiedTop2
      }
      const { error } = await supabase.rpc('generate_knockout_matches', {
        p_tournament_id: tournament.id,
        p_qualified: qualified,
      })
      if (error) throw error
      toast.success('Đã sinh 4 trận Tứ kết, 2 trận Bán kết, Tranh hạng 3 và Chung kết!')
      await refresh()
    } catch (err: unknown) {
      toast.error(getDatabaseErrorMessage(err, 'Không thể sinh vòng Tứ kết'))
    } finally {
      setGeneratingKo(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950 flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-500" /> Bảng xếp hạng vòng bảng & Tie-break
          </h2>
          <p className="text-sm text-slate-600">
            Xếp hạng theo: (1) Số trận thắng → (2) Hiệu số điểm vòng bảng chính thức → (3) Tie-break 15đ. Mỗi bảng chọn 2 đội đi tiếp.
          </p>
        </div>

        <div className="flex gap-2">
          {hasKnockout ? (
            <Button asChild variant="success">
              <Link to={`/tournament/${id}/knockout`}>
                <GitBranch className="h-4 w-4" /> Xem sơ đồ Tứ kết
              </Link>
            </Button>
          ) : isAdmin ? (
            <Button
              variant="success"
              disabled={!allGroupsResolved || generatingKo}
              onClick={handleGenerateKnockout}
            >
              <GitBranch className="h-4 w-4" />
              {generatingKo ? 'Đang sinh Tứ kết...' : 'Sinh vòng Tứ kết (8 đội)'}
            </Button>
          ) : null}
        </div>
      </div>

      {resolutions.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-7 w-7" />}
          title="Chưa có bảng xếp hạng"
          description="Bảng xếp hạng sẽ tự động cập nhật ngay khi có kết quả các trận vòng bảng."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {resolutions.map((res) => (
            <Card key={res.groupId} className="overflow-hidden">
              <CardHeader className="bg-navy-950 text-white py-3.5 flex flex-row items-center justify-between">
                <CardTitle className="text-white text-base">Bảng {res.groupName}</CardTitle>
                <div className="flex items-center gap-2">
                  {res.resolved ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Đã phân định Top 2
                    </Badge>
                  ) : res.needsTieBreak ? (
                    <Badge variant="warning">Cần Tie-break</Badge>
                  ) : (
                    <Badge variant="outline" className="border-navy-700 text-slate-200 bg-navy-900">
                      Đang thi đấu vòng bảng
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] uppercase">
                      <tr>
                        <th className="py-2.5 px-3 text-left">#</th>
                        <th className="py-2.5 px-2 text-left">Đội</th>
                        <th className="py-2.5 px-2 text-center">Trận</th>
                        <th className="py-2.5 px-2 text-center">T</th>
                        <th className="py-2.5 px-2 text-center">B</th>
                        <th className="py-2.5 px-2 text-center">Ghi</th>
                        <th className="py-2.5 px-2 text-center">Thua</th>
                        <th className="py-2.5 px-3 text-right">HS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {res.rows.map((r, idx) => (
                        <tr
                          key={r.team_id}
                          className={
                            idx < 2 && res.resolved
                              ? 'bg-emerald-50/40'
                              : r.is_tied
                                ? 'bg-amber-50/60'
                                : ''
                          }
                        >
                          <td className="py-2.5 px-3 font-bold">
                            <span
                              className={
                                idx < 2
                                  ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] text-white'
                                  : 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[11px] text-slate-600'
                              }
                            >
                              {r.rank}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 font-semibold text-slate-900">
                            {r.team_name}
                            {r.is_tied && (
                              <span className="ml-1.5 text-[10px] font-bold text-amber-700">
                                (Hòa)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono">{r.played}</td>
                          <td className="py-2.5 px-2 text-center font-mono font-bold text-emerald-700">
                            {r.won}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono text-red-600">{r.lost}</td>
                          <td className="py-2.5 px-2 text-center font-mono">{r.points_for}</td>
                          <td className="py-2.5 px-2 text-center font-mono">{r.points_against}</td>
                          <td
                            className={`py-2.5 px-3 text-right font-mono font-bold ${
                              r.point_diff > 0
                                ? 'text-emerald-700'
                                : r.point_diff < 0
                                  ? 'text-red-600'
                                  : 'text-slate-600'
                            }`}
                          >
                            {r.point_diff > 0 ? `+${r.point_diff}` : r.point_diff}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Tie-break action bar */}
                {res.needsTieBreak && (
                  <div className="border-t border-amber-200 bg-amber-50 p-3.5 space-y-2.5">
                    <div className="flex items-start gap-2 text-xs text-amber-900">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        {res.tieBreakTypeNeeded === 'three_team_round_robin'
                          ? 'Cả 3 đội bằng nhau về số trận thắng và hiệu số. Cần tổ chức Mini Round Robin 3 trận (1 set 15đ, cách biệt 2).'
                          : res.tieBreakTypeNeeded === 'two_team'
                            ? '2 đội bằng nhau về số trận thắng và hiệu số. Cần tổ chức 1 trận Tie-break (1 set 15đ, cách biệt 2).'
                            : res.tieBreakTypeNeeded === 'decider'
                              ? 'Sau tie-break vẫn còn 2 đội bằng nhau. Cần tạo 1 trận quyết định 15đ.'
                              : 'Trường hợp đặc biệt sau tie-break vẫn không phân định được. Admin cần quyết định thứ hạng kèm lý do.'}
                      </span>
                    </div>

                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        {res.tieBreakTypeNeeded !== 'admin_decision' && (
                          <Button
                            size="sm"
                            variant="warning"
                            disabled={creatingTb === res.groupId}
                            onClick={() => handleCreateTieBreak(res)}
                          >
                            <Swords className="h-3.5 w-3.5" />
                            {creatingTb === res.groupId
                              ? 'Đang tạo...'
                              : res.tieBreakTypeNeeded === 'three_team_round_robin'
                                ? 'Tạo Mini Round Robin (3 trận)'
                                : 'Tạo trận Tie-break 15đ'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openManualResolve(res)}
                        >
                          <Gavel className="h-3.5 w-3.5" /> Admin quyết định thứ hạng
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Admin Manual Resolution Dialog */}
      <Dialog open={Boolean(resolveTarget)} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin quyết định thứ hạng — Bảng {resolveTarget?.groupName}</DialogTitle>
            <DialogDescription>
              Chỉ sử dụng khi tie-break đặc biệt không thể phân định. Hệ thống không tự ý random — bắt buộc ghi lý do để lưu lịch sử.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveManualResolve} className="space-y-3">
            {[
              { label: 'Hạng 1 (Nhất bảng)', val: rank1, set: setRank1 },
              { label: 'Hạng 2 (Nhì bảng)', val: rank2, set: setRank2 },
              { label: 'Hạng 3', val: rank3, set: setRank3 },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">{item.label}</label>
                <SelectNative value={item.val} onChange={(e) => item.set(e.target.value)}>
                  {(resolveTarget?.rows || []).map((r) => (
                    <option key={r.team_id} value={r.team_id}>
                      {r.team_name}
                    </option>
                  ))}
                </SelectNative>
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Lý do quyết định *</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ghi rõ biên bản / căn cứ quyết định của Ban tổ chức..."
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResolveTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={savingResolve}>
                {savingResolve ? 'Đang lưu...' : 'Xác nhận thứ hạng'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
