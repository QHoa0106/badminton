import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Disc3,
  Volume2,
  VolumeX,
  RotateCcw,
  CheckCircle2,
  History,
  Sparkles,
  Lock,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { validatePlayerRoster } from '@/lib/scoring'
import { normalizeTeamDrawRevealCount } from '@/lib/teamDraw'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateTime } from '@/lib/utils'
import type { DrawHistory, SkillLevel } from '@/types/database'

interface DrawnTeamItem {
  order: number
  team_id: string
  team_type: 'TB-_TBY' | 'TBY+_TBY+'
  team_name: string
  player1: { tournament_player_id: string; full_name: string; skill_level: SkillLevel }
  player2: { tournament_player_id: string; full_name: string; skill_level: SkillLevel }
}

interface DrawQueueItem {
  tournament_player_id: string
  full_name: string
  skill_level: SkillLevel
  team_order: number
  team_type: DrawnTeamItem['team_type']
}

function extractSupabaseError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') {
    const value = error as {
      message?: unknown
      code?: unknown
      details?: unknown
      hint?: unknown
    }
    const message = typeof value.message === 'string' ? value.message : null
    const code = typeof value.code === 'string' ? value.code : null
    const details = typeof value.details === 'string' ? value.details : null
    const hint = typeof value.hint === 'string' ? value.hint : null

    if (code === 'PGRST202' || code === '404') {
      return new Error(
        'Không tìm thấy RPC generate_team_draw trên Supabase. Hãy chạy migration 003_rpc_functions.sql (hoặc 005_draw_rpc_repair.sql) trong SQL Editor.'
      )
    }
    if (message) {
      const extra = details && details !== message ? ` ${details}` : hint && hint !== message ? ` ${hint}` : ''
      return new Error(`${message}${extra}`)
    }
  }
  return new Error('Không thể thực hiện bốc thăm')
}

const SLICE_COLORS: Record<SkillLevel, string[]> = {
  'TB-': ['#0284c7', '#0369a1', '#0ea5e9', '#38bdf8', '#075985', '#0c4a6e'],
  TBY: ['#7c3aed', '#6d28d9', '#8b5cf6', '#a78bfa', '#5b21b6', '#4c1d95'],
  'TBY+': ['#d97706', '#b45309', '#f59e0b', '#ea580c', '#c2410c', '#92400e'],
}

function playBeep(freq: number, durationMs: number, volume = 0.08) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    gain.gain.value = volume
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    setTimeout(() => {
      osc.stop()
      ctx.close()
    }, durationMs)
  } catch {
    // Trình duyệt chặn autoplay audio nếu chưa tương tác
  }
}

export function TeamDrawPage() {
  const { id } = useParams<{ id: string }>()
  const { tournament, players, teams, myRole, refresh } = useTournamentContext()
  const isAdmin = myRole === 'admin'

  const roster = useMemo(() => validatePlayerRoster(players), [players])
  const isConfirmed = teams.length === 12 && teams.every((t) => t.status === 'confirmed')

  const [drawPlan, setDrawPlan] = useState<DrawnTeamItem[]>([])
  const [revealedPlayerCount, setRevealedPlayerCount] = useState(0)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [spotlightText, setSpotlightText] = useState<string | null>(null)
  const [activePhase, setActivePhase] = useState<'TB-' | 'TBY' | 'TBY+'>('TB-')
  const [history, setHistory] = useState<DrawHistory[]>([])
  const [currentDrawId, setCurrentDrawId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const tickTimerRef = useRef<number | null>(null)

  const drawQueue = useMemo(
    () =>
      drawPlan.flatMap((team) => [
        {
          ...team.player1,
          team_order: team.order,
          team_type: team.team_type,
        },
        {
          ...team.player2,
          team_order: team.order,
          team_type: team.team_type,
        },
      ]),
    [drawPlan]
  )

  const loadHistory = async () => {
    if (!tournament) return
    const { data } = await supabase
      .from('draw_history')
      .select('*')
      .eq('tournament_id', tournament.id)
      .eq('draw_type', 'team_draw')
      .order('created_at', { ascending: false })
    const rows = (data || []) as DrawHistory[]
    setHistory(rows)
    const latestDraw = rows[0]
    if (latestDraw && Array.isArray(latestDraw.result_json)) {
      const latest = latestDraw.result_json as DrawnTeamItem[]
      const queue = latest.flatMap((team) => [
        team.player1,
        team.player2,
      ])
      let savedCount = 0
      try {
        const savedProgress = window.localStorage.getItem(
          `team-draw-progress:${tournament.id}:${latestDraw.id}`
        )
        const parsedCount = Number(savedProgress)
        if (Number.isInteger(parsedCount) && parsedCount >= 0) {
          savedCount = Math.min(parsedCount, queue.length)
        }
      } catch {
        toast.error('Không thể đọc tiến độ bốc thăm đã lưu trên trình duyệt.')
      }

      const revealedCount = isConfirmed || latestDraw.confirmed_at
        ? queue.length
        : normalizeTeamDrawRevealCount(latest, savedCount)
      if (revealedCount !== savedCount && !isConfirmed && !latestDraw.confirmed_at) {
        try {
          window.localStorage.setItem(
            `team-draw-progress:${tournament.id}:${latestDraw.id}`,
            String(revealedCount)
          )
        } catch {
          toast.error('Không thể lưu tiến độ bốc thăm trên trình duyệt.')
        }
      }
      setDrawPlan(latest)
      setCurrentDrawId(latestDraw.id)
      setRevealedPlayerCount(revealedCount)
      setSpotlightText(
        revealedCount > 0
          ? `${queue[revealedCount - 1].full_name} (${queue[revealedCount - 1].skill_level})`
          : null
      )
      setActivePhase(
        queue[revealedCount]?.skill_level ??
          queue[revealedCount - 1]?.skill_level ??
          'TB-'
      )
    } else {
      setDrawPlan([])
      setRevealedPlayerCount(0)
      setCurrentDrawId(null)
      setSpotlightText(null)
    }
  }

  useEffect(() => {
    loadHistory()
    return () => {
      if (tickTimerRef.current) window.clearInterval(tickTimerRef.current)
    }
  }, [tournament?.id, isConfirmed])

  if (!tournament) return null

  const revealedPlayers = drawQueue.slice(0, revealedPlayerCount)
  const revealedTeams = drawPlan.slice(0, Math.floor(revealedPlayerCount / 2))
  const revealedPlayerIds = new Set(revealedPlayers.map((player) => player.tournament_player_id))

  const remainingPlayers = players.filter(
    (p) => p.status === 'active' && !revealedPlayerIds.has(p.id)
  )

  const wheelPool = remainingPlayers.filter((p) => p.skill_level === activePhase)
  const displayWheelItems = wheelPool
  const nextDraw = drawQueue[revealedPlayerCount]
  const pendingPlayer = revealedPlayerCount % 2 === 1
    ? drawQueue[revealedPlayerCount - 1]
    : null
  const activePhaseDrawnCount = drawQueue
    .slice(0, revealedPlayerCount)
    .filter((player) => player.skill_level === activePhase).length
  const activePhaseTotalCount = drawQueue
    .filter((player) => player.skill_level === activePhase).length

  const handleGenerateFromDb = async () => {
    setGenerating(true)
    try {
      const { data, error } = await supabase.rpc('generate_team_draw', {
        p_tournament_id: tournament.id,
      })
      if (error) throw extractSupabaseError(error)
      const plan = (data?.teams || []) as DrawnTeamItem[]
      setDrawPlan(plan)
      setCurrentDrawId(data?.draw_id ?? null)
      setRevealedPlayerCount(0)
      setActivePhase(plan[0]?.player1.skill_level ?? 'TB-')
      setSpotlightText(null)
      toast.success('Đã tạo thứ tự bốc thăm. Bắt đầu quay chọn từng vận động viên.')
      await Promise.all([refresh(), loadHistory()])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Không thể thực hiện bốc thăm')
    } finally {
      setGenerating(false)
    }
  }

  const spinNextPlayer = () => {
    if (spinning || !nextDraw) return
    const targetIndex = displayWheelItems.findIndex(
      (player) => player.id === nextDraw.tournament_player_id
    )
    if (targetIndex < 0 || !slices[targetIndex]) {
      toast.error('Không tìm thấy VĐV tiếp theo trong vòng quay. Hãy tải lại trang.')
      return
    }

    setSpinning(true)
    setSpotlightText(`Đang quay chọn ${nextDraw.skill_level}...`)

    if (soundEnabled) {
      let ticks = 0
      tickTimerRef.current = window.setInterval(() => {
        ticks += 1
        playBeep(440 + (ticks % 4) * 60, 40, 0.05)
        if (ticks >= 18 && tickTimerRef.current) {
          window.clearInterval(tickTimerRef.current)
        }
      }, 110)
    }

    const targetRotation = (360 - slices[targetIndex].midAngle) % 360
    setRotation((prev) => {
      const currentRotation = ((prev % 360) + 360) % 360
      const alignment = (targetRotation - currentRotation + 360) % 360
      const extraSpins = (5 + Math.floor(Math.random() * 3)) * 360
      return prev + extraSpins + alignment
    })

    window.setTimeout(() => {
      if (tickTimerRef.current) window.clearInterval(tickTimerRef.current)
      setSpinning(false)
      const nextRevealedCount = revealedPlayerCount + 1
      const normalizedRevealedCount = normalizeTeamDrawRevealCount(
        drawPlan,
        nextRevealedCount
      )
      if (currentDrawId) {
        try {
          window.localStorage.setItem(
            `team-draw-progress:${tournament.id}:${currentDrawId}`,
            String(normalizedRevealedCount)
          )
        } catch {
          toast.error('Không thể lưu tiến độ bốc thăm trên trình duyệt.')
        }
      }
      const autoRevealedTeam = normalizedRevealedCount > nextRevealedCount
        ? drawPlan[nextRevealedCount / 2]
        : null
      setRevealedPlayerCount(normalizedRevealedCount)
      setSpotlightText(
        autoRevealedTeam
          ? `Ghép tự động: ${autoRevealedTeam.player1.full_name} / ${autoRevealedTeam.player2.full_name}`
          : `${nextDraw.full_name} (${nextDraw.skill_level})`
      )
      if (soundEnabled) {
        playBeep(660, 120, 0.1)
        setTimeout(() => playBeep(880, 220, 0.1), 130)
      }
      setActivePhase(
        drawQueue[normalizedRevealedCount]?.skill_level ??
          drawQueue[normalizedRevealedCount - 1]?.skill_level ??
          nextDraw.skill_level
      )
    }, 2200)
  }

  const handleConfirmDraw = async () => {
    setConfirming(true)
    try {
      const { error } = await supabase.rpc('confirm_team_draw', {
        p_tournament_id: tournament.id,
      })
      if (error) throw extractSupabaseError(error)
      toast.success('Đã xác nhận và khóa danh sách 12 đội! Bạn có thể chuyển sang Random chia bảng.')
      setConfirmOpen(false)
      await Promise.all([refresh(), loadHistory()])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Lỗi xác nhận kết quả bốc thăm')
    } finally {
      setConfirming(false)
    }
  }

  // Tạo lát cắt SVG cho Wheel of Names
  const slices = displayWheelItems.map((item, idx) => {
    const count = displayWheelItems.length
    const angle = 360 / count
    const startAngle = idx * angle
    const endAngle = startAngle + angle
    const startRad = ((startAngle - 90) * Math.PI) / 180
    const endRad = ((endAngle - 90) * Math.PI) / 180
    const x1 = 150 + 140 * Math.cos(startRad)
    const y1 = 150 + 140 * Math.sin(startRad)
    const x2 = 150 + 140 * Math.cos(endRad)
    const y2 = 150 + 140 * Math.sin(endRad)
    const largeArc = angle > 180 ? 1 : 0
    const path = `M 150 150 L ${x1} ${y1} A 140 140 0 ${largeArc} 1 ${x2} ${y2} Z`
    const midAngle = startAngle + angle / 2
    const palette = SLICE_COLORS[item.skill_level]
    const color = palette[idx % palette.length]
    return { item, path, midAngle, color }
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950 flex items-center gap-2">
            <Disc3 className="h-6 w-6 text-navy-700" /> Wheel of Names — Quay từng vận động viên
          </h2>
          <p className="text-sm text-slate-600">
            Quay từng vận động viên; TBY+ quay hai lượt để ghép thành một đội. Khi chỉ còn một cặp TB- + TBY, hệ thống tự ghép cặp cuối.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSoundEnabled((s) => !s)}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {soundEnabled ? 'Âm thanh: Bật' : 'Âm thanh: Tắt'}
          </Button>
          {isConfirmed && (
            <Button asChild variant="success" size="sm">
              <Link to={`/tournament/${id}/group-draw`}>
                Sang Random chia bảng <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {!roster.isReadyForDraw && !isConfirmed && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-bold">Chưa đủ điều kiện bốc thăm!</p>
          <p className="mt-1">{roster.errors.join(' • ')}</p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to={`/tournament/${id}/players`}>Quay lại quản lý vận động viên</Link>
          </Button>
        </div>
      )}

      {isConfirmed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-emerald-900">
            <Lock className="h-5 w-5 text-emerald-600 shrink-0" />
            <div className="text-sm">
              <p className="font-bold">Kết quả bốc thăm 12 đội đã được xác nhận và khóa.</p>
              <p className="text-xs text-emerald-700">
                Nếu cần bốc thăm lại, Admin có thể vào Cài đặt → Reset giai đoạn ghép đội.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Wheel Column */}
        <Card className="lg:col-span-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Vòng quay chọn vận động viên</CardTitle>
            <div className="flex gap-1.5">
              <Badge variant="tbMinus">TB-</Badge>
              <Badge variant="tby">TBY</Badge>
              <Badge variant="tbyPlus">TBY+</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {/* Pointer */}
            <div className="relative flex items-center justify-center my-2">
              <div className="absolute -top-3 z-20 h-0 w-0 border-l-[12px] border-r-[12px] border-t-[22px] border-l-transparent border-r-transparent border-t-red-600 drop-shadow" />

              <motion.svg
                viewBox="0 0 300 300"
                className="h-72 w-72 sm:h-80 sm:w-80 drop-shadow-lg"
                animate={{ rotate: rotation }}
                transition={{ duration: 2.1, ease: [0.17, 0.67, 0.12, 0.99] }}
              >
                <circle cx="150" cy="150" r="146" fill="#0f1f3d" />
                {slices.length === 0 ? (
                  <text
                    x="150"
                    y="155"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="13"
                    fontWeight="bold"
                  >
                    Đã quay đủ 24 vận động viên!
                  </text>
                ) : (
                  slices.map((s) => (
                    <g key={s.item.id}>
                      <path d={s.path} fill={s.color} stroke="#ffffff" strokeWidth="1.5" />
                      <text
                        x="150"
                        y="150"
                        fill="#ffffff"
                        fontSize={slices.length > 10 ? '9' : '11'}
                        fontWeight="700"
                        textAnchor="end"
                        transform={`rotate(${s.midAngle - 90}, 150, 150) translate(130, 4)`}
                      >
                        {(s.item.player?.full_name || '').slice(0, 14)}
                      </text>
                    </g>
                  ))
                )}
                <circle cx="150" cy="150" r="24" fill="#ffffff" stroke="#0f1f3d" strokeWidth="4" />
                <text x="150" y="154" textAnchor="middle" fill="#0f1f3d" fontSize="10" fontWeight="800">
                  {revealedPlayerCount}/24
                </text>
              </motion.svg>
            </div>

            {/* Spotlight Result */}
            <AnimatePresence mode="wait">
              {spotlightText && (
                <motion.div
                  key={spotlightText}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-3 w-full rounded-xl bg-navy-900 px-4 py-3 text-center text-white shadow"
                >
                  <p className="text-sm font-bold flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    {spotlightText}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Controls */}
            {isAdmin && !isConfirmed && (
              <div className="mt-5 flex flex-wrap justify-center gap-2.5 w-full">
                {drawPlan.length === 0 ? (
                  <Button
                    size="lg"
                    onClick={handleGenerateFromDb}
                    disabled={!roster.isReadyForDraw || generating}
                    className="w-full sm:w-auto"
                  >
                    <Disc3 className="h-5 w-5" />
                    {generating ? 'Đang tạo phiên bốc thăm...' : 'Khởi tạo phiên bốc thăm (DB)'}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      variant="success"
                      onClick={spinNextPlayer}
                      disabled={spinning || !nextDraw || displayWheelItems.length === 0}
                    >
                      <Disc3 className={spinning ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                      {!nextDraw
                        ? 'Đã quay đủ 24 vận động viên'
                        : `Quay chọn ${nextDraw.skill_level} (${activePhaseDrawnCount + 1}/${activePhaseTotalCount})`}
                    </Button>

                    <Button
                      size="lg"
                      variant="secondary"
                      onClick={handleGenerateFromDb}
                      disabled={spinning || generating}
                    >
                      <RotateCcw className="h-4 w-4" /> Bốc thăm lại
                    </Button>

                    {revealedPlayerCount === drawQueue.length && (
                      <Button
                        size="lg"
                        onClick={() => setConfirmOpen(true)}
                        className="w-full"
                      >
                        <CheckCircle2 className="h-5 w-5" /> Xác nhận & Khóa 12 đội
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Revealed Teams & Remaining Players */}
        <div className="lg:col-span-6 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Danh sách đội đã ghép ({revealedTeams.length} / 12)</CardTitle>
            </CardHeader>
            <CardContent>
              {revealedTeams.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">
                  Chưa ghép đội nào. Mỗi lượt quay chọn đúng một vận động viên.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {revealedTeams.map((t) => (
                    <motion.div
                      key={t.team_id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-navy-800">Đội #{t.order}</span>
                        <Badge variant={t.team_type === 'TB-_TBY' ? 'tbMinus' : 'tbyPlus'}>
                          {t.team_type === 'TB-_TBY' ? 'TB- + TBY' : 'TBY+ + TBY+'}
                        </Badge>
                      </div>
                      <p className="text-sm font-bold text-slate-900">{t.team_name}</p>
                    </motion.div>
                  ))}
                </div>
              )}
              {pendingPlayer && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Đang chờ ghép cặp: <strong>{pendingPlayer.full_name}</strong> ({pendingPlayer.skill_level})
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Danh sách chờ chưa ghép ({remainingPlayers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {remainingPlayers.length === 0 ? (
                <p className="text-sm text-emerald-700 font-medium text-center py-4">
                  Tất cả 24 vận động viên đã được ghép đội!
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {remainingPlayers.map((p) => (
                    <Badge
                      key={p.id}
                      variant={
                        p.skill_level === 'TB-'
                          ? 'tbMinus'
                          : p.skill_level === 'TBY'
                            ? 'tby'
                            : 'tbyPlus'
                      }
                    >
                      {p.player?.full_name} ({p.skill_level})
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Draw History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500" /> Lịch sử bốc thăm ghép đội ({history.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có lịch sử bốc thăm nào.</p>
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
                    <span className="mx-2 text-slate-400">•</span>
                    <span className="text-slate-600">
                      Thực hiện bởi: {h.performer?.full_name || h.performer?.email || 'Admin'}
                    </span>
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
        title="Xác nhận & Khóa kết quả bốc thăm 12 đội?"
        description="Sau khi xác nhận, danh sách 12 đội sẽ bị khóa để chuyển sang bước Random chia 4 bảng. Bạn chỉ có thể bốc thăm lại nếu Reset giai đoạn ghép đội."
        confirmLabel="Xác nhận khóa 12 đội"
        variant="warning"
        loading={confirming}
        onConfirm={handleConfirmDraw}
      />
    </div>
  )
}
