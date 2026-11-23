import { useEffect, useState } from 'react'
import {
  Settings,
  UserPlus,
  Trash2,
  Download,
  RotateCcw,
  Globe,
  History,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { downloadFile, formatDateTime } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, SelectNative, Textarea } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { ActivityLog, MemberRole, TournamentStatus } from '@/types/database'

const RESET_OPTIONS = [
  {
    key: 'knockout',
    label: 'Reset vòng loại trực tiếp',
    desc: 'Xóa toàn bộ trận Tứ kết, Bán kết, Tranh hạng 3 và Chung kết. Giữ nguyên kết quả vòng bảng.',
  },
  {
    key: 'group_matches',
    label: 'Reset toàn bộ trận vòng bảng & tie-break',
    desc: 'Xóa toàn bộ trận đấu và tỷ số (vòng bảng, tie-break, knockout). Giữ nguyên 4 bảng và 12 đội.',
  },
  {
    key: 'group_draw',
    label: 'Reset kết quả chia 4 bảng',
    desc: 'Xóa 4 bảng đấu cùng toàn bộ trận đấu phụ thuộc. Giữ nguyên 12 đội đã ghép.',
  },
  {
    key: 'team_draw',
    label: 'Reset bốc thăm ghép 12 đội',
    desc: 'Xóa 12 đội, 4 bảng và toàn bộ trận đấu. Giữ nguyên danh sách vận động viên.',
  },
] as const

export function SettingsPage() {
  const { tournament, members, players, teams, groups, matches, courts, myRole, refresh } =
    useTournamentContext()
  const isAdmin = myRole === 'admin'

  const [name, setName] = useState(tournament?.name || '')
  const [location, setLocation] = useState(tournament?.location || '')
  const [description, setDescription] = useState(tournament?.description || '')
  const [status, setStatus] = useState<TournamentStatus>(tournament?.status || 'draft')
  const [isPublic, setIsPublic] = useState(Boolean(tournament?.is_public))
  const [savingInfo, setSavingInfo] = useState(false)

  // Add member
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<MemberRole>('referee')
  const [addingMember, setAddingMember] = useState(false)

  // Reset stage
  const [resetTarget, setResetTarget] = useState<(typeof RESET_OPTIONS)[number] | null>(null)
  const [resetting, setResetting] = useState(false)

  // Activity logs
  const [logs, setLogs] = useState<ActivityLog[]>([])

  useEffect(() => {
    if (!tournament) return
    setName(tournament.name)
    setLocation(tournament.location || '')
    setDescription(tournament.description || '')
    setStatus(tournament.status)
    setIsPublic(tournament.is_public)

    supabase
      .from('tournament_activity_logs')
      .select('*')
      .eq('tournament_id', tournament.id)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setLogs((data || []) as ActivityLog[]))
  }, [tournament?.id, tournament?.updated_at])

  if (!tournament) return null
  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Chỉ tài khoản <strong>Admin</strong> mới có quyền truy cập trang Cài đặt & Sao lưu giải đấu.
      </div>
    )
  }

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingInfo(true)
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({
          name: name.trim(),
          location: location.trim(),
          description: description.trim(),
          status,
          is_public: isPublic,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tournament.id)
      if (error) throw error
      toast.success('Đã lưu thiết lập giải đấu')
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật giải đấu')
    } finally {
      setSavingInfo(false)
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!memberEmail.trim()) return
    setAddingMember(true)
    try {
      const { error } = await supabase.rpc('add_tournament_member_by_email', {
        p_tournament_id: tournament.id,
        p_email: memberEmail.trim(),
        p_role: memberRole,
      })
      if (error) throw error
      toast.success(`Đã thêm ${memberEmail.trim()} với vai trò ${memberRole === 'admin' ? 'Admin' : 'Trọng tài'}`)
      setMemberEmail('')
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Không thể thêm tài khoản')
    } finally {
      setAddingMember(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    const { error } = await supabase.from('tournament_members').delete().eq('id', memberId)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Đã gỡ tài khoản khỏi giải đấu')
    await refresh()
  }

  const handleResetStage = async () => {
    if (!resetTarget) return
    setResetting(true)
    try {
      const { error } = await supabase.rpc('reset_tournament_stage', {
        p_tournament_id: tournament.id,
        p_stage: resetTarget.key,
      })
      if (error) throw error
      toast.success(`Đã thực hiện: ${resetTarget.label}`)
      setResetTarget(null)
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Lỗi reset giai đoạn')
    } finally {
      setResetting(false)
    }
  }

  const handleExportJson = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      tournament,
      courts,
      players,
      teams,
      groups,
      matches,
    }
    downloadFile(
      JSON.stringify(payload, null, 2),
      `backup-${tournament.slug}.json`,
      'application/json;charset=utf-8;'
    )
    toast.success('Đã xuất file sao lưu JSON toàn bộ giải đấu')
  }

  const handleExportResultsCsv = () => {
    const header = 'Mã trận,Giai đoạn,Bảng,Đội A,Đội B,Tỷ số từng set,Đội thắng,Trạng thái\n'
    const body = matches
      .map((m) => {
        const setsStr = (m.sets || []).map((s) => `${s.score_a}-${s.score_b}`).join(' | ')
        const winnerName =
          m.winner_team_id === m.team_a_id
            ? m.team_a?.team_name || ''
            : m.winner_team_id === m.team_b_id
              ? m.team_b?.team_name || ''
              : ''
        return `${m.match_number},"${m.stage}","${m.group?.group_name || ''}","${
          m.team_a?.team_name || ''
        }","${m.team_b?.team_name || ''}","${setsStr}","${winnerName}","${m.status}"`
      })
      .join('\n')
    downloadFile('\uFEFF' + header + body, `ket-qua-${tournament.slug}.csv`, 'text/csv;charset=utf-8;')
    toast.success('Đã xuất kết quả thi đấu CSV')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-navy-950 flex items-center gap-2">
          <Settings className="h-6 w-6 text-navy-700" /> Cài đặt, Phân quyền & Sao lưu
        </h2>
        <p className="text-sm text-slate-600">
          Quản lý công khai giải đấu, tài khoản Trọng tài, xuất sao lưu JSON/CSV và Reset vòng đấu.
        </p>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin & Trạng thái giải đấu</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Tên giải đấu</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Trạng thái giải</label>
                <SelectNative
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TournamentStatus)}
                >
                  <option value="draft">Chuẩn bị</option>
                  <option value="team_draw">Bốc thăm ghép đội</option>
                  <option value="group_draw">Chia bảng</option>
                  <option value="group_stage">Vòng bảng</option>
                  <option value="knockout">Vòng loại trực tiếp</option>
                  <option value="completed">Đã kết thúc</option>
                  <option value="archived">Đã lưu trữ</option>
                </SelectNative>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Địa điểm</label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Mô tả</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 text-emerald-600 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    Công khai giải đấu cho Người xem (Spectator)
                  </p>
                  <p className="text-xs text-slate-500">
                    Khi bật, mọi người có thể xem tỷ số Realtime tại{' '}
                    <code className="font-mono">/public/{tournament.slug}</code> mà không cần đăng nhập.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="h-5 w-5 accent-emerald-600 cursor-pointer"
              />
            </div>

            <Button type="submit" disabled={savingInfo}>
              <Save className="h-4 w-4" /> {savingInfo ? 'Đang lưu...' : 'Lưu thiết lập'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Members (Admin / Referee) */}
      <Card>
        <CardHeader>
          <CardTitle>Quản lý tài khoản Admin & Trọng tài ({members.length})</CardTitle>
          <CardDescription>
            Tài khoản cần được tạo trước trong Supabase Authentication Dashboard. Tất cả Trọng tài đều được quyền nhập điểm cho mọi trận trong giải.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleAddMember} className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              placeholder="Email tài khoản trọng tài / admin..."
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              className="flex-1"
              required
            />
            <SelectNative
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as MemberRole)}
              className="sm:w-40"
            >
              <option value="referee">Trọng tài</option>
              <option value="admin">Admin BTC</option>
            </SelectNative>
            <Button type="submit" disabled={addingMember}>
              <UserPlus className="h-4 w-4" /> Thêm vào giải
            </Button>
          </form>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">
                    {m.profile?.full_name || 'Chưa đặt tên'}
                  </p>
                  <p className="text-xs text-slate-500">{m.profile?.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={m.role === 'admin' ? 'success' : 'warning'}>
                    {m.role === 'admin' ? 'Admin' : 'Trọng tài'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveMember(m.id)}
                    title="Gỡ khỏi giải"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Backup & Export */}
      <Card>
        <CardHeader>
          <CardTitle>Sao lưu & Xuất dữ liệu</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={handleExportJson}>
            <Download className="h-4 w-4" /> Xuất toàn bộ giải đấu (JSON)
          </Button>
          <Button variant="outline" onClick={handleExportResultsCsv}>
            <Download className="h-4 w-4" /> Xuất kết quả các trận (CSV)
          </Button>
        </CardContent>
      </Card>

      {/* Reset Stages */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-700 flex items-center gap-2">
            <RotateCcw className="h-4 w-4" /> Reset giai đoạn giải đấu
          </CardTitle>
          <CardDescription>
            Thao tác Reset sẽ xóa các dữ liệu phụ thuộc của giai đoạn đó và không thể hoàn tác. Hãy xuất sao lưu JSON trước khi thực hiện.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {RESET_OPTIONS.map((opt) => (
            <div
              key={opt.key}
              className="rounded-xl border border-red-200 bg-red-50/40 p-3.5 flex flex-col justify-between gap-3"
            >
              <div>
                <p className="text-sm font-bold text-red-900">{opt.label}</p>
                <p className="text-xs text-red-700 mt-1">{opt.desc}</p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="self-start"
                onClick={() => setResetTarget(opt)}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Thực hiện Reset
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Activity Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500" /> Nhật ký thao tác gần đây ({logs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có nhật ký hoạt động.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {logs.map((l) => (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-bold text-navy-900">{l.action}</span>
                    <span className="mx-1.5 text-slate-400">•</span>
                    <span className="text-slate-600">
                      {l.user?.full_name || l.user?.email || 'Hệ thống'}
                    </span>
                  </div>
                  <span className="text-slate-400">{formatDateTime(l.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(o) => !o && setResetTarget(null)}
        title={`Xác nhận: ${resetTarget?.label}?`}
        description={`${resetTarget?.desc}\n\nHành động này không thể hoàn tác!`}
        confirmLabel="Xác nhận Reset"
        variant="destructive"
        loading={resetting}
        onConfirm={handleResetStage}
      />
    </div>
  )
}
