import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'
import { TournamentLayout } from '@/components/layout/TournamentLayout'
import { LoadingState } from '@/components/StateViews'
import { LoginPage } from '@/pages/LoginPage'
import { TournamentsPage } from '@/pages/TournamentsPage'
import { NewTournamentPage } from '@/pages/NewTournamentPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { PlayersPage } from '@/pages/PlayersPage'
import { TeamDrawPage } from '@/pages/TeamDrawPage'
import { TeamsPage } from '@/pages/TeamsPage'
import { GroupDrawPage } from '@/pages/GroupDrawPage'
import { GroupsPage } from '@/pages/GroupsPage'
import { SchedulePage } from '@/pages/SchedulePage'
import { MatchesPage } from '@/pages/MatchesPage'
import { RefereePage } from '@/pages/RefereePage'
import { StandingsPage } from '@/pages/StandingsPage'
import { KnockoutPage } from '@/pages/KnockoutPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { PublicTournamentPage } from '@/pages/PublicTournamentPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (!isSupabaseConfigured) return <>{children}</>
  if (loading) return <LoadingState message="Đang kiểm tra phiên đăng nhập..." />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/tournaments" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route
            path="/tournaments/new"
            element={
              <RequireAuth>
                <NewTournamentPage />
              </RequireAuth>
            }
          />
          <Route path="/public/:slug" element={<PublicTournamentPage />} />

          <Route
            path="/tournament/:id"
            element={
              <RequireAuth>
                <TournamentLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="players" element={<PlayersPage />} />
            <Route path="team-draw" element={<TeamDrawPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="group-draw" element={<GroupDrawPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="matches" element={<MatchesPage />} />
            <Route path="referee" element={<RefereePage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="knockout" element={<KnockoutPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/tournaments" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </AuthProvider>
  )
}
