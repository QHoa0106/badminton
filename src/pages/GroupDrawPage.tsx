import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Shuffle, CheckCircle2, RotateCcw, Lock, History, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateTime } from '@/lib/utils'
import type { DrawHistory } from '@/types/database'

function getErrorMessage(error: unknown): string {
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
  return 'Không thể random chia bảng'
}

export function GroupDrawPage() {
  const { id } = useParams<{ id: string }>()
  const { tournament, teams, groups, myRole, refresh } = useTournamentContext()
  const isAdmin = myRole === 'admin'

  const teamsConfirmed = teams.length === 12 && teams.every((t) => t.status === 'confirmed')
  const mixedTeamCount = teams.filter(
    (team) => team.status === 'confirmed' && team.team_type === 'TB-_TBY'
  ).length
  const plusTeamCount = teams.filter(
    (team) => team.status === 'confirmed' && team.team_type === 'TBY+_TBY+'
  ).length
  const teamsReadyForGroups =
    teamsConfirmed && mixedTeamCount === 6 && plusTeamCount === 6
  const groupsConfirmed = groups.length === 4 && groups.every((g) => g.status === 'confirmed')

  const [running, setRunning] = useState(false)
  const [animatingGroupId, setAnimatingGroupId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [history, setHistory] = useState<DrawHistory[]>([])

  const loadHistory = async () => {
    if (!tournament) return
    const { data } = await supabase
      .from('draw_history')
      .select('*')
      .eq('tournament_id', tournament.id)
      .eq('draw_type', 'group_draw')
      .order('created_at', { ascending: false })
    setHistory((data || []) as DrawHistory[])
  }

  useEffect(() => {
    loadHistory()
  }, [tournament?.id])

  if (!tournament) return null

  const handleRandomNextGroup = async (restart = false) => {
    setRunning(true)
    try {
      const { data, error } = await supabase.rpc('generate_next_group_draw', {
        p_tournament_id: tournament.id,
        p_restart: restart,
      })
      if (error) throw error
      setAnimatingGroupId(data?.group_id ?? null)
      await Promise.all([refresh(), loadHistory()])
      setRestartOpen(false)
      toast.success(`Đã random xong bảng ${data?.group_name ?? ''}!`)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const { error } = await supabase.rpc('confirm_group_draw', {
        p_tournament_id: tournament.id,
      })
      if (error) throw error
      toast.success('Đã xác nhận kết quả chia bảng! Bạn có thể tạo lịch thi đấu vòng bảng.')
      setConfirmOpen(false)
      await Promise.all([refresh(), loadHistory()])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Lỗi xác nhận chia bảng')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950 flex items-center gap-2">
            <Shuffle className="h-6 w-6 text-navy-700" /> Random lần lượt 4 bảng A, B, C, D
          </h2>
          <p className="text-sm text-slate-600">
            Bắt buộc: 2 bảng gồm (2 TB-+TBY & 1 TBY+) và 2 bảng gồm (1 TB-+TBY & 2 TBY+), vị trí bảng hoàn toàn ngẫu nhiên.
          </p>
        </div>

        {groupsConfirmed && (
          <Button asChild variant="success" size="sm">
            <Link to={`/tournament/${id}/schedule`}>
              Sang Tạo lịch thi đấu <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

      {!teamsConfirmed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Cần hoàn thành và <strong>xác nhận đủ 12 đội</strong> ở bước Bốc thăm ghép đội trước khi chia bảng.
        </div>
      )}
      {teamsConfirmed && !teamsReadyForGroups && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Không thể chia bảng: cần đúng 6 đội TB- + TBY và 6 đội TBY+ + TBY+ (hiện có {mixedTeamCount} và {plusTeamCount}).
        </div>
      )}

      {groupsConfirmed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-2.5 text-sm text-emerald-900">
          <Lock className="h-5 w-5 text-emerald-600 shrink-0" />
          <span>Kết quả chia 4 bảng đã được xác nhận và khóa. Sẵn sàng sinh 12 trận vòng bảng.</span>
        </div>
      )}

      {/* Draw one group at a time */}
      {isAdmin && !groupsConfirmed && (
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-navy-950 via-navy-900 to-indigo-950 text-white shadow-lg">
          <CardContent className="space-y-5 p-6 text-center sm:p-8">
            <div className="mx-auto max-w-xl space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Tiến độ bốc thăm
              </p>
              <p className="text-2xl font-extrabold">
                {Math.min(groups.length, 4)} <span className="text-white/50">/ 4 bảng</span>
              </p>
              <div
                className="h-2 overflow-hidden rounded-full bg-white/15"
                role="progressbar"
                aria-label="Tiến độ random chia bảng"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={Math.min(groups.length, 4)}
              >
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300"
                  initial={false}
                  animate={{ width: `${(Math.min(groups.length, 4) / 4) * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
              <p className="text-sm text-slate-300">
                {groups.length < 4
                  ? `Mỗi lượt chỉ random một bảng. Bảng ${String.fromCharCode(65 + groups.length)} sẽ được lưu ngay sau khi quay.`
                  : 'Đã hoàn thành đủ 4 bảng. Hãy kiểm tra kết quả rồi xác nhận.'}
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {groups.length < 4 && (
                <Button
                  size="lg"
                  variant="success"
                  onClick={() => handleRandomNextGroup()}
                  disabled={!teamsReadyForGroups || running}
                  className="h-12 px-7 text-base font-extrabold shadow-lg"
                >
                  <Shuffle className={running ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                  {running
                    ? 'Đang random bảng...'
                    : `Random bảng ${String.fromCharCode(65 + groups.length)} tiếp theo`}
                </Button>
              )}

              {groups.length > 0 && !running && (
                <Button variant="secondary" onClick={() => setRestartOpen(true)}>
                  <RotateCcw className="h-4 w-4" /> Random lại từ bảng A
                </Button>
              )}

              {groups.length === 4 && !running && (
                <Button
                  size="lg"
                  variant="warning"
                  onClick={() => setConfirmOpen(true)}
                >
                  <CheckCircle2 className="h-5 w-5" /> Xác nhận chia bảng
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Drawn groups */}
      {groups.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <AnimatePresence mode="popLayout">
            {groups.map((g) => {
              const isNewGroup = g.id === animatingGroupId
              return (
              <motion.div
                key={g.id}
                layout
                initial={isNewGroup ? { opacity: 0, scale: 0.94, y: 24 } : false}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -12 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              >
                <Card className="h-full border-t-4 border-t-navy-800">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">Bảng {g.group_name}</CardTitle>
                    <Badge variant="outline">
                      {g.distribution_type === '2_mixed_1_plus'
                        ? '2 (TB-+TBY) • 1 (TBY+)'
                        : '1 (TB-+TBY) • 2 (TBY+)'}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    {(g.group_teams || []).map((gt, ti) => (
                      <motion.div
                        key={gt.id}
                        initial={isNewGroup ? { opacity: 0, x: -14 } : false}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.3,
                          delay: isNewGroup ? 0.12 + ti * 0.16 : 0,
                        }}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-slate-400 mr-2">
                            {g.group_name}
                            {ti + 1}
                          </span>
                          <span className="text-sm font-bold text-navy-950">
                            {gt.team?.team_name}
                          </span>
                        </div>
                        <Badge variant={gt.team?.team_type === 'TB-_TBY' ? 'tbMinus' : 'tbyPlus'}>
                          {gt.team?.team_type === 'TB-_TBY' ? 'TB-+TBY' : 'TBY+'}
                        </Badge>
                      </motion.div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500" /> Lịch sử chia bảng ({history.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có lịch sử chia bảng.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h, i) => (
                <div
                  key={h.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-bold text-navy-900">Lần #{history.length - i}</span>
                    <span className="mx-2 text-slate-400">•</span>
                    <span>{formatDateTime(h.created_at)}</span>
                  </div>
                  <Badge variant={h.confirmed_at ? 'success' : 'secondary'}>
                    {h.confirmed_at ? `Đã xác nhận (${formatDateTime(h.confirmed_at)})` : 'Bản nháp'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Xác nhận kết quả chia 4 bảng?"
        description="Sau khi xác nhận, 4 bảng đấu sẽ được khóa để tạo 12 trận vòng bảng. Bạn có chắc chắn muốn xác nhận?"
        confirmLabel="Xác nhận chia bảng"
        variant="warning"
        loading={confirming}
        onConfirm={handleConfirm}
      />

      <ConfirmDialog
        open={restartOpen}
        onOpenChange={setRestartOpen}
        title="Random lại từ bảng A?"
        description="Các bảng nháp hiện tại sẽ bị xóa và random lại từng bảng từ đầu. Mỗi lần bấm sẽ tạo một bảng mới."
        confirmLabel="Xóa nháp và random bảng A"
        variant="warning"
        loading={running}
        onConfirm={() => handleRandomNextGroup(true)}
      />
    </div>
  )
}
