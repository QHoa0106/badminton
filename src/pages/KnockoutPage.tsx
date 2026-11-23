import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { GitBranch, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTournamentContext } from '@/components/layout/TournamentLayout'
import { BracketView } from '@/components/BracketView'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/StateViews'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function KnockoutPage() {
  const { id } = useParams<{ id: string }>()
  const { tournament, matches, myRole, refresh } = useTournamentContext()
  const isAdmin = myRole === 'admin'
  const [syncing, setSyncing] = useState(false)
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false)

  const koMatches = matches.filter((m) =>
    ['quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.stage)
  )

  if (!tournament) return null

  const handleSyncBracket = async (force = false) => {
    setSyncing(true)
    try {
      const { error } = await supabase.rpc('advance_winners', {
        p_tournament_id: tournament.id,
        p_force_overwrite: force,
      })
      if (error) throw error
      toast.success('Đã đồng bộ sơ đồ nhánh đấu từ kết quả thực tế!')
      setForceConfirmOpen(false)
      await refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Lỗi đồng bộ nhánh đấu')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-navy-950 flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-navy-700" /> Sơ đồ vòng loại trực tiếp (Tứ kết → Chung kết)
          </h2>
          <p className="text-sm text-slate-600">
            Tứ kết & Bán kết: BO3 (15đ). Tranh hạng 3 & Chung kết: BO3 (21đ). Tất cả thắng cách biệt 2 điểm, không giới hạn tối đa.
          </p>
        </div>

        {isAdmin && koMatches.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={() => handleSyncBracket(false)}
            >
              <RefreshCw className="h-4 w-4" /> Cập nhật nhánh đấu
            </Button>
            <Button
              variant="warning"
              size="sm"
              disabled={syncing}
              onClick={() => setForceConfirmOpen(true)}
            >
              Đồng bộ lại toàn bộ nhánh
            </Button>
          </div>
        )}
      </div>

      {koMatches.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="h-7 w-7" />}
          title="Chưa khởi tạo vòng Tứ kết"
          description="Hãy hoàn thành 12 trận vòng bảng và xử lý hết các tình huống tie-break, sau đó bấm 'Sinh vòng Tứ kết (8 đội)' tại trang Bảng xếp hạng."
          action={
            <Button asChild>
              <Link to={`/tournament/${id}/standings`}>Đi tới Bảng xếp hạng</Link>
            </Button>
          }
        />
      ) : (
        <BracketView matches={koMatches} tournamentId={id} showScoreLink />
      )}

      <ConfirmDialog
        open={forceConfirmOpen}
        onOpenChange={setForceConfirmOpen}
        title="Cảnh báo cập nhật nhánh đấu có trận phía sau?"
        description="Nếu bạn vừa sửa kết quả trận Tứ kết hoặc Bán kết trong khi vòng sau đã bắt đầu, thao tác này sẽ cập nhật lại cặp đấu vòng sau mà KHÔNG xóa dữ liệu set đã lưu. Bạn hãy kiểm tra kỹ trước khi xác nhận."
        confirmLabel="Xác nhận đồng bộ nhánh"
        variant="warning"
        loading={syncing}
        onConfirm={() => handleSyncBracket(true)}
      />
    </div>
  )
}
