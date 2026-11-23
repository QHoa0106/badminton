import { useMemo, useRef, useState } from 'react'
import {
  UserPlus,
  Search,
  Upload,
  Copy,
  Download,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Users,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { validatePlayerRoster } from '@/lib/scoring'
import { downloadFile } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, SelectNative } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/StateViews'
import type { SkillLevel, Tournament, TournamentPlayer } from '@/types/database'

const SKILL_BADGE: Record<SkillLevel, 'tbMinus' | 'tby' | 'tbyPlus'> = {
  'TB-': 'tbMinus',
  TBY: 'tby',
  'TBY+': 'tbyPlus',
}

interface ParsedImportRow {
  full_name: string
  skill_level: string
  note: string
  valid: boolean
  error?: string
}

function getErrMsg(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const value = err as {
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

async function insertTournamentPlayerRow(payload: {
  tournament_id: string
  player_id: string
  skill_level: SkillLevel
  note: string
  status: 'active'
  full_name: string
}) {
  const { full_name, ...base } = payload
  const res1 = await supabase.from('tournament_players').insert(base)
  if (!res1.error) return
  // Tương thích schema cũ có cột full_name NOT NULL trên tournament_players
  if (res1.error.code === '23502' && res1.error.message.includes('full_name')) {
    const res2 = await supabase.from('tournament_players').insert({ ...base, full_name })
    if (res2.error) throw res2.error
    return
  }
  throw res1.error
}

export function PlayersPage() {
  const { tournament, players, teams, myRole, refresh } = useTournamentContext()
  const isAdmin = myRole === 'admin'
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [search, setSearch] = useState('')
  const [filterSkill, setFilterSkill] = useState<string>('ALL')

  // Add / Edit modal
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TournamentPlayer | null>(null)
  const [fullName, setFullName] = useState('')
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('TBY+')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleting, setDeleting] = useState<TournamentPlayer | null>(null)

  // Copy from old tournament modal
  const [copyOpen, setCopyOpen] = useState(false)
  const [otherTournaments, setOtherTournaments] = useState<Tournament[]>([])
  const [sourceTid, setSourceTid] = useState('')
  const [copying, setCopying] = useState(false)

  // Import CSV/Excel preview modal
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ParsedImportRow[]>([])
  const [importing, setImporting] = useState(false)

  const roster = useMemo(() => validatePlayerRoster(players), [players])

  const filtered = useMemo(() => {
    return players.filter((tp) => {
      const matchSkill = filterSkill === 'ALL' || tp.skill_level === filterSkill
      const name = tp.player?.full_name || ''
      const matchSearch =
        !search.trim() ||
        name.toLowerCase().includes(search.toLowerCase()) ||
        (tp.note || '').toLowerCase().includes(search.toLowerCase())
      return matchSkill && matchSearch
    })
  }, [players, search, filterSkill])

  if (!tournament) return null

  const openAdd = () => {
    setEditing(null)
    setFullName('')
    setSkillLevel('TBY+')
    setNote('')
    setFormOpen(true)
  }

  const openEdit = (tp: TournamentPlayer) => {
    setEditing(tp)
    setFullName(tp.player?.full_name || '')
    setSkillLevel(tp.skill_level)
    setNote(tp.note || '')
    setFormOpen(true)
  }

  const handleSavePlayer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim()) {
      toast.error('Vui lòng nhập họ tên vận động viên')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const { error: pErr } = await supabase
          .from('players')
          .update({ full_name: fullName.trim() })
          .eq('id', editing.player_id)
        if (pErr) throw pErr

        const { error: tpErr } = await supabase
          .from('tournament_players')
          .update({ skill_level: skillLevel, note: note.trim() })
          .eq('id', editing.id)
        if (tpErr) throw tpErr
        toast.success('Đã cập nhật thông tin vận động viên')
      } else {
        const { data: newPlayer, error: pErr } = await supabase
          .from('players')
          .insert({ full_name: fullName.trim() })
          .select()
          .single()
        if (pErr) throw pErr

        await insertTournamentPlayerRow({
          tournament_id: tournament.id,
          player_id: newPlayer.id,
          skill_level: skillLevel,
          note: note.trim(),
          status: 'active',
          full_name: fullName.trim(),
        })
        toast.success('Đã thêm vận động viên mới')
      }
      setFormOpen(false)
      await refresh()
    } catch (err: unknown) {
      toast.error(getErrMsg(err, 'Lỗi lưu vận động viên'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    const inTeam = teams.some((t) =>
      (t.members || []).some((m) => m.tournament_player_id === deleting.id)
    )
    if (inTeam) {
      toast.error('Không thể xóa vận động viên đã được ghép vào đội thi đấu')
      setDeleting(null)
      return
    }
    try {
      const { error } = await supabase
        .from('tournament_players')
        .delete()
        .eq('id', deleting.id)
      if (error) throw error
      toast.success('Đã xóa vận động viên khỏi giải đấu')
      setDeleting(null)
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Không thể xóa vận động viên')
    }
  }

  const openCopyModal = async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .neq('id', tournament.id)
      .order('created_at', { ascending: false })
    setOtherTournaments((data || []) as Tournament[])
    setSourceTid(data?.[0]?.id || '')
    setCopyOpen(true)
  }

  const handleCopyPlayers = async () => {
    if (!sourceTid) return
    setCopying(true)
    try {
      const { data, error } = await supabase.rpc('copy_players_from_tournament', {
        p_source_tournament_id: sourceTid,
        p_target_tournament_id: tournament.id,
      })
      if (error) throw error
      toast.success(`Đã sao chép ${data} vận động viên từ giải trước!`)
      setCopyOpen(false)
      await refresh()
    } catch (err: unknown) {
      toast.error(getErrMsg(err, 'Lỗi sao chép vận động viên'))
    } finally {
      setCopying(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

      const parsed: ParsedImportRow[] = json.map((row) => {
        const nameVal = String(
          row['Họ tên'] ?? row['Ho ten'] ?? row['full_name'] ?? row['Tên'] ?? Object.values(row)[0] ?? ''
        ).trim()
        const rawSkill = String(
          row['Trình độ'] ?? row['Trinh do'] ?? row['skill_level'] ?? Object.values(row)[1] ?? ''
        )
          .trim()
          .toUpperCase()
        const noteVal = String(row['Ghi chú'] ?? row['Ghi chu'] ?? row['note'] ?? '').trim()

        const validSkills = ['TB-', 'TBY', 'TBY+']
        const errors: string[] = []
        if (!nameVal) errors.push('Thiếu họ tên')
        if (!validSkills.includes(rawSkill)) errors.push('Trình độ phải là TB-, TBY hoặc TBY+')

        return {
          full_name: nameVal,
          skill_level: rawSkill,
          note: noteVal,
          valid: errors.length === 0,
          error: errors.join('; '),
        }
      })

      setImportRows(parsed)
      setImportOpen(true)
    } catch {
      toast.error('Không thể đọc file Excel/CSV. Vui lòng kiểm tra định dạng file.')
    }
  }

  const handleConfirmImport = async () => {
    const validRows = importRows.filter((r) => r.valid)
    if (validRows.length === 0) {
      toast.error('Không có dòng hợp lệ nào để import')
      return
    }
    setImporting(true)
    try {
      for (const row of validRows) {
        const { data: newP, error: pErr } = await supabase
          .from('players')
          .insert({ full_name: row.full_name })
          .select()
          .single()
        if (pErr) throw pErr

        await insertTournamentPlayerRow({
          tournament_id: tournament.id,
          player_id: newP.id,
          skill_level: row.skill_level as SkillLevel,
          note: row.note,
          status: 'active',
          full_name: row.full_name,
        })
      }
      toast.success(`Đã import thành công ${validRows.length} vận động viên!`)
      setImportOpen(false)
      await refresh()
    } catch (err: unknown) {
      toast.error(getErrMsg(err, 'Lỗi trong quá trình import'))
    } finally {
      setImporting(false)
    }
  }

  const handleExportCsv = () => {
    const header = 'Họ tên,Trình độ,Ghi chú,Trạng thái\n'
    const body = players
      .map(
        (tp) =>
          `"${(tp.player?.full_name || '').replace(/"/g, '""')}","${tp.skill_level}","${(
            tp.note || ''
          ).replace(/"/g, '""')}","${tp.status}"`
      )
      .join('\n')
    downloadFile('\uFEFF' + header + body, `vdv-${tournament.slug}.csv`, 'text/csv;charset=utf-8;')
    toast.success('Đã xuất danh sách vận động viên CSV')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950">Quản lý vận động viên</h2>
          <p className="text-sm text-slate-600">
            Cơ cấu bắt buộc để bốc thăm: 6 TB-, 6 TBY và 12 TBY+ (tổng 24 VĐV).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="h-4 w-4" /> Xuất CSV
          </Button>
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={openCopyModal}>
                <Copy className="h-4 w-4" /> Sao chép từ giải cũ
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" /> Import Excel/CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button size="sm" onClick={openAdd}>
                <UserPlus className="h-4 w-4" /> Thêm VĐV
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Roster Readiness Banner */}
      <div
        className={
          roster.isReadyForDraw
            ? 'rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3'
            : 'rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3'
        }
      >
        {roster.isReadyForDraw ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        )}
        <div className="text-sm">
          <p className={roster.isReadyForDraw ? 'font-bold text-emerald-900' : 'font-bold text-amber-900'}>
            {roster.isReadyForDraw
              ? 'Đủ điều kiện bắt đầu bốc thăm ghép 12 đội!'
              : 'Chưa đủ điều kiện bắt đầu bốc thăm ghép đội'}
          </p>
          {!roster.isReadyForDraw && (
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 space-y-0.5">
              {roster.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Skill Summary Cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-500">Tổng VĐV tham gia</p>
            <p className="mt-1 text-2xl font-extrabold text-navy-950">{roster.total} / 24</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Badge variant="tbMinus">Nhóm TB-</Badge>
            <p className="mt-2 text-2xl font-extrabold text-sky-700">{roster.counts['TB-']} / 6</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Badge variant="tby">Nhóm TBY</Badge>
            <p className="mt-2 text-2xl font-extrabold text-violet-700">{roster.counts.TBY} / 6</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Badge variant="tbyPlus">Nhóm TBY+</Badge>
            <p className="mt-2 text-2xl font-extrabold text-amber-700">{roster.counts['TBY+']} / 12</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Table */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle>Danh sách vận động viên ({filtered.length})</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 sm:w-auto w-full">
            <div className="relative sm:w-64">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Tìm tên hoặc ghi chú..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <SelectNative
              value={filterSkill}
              onChange={(e) => setFilterSkill(e.target.value)}
              className="sm:w-40"
            >
              <option value="ALL">Tất cả trình độ</option>
              <option value="TB-">TB-</option>
              <option value="TBY">TBY</option>
              <option value="TBY+">TBY+</option>
            </SelectNative>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="h-7 w-7" />}
              title="Chưa có vận động viên"
              description="Thêm vận động viên thủ công, import từ Excel/CSV hoặc sao chép từ mùa giải trước."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-3 px-2">#</th>
                    <th className="py-3 px-2">Họ tên</th>
                    <th className="py-3 px-2">Trình độ</th>
                    <th className="py-3 px-2">Ghi chú</th>
                    <th className="py-3 px-2">Trạng thái</th>
                    {isAdmin && <th className="py-3 px-2 text-right">Thao tác</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((tp, idx) => (
                    <tr key={tp.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-2 text-slate-400 font-mono text-xs">{idx + 1}</td>
                      <td className="py-2.5 px-2 font-semibold text-slate-900">
                        {tp.player?.full_name}
                      </td>
                      <td className="py-2.5 px-2">
                        <Badge variant={SKILL_BADGE[tp.skill_level]}>{tp.skill_level}</Badge>
                      </td>
                      <td className="py-2.5 px-2 text-slate-600">{tp.note || '—'}</td>
                      <td className="py-2.5 px-2">
                        <Badge variant={tp.status === 'active' ? 'success' : 'secondary'}>
                          {tp.status === 'active' ? 'Tham gia' : 'Rút lui'}
                        </Badge>
                      </td>
                      {isAdmin && (
                        <td className="py-2.5 px-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(tp)}>
                              <Pencil className="h-4 w-4 text-slate-600" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleting(tp)}>
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Player Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Cập nhật vận động viên' : 'Thêm vận động viên mới'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSavePlayer} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Họ và tên *</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nhập họ tên vận động viên"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Nhóm trình độ *</label>
              <SelectNative
                value={skillLevel}
                onChange={(e) => setSkillLevel(e.target.value as SkillLevel)}
              >
                <option value="TB-">TB- (Cần 6 người)</option>
                <option value="TBY">TBY (Cần 6 người)</option>
                <option value="TBY+">TBY+ (Cần 12 người)</option>
              </SelectNative>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Ghi chú (tùy chọn)</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Phòng ban, tay thuận..."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Đang lưu...' : 'Lưu vận động viên'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Copy Players Dialog */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sao chép vận động viên từ giải trước</DialogTitle>
            <DialogDescription>
              Dữ liệu giải cũ không bị thay đổi. Các VĐV trùng đã có trong giải này sẽ tự động bỏ qua.
            </DialogDescription>
          </DialogHeader>
          {otherTournaments.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có giải đấu nào khác để sao chép.</p>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">Chọn giải đấu nguồn</label>
              <SelectNative value={sourceTid} onChange={(e) => setSourceTid(e.target.value)}>
                {otherTournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectNative>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleCopyPlayers}
              disabled={copying || otherTournaments.length === 0}
            >
              {copying ? 'Đang sao chép...' : 'Sao chép danh sách'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Kiểm tra dữ liệu trước khi Import</DialogTitle>
            <DialogDescription>
              File cần có cột <strong>Họ tên</strong>, <strong>Trình độ</strong> (TB-, TBY, TBY+) và tùy chọn <strong>Ghi chú</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="p-2 text-left">Họ tên</th>
                  <th className="p-2 text-left">Trình độ</th>
                  <th className="p-2 text-left">Ghi chú</th>
                  <th className="p-2 text-left">Kiểm tra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {importRows.map((r, i) => (
                  <tr key={i} className={r.valid ? '' : 'bg-red-50'}>
                    <td className="p-2 font-medium">{r.full_name || '—'}</td>
                    <td className="p-2">{r.skill_level || '—'}</td>
                    <td className="p-2">{r.note || '—'}</td>
                    <td className="p-2">
                      {r.valid ? (
                        <span className="text-emerald-700 font-semibold">Hợp lệ</span>
                      ) : (
                        <span className="text-red-700 font-semibold">{r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleConfirmImport} disabled={importing}>
              {importing
                ? 'Đang import...'
                : `Import ${importRows.filter((r) => r.valid).length} dòng hợp lệ`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Xóa vận động viên?"
        description={`Bạn có chắc muốn xóa "${deleting?.player?.full_name}" khỏi giải đấu này?`}
        confirmLabel="Xóa VĐV"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
