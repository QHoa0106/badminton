import { Grid2x2 } from 'lucide-react'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/StateViews'

export function GroupsPage() {
  const { groups } = useTournamentContext()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-navy-950">Danh sách 4 bảng đấu</h2>
        <p className="text-sm text-slate-600">
          Mỗi bảng gồm 3 đội thi đấu vòng tròn 1 lượt (3 trận/bảng, 1 set 30 điểm cách biệt 2).
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Grid2x2 className="h-7 w-7" />}
          title="Chưa có bảng đấu"
          description="Hãy hoàn thành bước Random chia bảng để phân bổ 12 đội vào 4 bảng A, B, C, D."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id} className="border-t-4 border-t-navy-900">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-lg">Bảng {g.group_name}</CardTitle>
                <Badge variant={g.status === 'confirmed' ? 'success' : 'secondary'}>
                  {g.status === 'confirmed' ? 'Đã xác nhận' : 'Nháp'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {(g.group_teams || []).map((gt, idx) => (
                  <div
                    key={gt.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-navy-950 text-sm">
                        {g.group_name}
                        {idx + 1}. {gt.team?.team_name}
                      </span>
                      <Badge variant={gt.team?.team_type === 'TB-_TBY' ? 'tbMinus' : 'tbyPlus'}>
                        {gt.team?.team_type === 'TB-_TBY' ? 'TB- + TBY' : 'TBY+ + TBY+'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(gt.team?.members || []).map((m) => (
                        <span
                          key={m.id}
                          className="rounded bg-white border border-slate-200 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {m.tournament_player?.player?.full_name} ({m.tournament_player?.skill_level})
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
