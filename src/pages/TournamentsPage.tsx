import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Trophy,
  Plus,
  Calendar,
  MapPin,
  Globe,
  Lock,
  LogIn,
  LogOut,
  ExternalLink,
  ArrowRight,
} from 'lucide-react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { SupabaseConfigBanner } from '@/components/SupabaseConfigBanner'
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '@/components/StateViews'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateOnly } from '@/lib/utils'
import { TOURNAMENT_STATUS_LABELS, type Tournament } from '@/types/database'

export function TournamentsPage() {
  const navigate = useNavigate()
  const { user, profile, isOnline, signOut } = useAuth()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [rolesMap, setRolesMap] = useState<Record<string, 'admin' | 'referee'>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTournaments = async () => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError(null)
      const { data, error: tErr } = await supabase
        .from('tournaments')
        .select('*')
        .order('created_at', { ascending: false })
      if (tErr) throw tErr
      setTournaments((data || []) as Tournament[])

      if (user) {
        const { data: mData } = await supabase
          .from('tournament_members')
          .select('tournament_id, role')
          .eq('user_id', user.id)
        const map: Record<string, 'admin' | 'referee'> = {}
        for (const row of mData || []) {
          map[row.tournament_id] = row.role
        }
        setRolesMap(map)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi tải danh sách giải đấu')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTournaments()
  }, [user])

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <SupabaseConfigBanner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {!isOnline && <OfflineBanner />}

      <header className="bg-navy-950 text-white border-b border-navy-800">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold">Badminton Tournament Management</h1>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Hệ thống quản lý giải cầu lông nội bộ nhiều mùa giải
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="hidden sm:inline text-xs text-slate-300 mr-2">
                  {profile?.full_name || user.email}
                </span>
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => navigate('/tournaments/new')}
                >
                  <Plus className="h-4 w-4" /> Tạo giải mới
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-slate-300 hover:bg-navy-800 hover:text-white"
                  onClick={async () => {
                    await signOut()
                    navigate('/login')
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => navigate('/login')}>
                <LogIn className="h-4 w-4" /> Đăng nhập BTC / Trọng tài
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-8 flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-extrabold text-navy-950">Danh sách giải đấu</h2>
            <p className="text-sm text-slate-600 mt-1">
              Mỗi mùa giải có dữ liệu độc lập hoàn toàn (vận động viên, bốc thăm, bảng đấu, tỷ số, bracket).
            </p>
          </div>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchTournaments} />
        ) : tournaments.length === 0 ? (
          <EmptyState
            icon={<Trophy className="h-8 w-8" />}
            title="Chưa có giải đấu nào"
            description={
              user
                ? 'Hãy tạo giải đấu cầu lông đầu tiên để bắt đầu quản lý vận động viên, bốc thăm và lịch thi đấu.'
                : 'Hiện chưa có giải đấu nào được Ban tổ chức công khai.'
            }
            action={
              user ? (
                <Button onClick={() => navigate('/tournaments/new')}>
                  <Plus className="h-4 w-4" /> Tạo giải đấu mới
                </Button>
              ) : (
                <Button onClick={() => navigate('/login')}>Đăng nhập quản trị</Button>
              )
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => {
              const role = rolesMap[t.id]
              return (
                <Card key={t.id} className="flex flex-col hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant={t.status === 'completed' ? 'success' : 'default'}>
                        {TOURNAMENT_STATUS_LABELS[t.status]}
                      </Badge>
                      <div className="flex items-center gap-1.5">
                        {role && (
                          <Badge variant={role === 'admin' ? 'success' : 'warning'}>
                            {role === 'admin' ? 'Admin' : 'Trọng tài'}
                          </Badge>
                        )}
                        <Badge variant="outline" className="gap-1">
                          {t.is_public ? (
                            <>
                              <Globe className="h-3 w-3 text-emerald-600" /> Công khai
                            </>
                          ) : (
                            <>
                              <Lock className="h-3 w-3 text-slate-400" /> Nội bộ
                            </>
                          )}
                        </Badge>
                      </div>
                    </div>
                    <CardTitle className="mt-3 text-lg text-navy-950">{t.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-400" />
                        <span>{formatDateOnly(t.event_date)}</span>
                      </div>
                      {t.location && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-slate-400" />
                          <span>{t.location}</span>
                        </div>
                      )}
                      {t.description && (
                        <p className="text-xs text-slate-500 line-clamp-2 pt-1">{t.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      {role ? (
                        <Button asChild className="flex-1" size="sm">
                          <Link
                            to={
                              role === 'referee'
                                ? `/tournament/${t.id}/referee`
                                : `/tournament/${t.id}/dashboard`
                            }
                          >
                            {role === 'referee' ? 'Vào trang Trọng tài' : 'Quản lý giải'}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ) : null}

                      {t.is_public && (
                        <Button asChild variant="outline" size="sm" className={role ? '' : 'flex-1'}>
                          <Link to={`/public/${t.slug}`}>
                            <ExternalLink className="h-3.5 w-3.5" /> Xem trực tiếp
                          </Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
