import { useMemo, useState } from 'react'
import {
  CalendarClock,
  Plus,
  Trash2,
  AlertTriangle,
  Sparkles,
  Pencil,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { detectScheduleWarnings } from '@/lib/scoring'
import { formatDateTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, SelectNative } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/StateViews'
import { MATCH_STATUS_LABELS, STAGE_LABELS, type Court, type Match } from '@/types/database'

type ViewMode = 'list' | 'court' | 'date' | 'upcoming' | 'completed'

function getErrorMessage(error: unknown, fallback: string): string {
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

export function SchedulePage() {
  const { tournament, groups, courts, matches, members, myRole, refresh } = useTournamentContext()
  const isAdmin = myRole === 'admin'

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [newCourtName, setNewCourtName] = useState('')
  const [editingCourt, setEditingCourt] = useState<Court | null>(null)
  const [editCourtName, setEditCourtName] = useState('')
  const [generating, setGenerating] = useState(false)
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false)

  // Assign modal
  const [assigningMatch, setAssigningMatch] = useState<Match | null>(null)
  const [selCourtId, setSelCourtId] = useState('')
  const [selDateTime, setSelDateTime] = useState('')
  const [selRefId, setSelRefId] = useState('')
  const [savingAssign, setSavingAssign] = useState(false)

  const warnings = useMemo(
    () => detectScheduleWarnings(matches, courts.filter((c) => c.status === 'active').length),
    [matches, courts]
  )

  const groupsConfirmed = groups.length === 4 && groups.every((g) => g.status === 'confirmed')
  const hasGroupMatches = matches.some((m) => m.stage === 'group')

  if (!tournament) return null

  const handleGenerateGroupMatches = async () => {
    setGenerating(true)
    try {
      const { data, error } = await supabase.rpc('generate_group_matches', {
        p_tournament_id: tournament.id,
      })
      if (error) throw error
      toast.success(`Đã có đủ ${data} trận vòng bảng (3 trận/bảng)!`)
      await refresh()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Không thể sinh lịch vòng bảng'))
    } finally {
      setGenerating(false)
    }
  }

  const handleAddCourt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCourtName.trim()) return
    const { error } = await supabase.from('courts').insert({
      tournament_id: tournament.id,
      court_name: newCourtName.trim(),
      status: 'active',
    })
    if (error) {
      toast.error(error.message)
      return
    }
    setNewCourtName('')
    toast.success('Đã thêm sân thi đấu')
    await refresh()
  }

  const handleUpdateCourt = async () => {
    if (!editingCourt || !editCourtName.trim()) return
    const { error } = await supabase
      .from('courts')
      .update({ court_name: editCourtName.trim() })
      .eq('id', editingCourt.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setEditingCourt(null)
    toast.success('Đã cập nhật tên sân')
    await refresh()
  }

  const handleDeleteCourt = async (court: Court) => {
    const used = matches.some((m) => m.court_id === court.id)
    if (used) {
      toast.error('Không thể xóa sân đã được gán cho trận đấu')
      return
    }
    const { error } = await supabase.from('courts').delete().eq('id', court.id)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(`Đã xóa ${court.court_name}`)
    await refresh()
  }

  const openAssign = (m: Match) => {
    setAssigningMatch(m)
    setSelCourtId(m.court_id || '')
    setSelRefId(m.assigned_referee_id || '')
    if (m.scheduled_at) {
      const d = new Date(m.scheduled_at)
      const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
      setSelDateTime(localIso)
    } else {
      setSelDateTime('')
    }
  }

  const handleSaveAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!assigningMatch) return
    setSavingAssign(true)
    try {
      const { error } = await supabase
        .from('matches')
        .update({
          court_id: selCourtId || null,
          scheduled_at: selDateTime ? new Date(selDateTime).toISOString() : null,
          assigned_referee_id: selRefId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', assigningMatch.id)
      if (error) throw error
      toast.success(`Đã cập nhật lịch trận #${assigningMatch.match_number}`)
      setAssigningMatch(null)
      setAcknowledgedWarnings(false)
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật lịch đấu')
    } finally {
      setSavingAssign(false)
    }
  }

  const displayedMatches = useMemo(() => {
    if (viewMode === 'upcoming') {
      return matches.filter((m) => m.status !== 'completed')
    }
    if (viewMode === 'completed') {
      return matches.filter((m) => m.status === 'completed')
    }
    return matches
  }, [matches, viewMode])

  const matchesByCourt = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const c of courts) map.set(c.id, [])
    map.set('unassigned', [])
    for (const m of matches) {
      const key = m.court_id || 'unassigned'
      const list = map.get(key) || []
      list.push(m)
      map.set(key, list)
    }
    return map
  }, [matches, courts])

  const matchesByDate = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of matches) {
      const key = m.scheduled_at
        ? new Intl.DateTimeFormat('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          }).format(new Date(m.scheduled_at))
        : 'Chưa xếp ngày'
      const list = map.get(key) || []
      list.push(m)
      map.set(key, list)
    }
    return Array.from(map.entries())
  }, [matches])

  const renderMatchRow = (m: Match) => (
    <div
      key={m.id}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5"
    >
      <div className="space-y-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold text-navy-900">#{m.match_number}</span>
          <Badge variant={m.status === 'completed' ? 'success' : m.status === 'in_progress' ? 'live' : 'secondary'}>
            {MATCH_STATUS_LABELS[m.status]}
          </Badge>
          <span className="text-xs font-medium text-slate-600">
            {STAGE_LABELS[m.stage]}
            {m.group ? ` • Bảng ${m.group.group_name}` : ''}
            {m.bracket_slot ? ` (${m.bracket_slot})` : ''}
          </span>
        </div>
        <p className="text-sm font-bold text-slate-900">
          {m.team_a?.team_name || 'Chờ xác định'} <span className="text-slate-400 font-normal">vs</span>{' '}
          {m.team_b?.team_name || 'Chờ xác định'}
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          <span>Sân: <strong className="text-slate-700">{m.court?.court_name || 'Chưa gán'}</strong></span>
          <span>Giờ: <strong className="text-slate-700">{formatDateTime(m.scheduled_at)}</strong></span>
          {m.assigned_referee && (
            <span>Trọng tài điều phối: <strong className="text-slate-700">{m.assigned_referee.full_name}</strong></span>
          )}
        </div>
      </div>

      {isAdmin && (
        <Button variant="outline" size="sm" onClick={() => openAssign(m)}>
          <CalendarClock className="h-4 w-4" /> Xếp lịch / Sân
        </Button>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950">Quản lý sân & Lịch thi đấu</h2>
          <p className="text-sm text-slate-600">
            Cấu hình sân đấu, sinh 12 trận vòng bảng tự động và phân bổ khung giờ thi đấu.
          </p>
        </div>

        {isAdmin && !hasGroupMatches && (
          <Button
            variant="success"
            onClick={handleGenerateGroupMatches}
            disabled={!groupsConfirmed || generating}
          >
            <Sparkles className="h-4 w-4" />
            {generating ? 'Đang sinh lịch...' : 'Sinh 12 trận vòng bảng tự động'}
          </Button>
        )}
      </div>

      {/* Courts Management */}
      <Card>
        <CardHeader>
          <CardTitle>Danh sách sân đấu ({courts.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-navy-900"
              >
                <span>{c.court_name}</span>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => {
                        setEditingCourt(c)
                        setEditCourtName(c.court_name)
                      }}
                      className="text-slate-400 hover:text-navy-800 cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteCourt(c)}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {isAdmin && (
            <form onSubmit={handleAddCourt} className="flex gap-2 max-w-sm">
              <Input
                placeholder="VD: Sân 5"
                value={newCourtName}
                onChange={(e) => setNewCourtName(e.target.value)}
              />
              <Button type="submit" variant="outline">
                <Plus className="h-4 w-4" /> Thêm sân
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Schedule Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-amber-900 text-sm">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Cảnh báo lịch thi đấu ({warnings.length})
            </div>
            {isAdmin && !acknowledgedWarnings && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAcknowledgedWarnings(true)
                  toast.info('Admin đã xác nhận giữ lịch hiện tại dù có cảnh báo.')
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Xác nhận giữ lịch
              </Button>
            )}
            {acknowledgedWarnings && (
              <Badge variant="success">Admin đã xác nhận giữ lịch</Badge>
            )}
          </div>
          <ul className="list-disc pl-5 text-xs text-amber-800 space-y-1">
            {warnings.map((w, idx) => (
              <li key={idx}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['list', 'Theo danh sách'],
            ['court', 'Theo sân'],
            ['date', 'Theo ngày'],
            ['upcoming', 'Sắp diễn ra'],
            ['completed', 'Đã hoàn thành'],
          ] as [ViewMode, string][]
        ).map(([mode, label]) => (
          <Button
            key={mode}
            size="sm"
            variant={viewMode === mode ? 'default' : 'outline'}
            onClick={() => setViewMode(mode)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Matches Display */}
      {matches.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-7 w-7" />}
          title="Chưa có trận đấu nào"
          description="Hãy xác nhận chia 4 bảng và bấm 'Sinh 12 trận vòng bảng tự động'."
        />
      ) : viewMode === 'court' ? (
        <div className="space-y-5">
          {courts.map((c) => {
            const list = matchesByCourt.get(c.id) || []
            return (
              <Card key={c.id}>
                <CardHeader className="pb-3">
                  <CardTitle>
                    {c.court_name} ({list.length} trận)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {list.length === 0 ? (
                    <p className="text-xs text-slate-500">Chưa có trận đấu nào trên sân này.</p>
                  ) : (
                    list.map(renderMatchRow)
                  )}
                </CardContent>
              </Card>
            )
          })}
          {(matchesByCourt.get('unassigned') || []).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Chưa gán sân ({(matchesByCourt.get('unassigned') || []).length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {(matchesByCourt.get('unassigned') || []).map(renderMatchRow)}
              </CardContent>
            </Card>
          )}
        </div>
      ) : viewMode === 'date' ? (
        <div className="space-y-5">
          {matchesByDate.map(([dateLabel, list]) => (
            <Card key={dateLabel}>
              <CardHeader className="pb-3">
                <CardTitle>
                  {dateLabel} ({list.length} trận)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">{list.map(renderMatchRow)}</CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {displayedMatches.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Không có trận nào trong mục này.</p>
          ) : (
            displayedMatches.map(renderMatchRow)
          )}
        </div>
      )}

      {/* Edit Court Dialog */}
      <Dialog open={Boolean(editingCourt)} onOpenChange={(o) => !o && setEditingCourt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đổi tên sân</DialogTitle>
          </DialogHeader>
          <Input value={editCourtName} onChange={(e) => setEditCourtName(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCourt(null)}>
              Hủy
            </Button>
            <Button onClick={handleUpdateCourt}>Lưu tên sân</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Match Dialog */}
      <Dialog open={Boolean(assigningMatch)} onOpenChange={(o) => !o && setAssigningMatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Xếp sân & thời gian — Trận #{assigningMatch?.match_number}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveAssign} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Sân thi đấu</label>
              <SelectNative value={selCourtId} onChange={(e) => setSelCourtId(e.target.value)}>
                <option value="">-- Chưa chọn sân --</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.court_name}
                  </option>
                ))}
              </SelectNative>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Ngày và giờ thi đấu</label>
              <Input
                type="datetime-local"
                value={selDateTime}
                onChange={(e) => setSelDateTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Trọng tài điều phối (tùy chọn — mọi trọng tài đều nhập điểm được)
              </label>
              <SelectNative value={selRefId} onChange={(e) => setSelRefId(e.target.value)}>
                <option value="">-- Không chỉ định --</option>
                {members.map((mem) => (
                  <option key={mem.user_id} value={mem.user_id}>
                    {mem.profile?.full_name || mem.profile?.email} ({mem.role === 'admin' ? 'Admin' : 'Trọng tài'})
                  </option>
                ))}
              </SelectNative>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAssigningMatch(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={savingAssign}>
                {savingAssign ? 'Đang lưu...' : 'Lưu lịch trận'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
