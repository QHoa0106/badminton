import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

/**
 * Đăng ký Supabase Realtime cho 1 giải đấu và tự động dọn dẹp theo vòng đời React.
 * Đồng bộ: tournaments, matches, match_sets, groups, group_teams, teams, tie_break_events.
 */
export function useTournamentRealtime(
  tournamentId: string | undefined,
  onChange: () => void
) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')

  useEffect(() => {
    if (!tournamentId || !isSupabaseConfigured) {
      setStatus('disconnected')
      return
    }

    const channelName = `tournament-rt-${tournamentId}-${Math.random().toString(36).slice(2, 8)}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_sets' },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'groups', filter: `tournament_id=eq.${tournamentId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_teams' },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teams', filter: `tournament_id=eq.${tournamentId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tie_break_events', filter: `tournament_id=eq.${tournamentId}` },
        onChange
      )
      .subscribe((subStatus) => {
        if (subStatus === 'SUBSCRIBED') setStatus('connected')
        else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'CLOSED' || subStatus === 'TIMED_OUT') {
          setStatus('disconnected')
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tournamentId, onChange])

  return status
}
