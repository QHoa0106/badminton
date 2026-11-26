import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useTournamentRealtime } from '@/hooks/useTournamentRealtime'
import type {
  Court,
  Group,
  GroupTeam,
  Match,
  MatchSet,
  MemberRole,
  Player,
  Profile,
  Team,
  TeamMember,
  TieBreakEvent,
  Tournament,
  TournamentMember,
  TournamentPlayer,
} from '@/types/database'

export interface TournamentBundle {
  tournament: Tournament | null
  myRole: MemberRole | null
  members: TournamentMember[]
  players: TournamentPlayer[]
  teams: Team[]
  groups: Group[]
  courts: Court[]
  matches: Match[]
  tieBreakEvents: TieBreakEvent[]
  loading: boolean
  error: string | null
  realtimeStatus: 'connecting' | 'connected' | 'disconnected'
  refresh: () => Promise<void>
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  return 'Lỗi kết nối cơ sở dữ liệu Supabase'
}

export function useTournamentData(tournamentId?: string, publicSlug?: string): TournamentBundle {
  const { user } = useAuth()
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [myRole, setMyRole] = useState<MemberRole | null>(null)
  const [members, setMembers] = useState<TournamentMember[]>([])
  const [players, setPlayers] = useState<TournamentPlayer[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [tieBreakEvents, setTieBreakEvents] = useState<TieBreakEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const resolvedId = tournamentId || tournament?.id

  const fetchAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError('Chưa cấu hình kết nối Supabase (.env).')
      setLoading(false)
      return
    }
    if (!tournamentId && !publicSlug) {
      setLoading(false)
      return
    }

    try {
      setError(null)
      let tQuery = supabase.from('tournaments').select('*')
      if (tournamentId) tQuery = tQuery.eq('id', tournamentId)
      else if (publicSlug) tQuery = tQuery.eq('slug', publicSlug).eq('is_public', true)

      const { data: tData, error: tErr } = await tQuery.maybeSingle()
      if (tErr) throw tErr
      if (!tData) {
        setTournament(null)
        setError(
          publicSlug
            ? 'Không tìm thấy giải đấu công khai này hoặc giải đấu chưa được Ban tổ chức công bố.'
            : 'Không tìm thấy giải đấu hoặc bạn không có quyền truy cập.'
        )
        setLoading(false)
        return
      }

      const tid = tData.id as string
      setTournament(tData as Tournament)

      // Query phẳng từng bảng để không phụ thuộc tên FK constraint cũ/mới trong PostgREST schema cache
      const [
        tpRes,
        teamsRes,
        groupsRes,
        courtsRes,
        matchesRes,
        tbRes,
        membersRes,
        profilesRes,
      ] = await Promise.all([
        supabase
          .from('tournament_players')
          .select('*')
          .eq('tournament_id', tid)
          .order('created_at', { ascending: true }),
        supabase
          .from('teams')
          .select('*')
          .eq('tournament_id', tid)
          .order('created_at', { ascending: true }),
        supabase
          .from('groups')
          .select('*')
          .eq('tournament_id', tid)
          .order('group_name', { ascending: true }),
        supabase
          .from('courts')
          .select('*')
          .eq('tournament_id', tid)
          .order('court_name', { ascending: true }),
        supabase
          .from('matches')
          .select('*')
          .eq('tournament_id', tid)
          .order('match_number', { ascending: true }),
        supabase
          .from('tie_break_events')
          .select('*')
          .eq('tournament_id', tid)
          .order('created_at', { ascending: true }),
        user
          ? supabase.from('tournament_members').select('*').eq('tournament_id', tid)
          : Promise.resolve({ data: [], error: null }),
        user
          ? supabase.from('profiles').select('*')
          : Promise.resolve({ data: [], error: null }),
      ])

      if (tpRes.error) throw tpRes.error
      if (teamsRes.error) throw teamsRes.error
      if (groupsRes.error) throw groupsRes.error
      if (courtsRes.error) throw courtsRes.error
      if (matchesRes.error) throw matchesRes.error
      if (tbRes.error) throw tbRes.error
      if (membersRes.error) throw membersRes.error

      const rawTp = (tpRes.data || []) as TournamentPlayer[]
      const rawTeams = (teamsRes.data || []) as Team[]
      const rawGroups = (groupsRes.data || []) as Group[]
      const rawCourts = (courtsRes.data || []) as Court[]
      const rawMatches = (matchesRes.data || []) as Match[]
      const rawMembers = (membersRes.data || []) as TournamentMember[]
      const rawProfiles = (profilesRes.data || []) as Profile[]

      const playerIds = rawTp.map((tp) => tp.player_id)
      const teamIds = rawTeams.map((t) => t.id)
      const groupIds = rawGroups.map((g) => g.id)
      const matchIds = rawMatches.map((m) => m.id)

      const [playersRes, teamMembersRes, groupTeamsRes, matchSetsRes] = await Promise.all([
        playerIds.length > 0
          ? supabase.from('players').select('*').in('id', playerIds)
          : Promise.resolve({ data: [], error: null }),
        teamIds.length > 0
          ? supabase.from('team_members').select('*').in('team_id', teamIds)
          : Promise.resolve({ data: [], error: null }),
        groupIds.length > 0
          ? supabase
              .from('group_teams')
              .select('*')
              .in('group_id', groupIds)
              .order('display_order', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        matchIds.length > 0
          ? supabase.from('match_sets').select('*').in('match_id', matchIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (playersRes.error) throw playersRes.error
      if (teamMembersRes.error) throw teamMembersRes.error
      if (groupTeamsRes.error) throw groupTeamsRes.error
      if (matchSetsRes.error) throw matchSetsRes.error

      // Map lookups
      const playerMap = new Map<string, Player>()
      for (const p of (playersRes.data || []) as Player[]) playerMap.set(p.id, p)

      const profileMap = new Map<string, Profile>()
      for (const pf of rawProfiles) profileMap.set(pf.id, pf)

      const hydratedPlayers: TournamentPlayer[] = rawTp.map((tp) => ({
        ...tp,
        player: playerMap.get(tp.player_id),
      }))
      const tpMap = new Map<string, TournamentPlayer>()
      for (const tp of hydratedPlayers) tpMap.set(tp.id, tp)

      const membersByTeam = new Map<string, TeamMember[]>()
      for (const tm of (teamMembersRes.data || []) as TeamMember[]) {
        const list = membersByTeam.get(tm.team_id) || []
        list.push({ ...tm, tournament_player: tpMap.get(tm.tournament_player_id) })
        membersByTeam.set(tm.team_id, list)
      }

      const hydratedTeams: Team[] = rawTeams.map((t) => ({
        ...t,
        members: membersByTeam.get(t.id) || [],
      }))
      const teamMap = new Map<string, Team>()
      for (const t of hydratedTeams) teamMap.set(t.id, t)

      const gtByGroup = new Map<string, GroupTeam[]>()
      for (const gt of (groupTeamsRes.data || []) as GroupTeam[]) {
        const list = gtByGroup.get(gt.group_id) || []
        list.push({ ...gt, team: teamMap.get(gt.team_id) })
        gtByGroup.set(gt.group_id, list)
      }

      const hydratedGroups: Group[] = rawGroups.map((g) => ({
        ...g,
        group_teams: gtByGroup.get(g.id) || [],
      }))
      const groupMap = new Map<string, Group>()
      for (const g of hydratedGroups) groupMap.set(g.id, g)

      const courtMap = new Map<string, Court>()
      for (const c of rawCourts) courtMap.set(c.id, c)

      const setsByMatch = new Map<string, MatchSet[]>()
      for (const ms of (matchSetsRes.data || []) as MatchSet[]) {
        const list = setsByMatch.get(ms.match_id) || []
        list.push(ms)
        setsByMatch.set(ms.match_id, list)
      }

      const hydratedMatches: Match[] = rawMatches.map((m) => ({
        ...m,
        team_a: m.team_a_id ? teamMap.get(m.team_a_id) || null : null,
        team_b: m.team_b_id ? teamMap.get(m.team_b_id) || null : null,
        court: m.court_id ? courtMap.get(m.court_id) || null : null,
        group: m.group_id ? groupMap.get(m.group_id) || null : null,
        assigned_referee: m.assigned_referee_id ? profileMap.get(m.assigned_referee_id) || null : null,
        sets: (setsByMatch.get(m.id) || []).sort((a, b) => a.set_number - b.set_number),
      }))

      const hydratedMembers: TournamentMember[] = rawMembers.map((mem) => ({
        ...mem,
        profile: profileMap.get(mem.user_id),
      }))

      setPlayers(hydratedPlayers)
      setTeams(hydratedTeams)
      setGroups(hydratedGroups)
      setCourts(rawCourts)
      setMatches(hydratedMatches)
      setTieBreakEvents((tbRes.data || []) as TieBreakEvent[])
      setMembers(hydratedMembers)

      if (user) {
        const mine = hydratedMembers.find((m) => m.user_id === user.id)
        setMyRole(mine?.role ?? null)
      } else {
        setMyRole(null)
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [tournamentId, publicSlug, user])

  useEffect(() => {
    setLoading(true)
    fetchAll()
  }, [fetchAll])

  const realtimeStatus = useTournamentRealtime(resolvedId, fetchAll)

  return {
    tournament,
    myRole,
    members,
    players,
    teams,
    groups,
    courts,
    matches,
    tieBreakEvents,
    loading,
    error,
    realtimeStatus,
    refresh: fetchAll,
  }
}
