import { useState } from 'react'
import { Shield, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/StateViews'
import type { Team } from '@/types/database'

export function TeamsPage() {
  const { teams, myRole, refresh } = useTournamentContext()
  const isAdmin = myRole === 'admin'
  const [editing, setEditing] = useState<Team | null>(null)
  const [teamName, setTeamName] = useState('')
  const [saving, setSaving] = useState(false)

  const mixedTeams = teams.filter((t) => t.team_type === 'TB-_TBY')
  const plusTeams = teams.filter((t) => t.team_type === 'TBY+_TBY+')

  const openEdit = (t: Team) => {
    setEditing(t)
    setTeamName(t.team_name)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing || !teamName.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('teams')
        .update({ team_name: teamName.trim() })
        .eq('id', editing.id)
      if (error) throw error
      toast.success('Đã cập nhật tên đội')
      setEditing(null)
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Không thể cập nhật tên đội')
    } finally {
      setSaving(false)
    }
  }

  const renderTeamCard = (t: Team, idx: number) => (
    <Card key={t.id}>
      <CardContent className="p-4 flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
            <Badge variant={t.team_type === 'TB-_TBY' ? 'tbMinus' : 'tbyPlus'}>
              {t.team_type === 'TB-_TBY' ? 'TB- + TBY' : 'TBY+ + TBY+'}
            </Badge>
            <Badge variant={t.status === 'confirmed' ? 'success' : 'secondary'}>
              {t.status === 'confirmed' ? 'Đã khóa' : 'Nháp'}
            </Badge>
          </div>
          <p className="font-bold text-navy-950 truncate">{t.team_name}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(t.members || []).map((m) => (
              <span
                key={m.id}
                className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
              >
                {m.tournament_player?.player?.full_name} ({m.tournament_player?.skill_level})
              </span>
            ))}
          </div>
        </div>
        {isAdmin && (
          <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
            <Pencil className="h-4 w-4 text-slate-600" />
          </Button>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-navy-950">Danh sách 12 đội thi đấu</h2>
        <p className="text-sm text-slate-600">
          Gồm 6 đội nhóm TB- + TBY và 6 đội nhóm TBY+ + TBY+.
        </p>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={<Shield className="h-7 w-7" />}
          title="Chưa có đội nào"
          description="Hãy vào mục Bốc thăm ghép đội (Wheel of Names) để tạo 12 cặp thi đấu."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Nhóm TB- + TBY ({mixedTeams.length} đội)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mixedTeams.map((t, i) => renderTeamCard(t, i))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nhóm TBY+ + TBY+ ({plusTeams.length} đội)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {plusTeams.map((t, i) => renderTeamCard(t, i + 6))}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đổi tên đội</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <Input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Nhập tên đội mới"
              required
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
