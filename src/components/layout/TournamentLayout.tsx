import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Disc3,
  Shield,
  Shuffle,
  Grid2x2,
  CalendarClock,
  Swords,
  ClipboardCheck,
  Trophy,
  GitBranch,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  Radio,
  ExternalLink,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTournamentData, type TournamentBundle } from '@/hooks/useTournamentData'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SupabaseConfigBanner } from '@/components/SupabaseConfigBanner'
import { ErrorState, LoadingState, OfflineBanner } from '@/components/StateViews'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TOURNAMENT_STATUS_LABELS } from '@/types/database'

export function useTournamentContext() {
  return useOutletContext<TournamentBundle>()
}

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { to: 'players', label: 'Vận động viên', icon: Users },
  { to: 'team-draw', label: 'Bốc thăm ghép đội', icon: Disc3, adminOnly: true },
  { to: 'teams', label: 'Danh sách đội', icon: Shield },
  { to: 'group-draw', label: 'Random chia bảng', icon: Shuffle, adminOnly: true },
  { to: 'groups', label: '4 Bảng đấu', icon: Grid2x2 },
  { to: 'schedule', label: 'Lịch & Sân đấu', icon: CalendarClock },
  { to: 'matches', label: 'Danh sách trận', icon: Swords },
  { to: 'referee', label: 'Trọng tài nhập điểm', icon: ClipboardCheck },
  { to: 'standings', label: 'Bảng xếp hạng', icon: Trophy },
  { to: 'knockout', label: 'Sơ đồ loại trực tiếp', icon: GitBranch },
  { to: 'settings', label: 'Cài đặt & Sao lưu', icon: Settings, adminOnly: true },
]

export function TournamentLayout() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile, isOnline, signOut } = useAuth()
  const bundle = useTournamentData(id)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  if (!isSupabaseConfigured) {
    return <SupabaseConfigBanner />
  }

  const isAdmin = bundle.myRole === 'admin'
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const renderNavLinks = (onClick?: () => void) => (
    <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
      {visibleItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={`/tournament/${id}/${item.to}`}
            onClick={onClick}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-navy-800 text-white shadow-xs'
                  : 'text-slate-300 hover:bg-navy-800/60 hover:text-white'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {!isOnline && <OfflineBanner />}

      <div className="flex flex-1">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-navy-950 text-white">
          <div className="flex h-16 items-center justify-between px-4 border-b border-navy-800">
            <Link to="/tournaments" className="flex items-center gap-2 text-sm font-bold text-white hover:text-emerald-300">
              <ChevronLeft className="h-4 w-4" />
              <span>Danh sách giải đấu</span>
            </Link>
          </div>
          {bundle.tournament && (
            <div className="px-4 py-3 border-b border-navy-800/80 bg-navy-900/60">
              <p className="text-xs uppercase tracking-wider text-slate-400">Giải đang quản lý</p>
              <p className="mt-0.5 text-sm font-bold text-white line-clamp-2">
                {bundle.tournament.name}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant={isAdmin ? 'success' : 'warning'}>
                  {isAdmin ? 'Admin BTC' : bundle.myRole === 'referee' ? 'Trọng tài' : 'Khách'}
                </Badge>
                <Badge variant="outline" className="border-navy-700 bg-navy-900 text-slate-200">
                  {TOURNAMENT_STATUS_LABELS[bundle.tournament.status]}
                </Badge>
              </div>
            </div>
          )}
          {renderNavLinks()}
          <div className="border-t border-navy-800 p-3">
            <div className="mb-2 px-2">
              <p className="text-xs font-semibold text-white truncate">
                {profile?.full_name || user?.email || 'Tài khoản'}
              </p>
              <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-slate-300 hover:bg-navy-800 hover:text-white"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              Đăng xuất
            </Button>
          </div>
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-950/60"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative flex w-72 max-w-[85vw] flex-col bg-navy-950 text-white z-10">
              <div className="flex h-16 items-center justify-between px-4 border-b border-navy-800">
                <span className="font-bold text-sm">Menu giải đấu</span>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg p-1.5 text-slate-300 hover:bg-navy-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {renderNavLinks(() => setMobileMenuOpen(false))}
              <div className="border-t border-navy-800 p-3 space-y-2">
                <Link
                  to="/tournaments"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 hover:bg-navy-800"
                >
                  <ChevronLeft className="h-4 w-4" /> Danh sách giải đấu
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-slate-300 hover:bg-navy-800 hover:text-white"
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4" /> Đăng xuất
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
                aria-label="Mở menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-bold text-navy-950 truncate">
                  {bundle.tournament?.name || 'Quản lý giải cầu lông'}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                  bundle.realtimeStatus === 'connected'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600'
                )}
                title="Trạng thái đồng bộ Supabase Realtime"
              >
                <Radio
                  className={cn(
                    'h-3.5 w-3.5',
                    bundle.realtimeStatus === 'connected' && 'animate-pulse text-emerald-600'
                  )}
                />
                <span className="hidden sm:inline">
                  {bundle.realtimeStatus === 'connected' ? 'Realtime' : 'Đang kết nối'}
                </span>
              </span>

              {bundle.tournament?.is_public && (
                <Link
                  to={`/public/${bundle.tournament.slug}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-navy-800 hover:bg-slate-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Trang Người xem</span>
                </Link>
              )}
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
            {bundle.loading ? (
              <LoadingState />
            ) : bundle.error ? (
              <ErrorState message={bundle.error} onRetry={bundle.refresh} />
            ) : (
              <Outlet context={bundle} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
