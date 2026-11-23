import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus,
  Minus,
  Undo2,
  Save,
  RefreshCw,
  AlertTriangle,
  History,
  CheckCircle2,
  ClipboardCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { evaluateMatch, evaluateSet } from '@/lib/scoring'
import { formatDateTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, SelectNative } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/StateViews'
import {
  MATCH_STATUS_LABELS,
  STAGE_LABELS,
  type Match,
  type MatchScoreAudit,
} from '@/types/database'

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

export function RefereePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { matches, courts, refresh } = useTournamentContext()

  const [courtFilter, setCourtFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [dateFilter, setDateFilter] = useState('')

  const selectedId = searchParams.get('match') || ''
  const [activeSetNo, setActiveSetNo] = useState(1)
  const [manualA, setManualA] = useState('0')
  const [manualB, setManualB] = useState('0')
  const [saving, setSaving] = useState(false)
  const [conflictMsg, setConflictMsg] = useState<string | null>(null)
  const [audits, setAudits] = useState<MatchScoreAudit[]>([])

  // Confirm edit completed match
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmDesc, setConfirmDesc] = useState('')

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (courtFilter !== 'ALL' && (m.court_id || 'NONE') !== courtFilter) return false
      if (statusFilter !== 'ALL' && m.status !== statusFilter) return false
      if (dateFilter && m.scheduled_at) {
        const d = new Date(m.scheduled_at).toISOString().slice(0, 10)
        if (d !== dateFilter) return false
      }
      return true
    })
  }, [matches, courtFilter, statusFilter, dateFilter])

  const selectedMatch: Match | undefined = useMemo(() => {
    if (selectedId) return matches.find((m) => m.id === selectedId)
    return filteredMatches[0]
  }, [matches, filteredMatches, selectedId])

  const activeSet = useMemo(() => {
    if (!selectedMatch) return undefined
    return (selectedMatch.sets || []).find((s) => s.set_number === activeSetNo)
  }, [selectedMatch, activeSetNo])

  useEffect(() => {
    if (!selectedMatch) return
    const sets = selectedMatch.sets || []
    const inProg = sets.find((s) => s.status !== 'completed') || sets[sets.length - 1]
    if (inProg && !sets.some((s) => s.set_number === activeSetNo)) {
      setActiveSetNo(inProg.set_number)
    }
  }, [selectedMatch?.id])

  useEffect(() => {
    setManualA(String(activeSet?.score_a ?? 0))
    setManualB(String(activeSet?.score_b ?? 0))
  }, [activeSet?.score_a, activeSet?.score_b, selectedMatch?.id, activeSetNo])

  const loadAudits = async (matchId: string) => {
    const { data } = await supabase
      .from('match_score_audit')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(20)
    setAudits((data || []) as MatchScoreAudit[])
  }

  useEffect(() => {
    if (selectedMatch?.id) {
      loadAudits(selectedMatch.id)
      setConflictMsg(null)
    } else {
      setAudits([])
    }
  }, [selectedMatch?.id, selectedMatch?.updated_at])

  const executeSaveScore = async (
    scoreA: number,
    scoreB: number,
    action: string
  ) => {
    if (!selectedMatch) return
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      toast.error('Điểm số phải là số nguyên không âm')
      return
    }
    setSaving(true)
    setConflictMsg(null)
    try {
      const { error } = await supabase.rpc('save_match_set_score', {
        p_match_id: selectedMatch.id,
        p_set_number: activeSetNo,
        p_score_a: scoreA,
        p_score_b: scoreB,
        p_action: action,
        p_expected_updated_at: selectedMatch.updated_at,
      })
      if (error) {
        if (error.message.includes('CONFLICT')) {
          setConflictMsg(
            'Phát hiện xung đột: Trọng tài khác vừa cập nhật trận đấu này! Hệ thống đã chặn ghi đè để bảo vệ dữ liệu mới nhất.'
          )
          toast.error('Xung đột cập nhật! Đang làm mới dữ liệu mới nhất...')
          await refresh()
          return
        }
        throw error
      }
      toast.success(`Đã lưu điểm Set ${activeSetNo}: ${scoreA} - ${scoreB}`)
      await refresh()
      await loadAudits(selectedMatch.id)
    } catch (err: unknown) {
      toast.error(getDatabaseErrorMessage(err, 'Lỗi lưu tỷ số vào Database'))
    } finally {
      setSaving(false)
    }
  }

  const requestSaveScore = (scoreA: number, scoreB: number, action: string) => {
    if (!selectedMatch) return
    if (selectedMatch.status === 'completed') {
      setConfirmTitle('Sửa tỷ số trận đã hoàn thành?')
      setConfirmDesc(
        `Trận #${selectedMatch.match_number} đã hoàn thành. Mọi chỉnh sửa sẽ được ghi vào lịch sử kiểm toán. Bạn có chắc muốn cập nhật Set ${activeSetNo} thành ${scoreA} - ${scoreB}?`
      )
      setPendingAction(() => async () => {
        await executeSaveScore(scoreA, scoreB, action)
        setPendingAction(null)
      })
      return
    }
    executeSaveScore(scoreA, scoreB, action)
  }

  const handleDelta = (team: 'A' | 'B', delta: number) => {
    const curA = activeSet?.score_a ?? 0
    const curB = activeSet?.score_b ?? 0
    const nextA = team === 'A' ? Math.max(0, curA + delta) : curA
    const nextB = team === 'B' ? Math.max(0, curB + delta) : curB
    if (nextA === curA && nextB === curB) return
    requestSaveScore(nextA, nextB, `${delta > 0 ? 'plus' : 'minus'}_${team}`)
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const a = Number(manualA)
    const b = Number(manualB)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      toast.error('Vui lòng nhập số nguyên không âm')
      return
    }
    requestSaveScore(a, b, 'manual_input')
  }

  const handleUndo = async () => {
    if (!selectedMatch) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('undo_last_score_change', {
        p_match_id: selectedMatch.id,
      })
      if (error) throw error
      toast.success('Đã hoàn tác thao tác điểm gần nhất')
      await refresh()
      await loadAudits(selectedMatch.id)
    } catch (err: unknown) {
      toast.error(getDatabaseErrorMessage(err, 'Không thể hoàn tác'))
    } finally {
      setSaving(false)
    }
  }

  const matchEval = selectedMatch
    ? evaluateMatch(
        selectedMatch.sets || [],
        selectedMatch.target_points,
        selectedMatch.best_of,
        selectedMatch.win_by
      )
    : null

  const setEval = selectedMatch
    ? evaluateSet(
        activeSet?.score_a ?? 0,
        activeSet?.score_b ?? 0,
        selectedMatch.target_points,
        selectedMatch.win_by
      )
    : null

  const teamAMembers = (selectedMatch?.team_a?.members || [])
    .map((m) => m.tournament_player?.player?.full_name)
    .filter(Boolean)
    .join(' & ')
  const teamBMembers = (selectedMatch?.team_b?.members || [])
    .map((m) => m.tournament_player?.player?.full_name)
    .filter(Boolean)
    .join(' & ')

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-emerald-600" /> Bảng nhập tỷ số Trọng tài
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Mọi trọng tài đều có quyền cập nhật tất cả trận đấu. Tỷ số đồng bộ Realtime ngay sau khi Database xác nhận.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => refresh()}>
          <RefreshCw className="h-4 w-4" /> Làm mới
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <SelectNative
          value={selectedMatch?.id || ''}
          onChange={(e) => {
            setSearchParams({ match: e.target.value })
            setActiveSetNo(1)
          }}
          className="sm:col-span-2 font-semibold"
        >
          {filteredMatches.length === 0 && <option value="">-- Không có trận phù hợp --</option>}
          {filteredMatches.map((m) => (
            <option key={m.id} value={m.id}>
              #{m.match_number} [{STAGE_LABELS[m.stage]}
              {m.group ? ` ${m.group.group_name}` : ''}] {m.team_a?.team_name || 'TBD'} vs{' '}
              {m.team_b?.team_name || 'TBD'} ({MATCH_STATUS_LABELS[m.status]})
            </option>
          ))}
        </SelectNative>

        <SelectNative value={courtFilter} onChange={(e) => setCourtFilter(e.target.value)}>
          <option value="ALL">Tất cả sân</option>
          {courts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.court_name}
            </option>
          ))}
        </SelectNative>

        <div className="grid grid-cols-2 gap-2">
          <SelectNative value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">Mọi TT</option>
            <option value="scheduled">Chưa đấu</option>
            <option value="in_progress">Đang đấu</option>
            <option value="completed">Xong</option>
          </SelectNative>
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            title="Lọc theo ngày"
          />
        </div>
      </div>

      {!selectedMatch ? (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="Chưa chọn trận đấu"
          description="Hãy tạo lịch thi đấu trước hoặc chọn một trận đấu trong danh sách phía trên."
        />
      ) : (
        <>
          {conflictMsg && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 text-sm text-red-800">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                <span>{conflictMsg}</span>
              </div>
              <Button size="sm" variant="destructive" onClick={() => refresh()}>
                Tải lại ngay
              </Button>
            </div>
          )}

          {/* Main Scoreboard Card */}
          <Card className="overflow-hidden border-2 border-navy-900 shadow-lg">
            {/* Match Metadata Header */}
            <div className="bg-navy-950 text-white px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-extrabold text-emerald-400">
                  TRẬN #{selectedMatch.match_number}
                </span>
                <Badge variant="outline" className="border-navy-700 bg-navy-900 text-slate-200">
                  {STAGE_LABELS[selectedMatch.stage]}
                  {selectedMatch.group ? ` • Bảng ${selectedMatch.group.group_name}` : ''}
                  {selectedMatch.bracket_slot ? ` • ${selectedMatch.bracket_slot}` : ''}
                </Badge>
                <Badge
                  variant={
                    selectedMatch.status === 'completed'
                      ? 'success'
                      : selectedMatch.status === 'in_progress'
                        ? 'live'
                        : 'secondary'
                  }
                >
                  {MATCH_STATUS_LABELS[selectedMatch.status]}
                </Badge>
              </div>
              <div className="text-xs text-slate-300">
                {selectedMatch.court?.court_name || 'Chưa gán sân'} •{' '}
                {formatDateTime(selectedMatch.scheduled_at)} • BO{selectedMatch.best_of} (
                {selectedMatch.target_points}đ, cách biệt {selectedMatch.win_by})
              </div>
            </div>

            <CardContent className="p-4 sm:p-6 space-y-6">
              {/* Set Selector (BO3) */}
              {selectedMatch.best_of === 3 && (
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    {[1, 2, 3].map((sn) => {
                      const s = (selectedMatch.sets || []).find((x) => x.set_number === sn)
                      const disabled =
                        sn === 3 &&
                        matchEval?.isCompleted &&
                        !s
                      return (
                        <Button
                          key={sn}
                          size="sm"
                          variant={activeSetNo === sn ? 'default' : 'outline'}
                          disabled={disabled}
                          onClick={() => setActiveSetNo(sn)}
                        >
                          Set {sn} {s ? `(${s.score_a}-${s.score_b})` : ''}
                        </Button>
                      )
                    })}
                  </div>
                  <div className="text-sm font-bold text-navy-900">
                    Số set thắng: <span className="text-emerald-700">{matchEval?.setsWonA}</span> -{' '}
                    <span className="text-emerald-700">{matchEval?.setsWonB}</span>
                  </div>
                </div>
              )}

              {/* Big Mobile-Friendly Scoreboard */}
              <div className="grid grid-cols-2 gap-3 sm:gap-6">
                {/* TEAM A */}
                <div
                  className={
                    selectedMatch.winner_team_id &&
                    selectedMatch.winner_team_id === selectedMatch.team_a_id
                      ? 'rounded-2xl border-2 border-emerald-500 bg-emerald-50/50 p-3 sm:p-5 text-center space-y-3'
                      : 'rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-5 text-center space-y-3'
                  }
                >
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-500">Đội A</p>
                    <h3 className="text-sm sm:text-lg font-extrabold text-navy-950 line-clamp-2 min-h-[2.5rem] flex items-center justify-center">
                      {selectedMatch.team_a?.team_name || 'Chờ xác định'}
                    </h3>
                    {teamAMembers && (
                      <p className="text-[11px] text-slate-500 truncate">{teamAMembers}</p>
                    )}
                  </div>

                  <div className="text-5xl sm:text-7xl font-black font-mono text-navy-950 py-2">
                    {activeSet?.score_a ?? 0}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-14 text-lg font-extrabold"
                      disabled={saving || !selectedMatch.team_a_id || (activeSet?.score_a ?? 0) === 0}
                      onClick={() => handleDelta('A', -1)}
                    >
                      <Minus className="h-5 w-5" /> 1
                    </Button>
                    <Button
                      size="lg"
                      variant="success"
                      className="h-14 text-lg font-extrabold"
                      disabled={saving || !selectedMatch.team_a_id}
                      onClick={() => handleDelta('A', 1)}
                    >
                      <Plus className="h-5 w-5" /> 1
                    </Button>
                  </div>
                </div>

                {/* TEAM B */}
                <div
                  className={
                    selectedMatch.winner_team_id &&
                    selectedMatch.winner_team_id === selectedMatch.team_b_id
                      ? 'rounded-2xl border-2 border-emerald-500 bg-emerald-50/50 p-3 sm:p-5 text-center space-y-3'
                      : 'rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-5 text-center space-y-3'
                  }
                >
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-500">Đội B</p>
                    <h3 className="text-sm sm:text-lg font-extrabold text-navy-950 line-clamp-2 min-h-[2.5rem] flex items-center justify-center">
                      {selectedMatch.team_b?.team_name || 'Chờ xác định'}
                    </h3>
                    {teamBMembers && (
                      <p className="text-[11px] text-slate-500 truncate">{teamBMembers}</p>
                    )}
                  </div>

                  <div className="text-5xl sm:text-7xl font-black font-mono text-navy-950 py-2">
                    {activeSet?.score_b ?? 0}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-14 text-lg font-extrabold"
                      disabled={saving || !selectedMatch.team_b_id || (activeSet?.score_b ?? 0) === 0}
                      onClick={() => handleDelta('B', -1)}
                    >
                      <Minus className="h-5 w-5" /> 1
                    </Button>
                    <Button
                      size="lg"
                      variant="success"
                      className="h-14 text-lg font-extrabold"
                      disabled={saving || !selectedMatch.team_b_id}
                      onClick={() => handleDelta('B', 1)}
                    >
                      <Plus className="h-5 w-5" /> 1
                    </Button>
                  </div>
                </div>
              </div>

              {/* Set Status Hint */}
              {setEval && (
                <div className="text-center text-xs font-semibold">
                  {setEval.isCompleted ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />
                      Set {activeSetNo} đã đủ điều kiện thắng (đội{' '}
                      {setEval.winner === 'A'
                        ? selectedMatch.team_a?.team_name
                        : selectedMatch.team_b?.team_name}
                      )
                    </span>
                  ) : (activeSet?.score_a ?? 0) >= selectedMatch.target_points - 1 &&
                    (activeSet?.score_b ?? 0) >= selectedMatch.target_points - 1 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                      Đang giằng co (Deuce) — Cần hơn đối thủ ít nhất {selectedMatch.win_by} điểm để thắng set!
                    </span>
                  ) : null}
                </div>
              )}

              {/* Manual Input + Undo */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <form onSubmit={handleManualSubmit} className="flex flex-wrap items-end gap-2.5">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Nhập tay Đội A (Set {activeSetNo})
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={manualA}
                      onChange={(e) => setManualA(e.target.value)}
                      className="w-24 font-mono font-bold text-center"
                    />
                  </div>
                  <span className="pb-2 font-bold text-slate-400">-</span>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Nhập tay Đội B (Set {activeSetNo})
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={manualB}
                      onChange={(e) => setManualB(e.target.value)}
                      className="w-24 font-mono font-bold text-center"
                    />
                  </div>
                  <Button type="submit" disabled={saving || !selectedMatch.team_a_id || !selectedMatch.team_b_id}>
                    <Save className="h-4 w-4" /> Lưu thay đổi
                  </Button>
                </form>

                <Button
                  variant="outline"
                  onClick={handleUndo}
                  disabled={saving || audits.length === 0}
                >
                  <Undo2 className="h-4 w-4" /> Hoàn tác (Undo)
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Audit History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <History className="h-4 w-4 text-slate-500" /> Lịch sử chỉnh sửa tỷ số trận #
                {selectedMatch.match_number} ({audits.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {audits.length === 0 ? (
                <p className="text-xs text-slate-500">Chưa có thao tác ghi điểm nào cho trận này.</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {audits.map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-navy-900">
                          {a.user?.full_name || a.user?.email || 'Trọng tài'}
                        </span>
                        <span className="mx-1.5 text-slate-400">•</span>
                        <span className="font-mono">
                          {a.old_score_a ?? 0}-{a.old_score_b ?? 0} →{' '}
                          <strong>
                            {a.new_score_a ?? 0}-{a.new_score_b ?? 0}
                          </strong>
                        </span>
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">
                          {a.action}
                        </span>
                      </div>
                      <span className="text-slate-400">{formatDateTime(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingAction)}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title={confirmTitle}
        description={confirmDesc}
        confirmLabel="Xác nhận sửa tỷ số"
        variant="warning"
        loading={saving}
        onConfirm={async () => {
          if (pendingAction) await pendingAction()
        }}
      />
    </div>
  )
}
