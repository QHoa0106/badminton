export type SkillLevel = 'TB-' | 'TBY' | 'TBY+'
export type TeamType = 'TB-_TBY' | 'TBY+_TBY+'
export type MemberRole = 'admin' | 'referee'
export type TournamentStatus =
  | 'draft'
  | 'team_draw'
  | 'group_draw'
  | 'group_stage'
  | 'knockout'
  | 'completed'
  | 'archived'

export type MatchStage =
  | 'group'
  | 'tie_break'
  | 'quarterfinal'
  | 'semifinal'
  | 'third_place'
  | 'final'

export type MatchStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'pending_tiebreak'
  | 'needs_reconfirmation'

export interface Profile {
  id: string
  full_name: string
  email: string | null
  created_at: string
}

export interface Tournament {
  id: string
  name: string
  slug: string
  event_date: string | null
  location: string
  description: string
  status: TournamentStatus
  is_public: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TournamentMember {
  id: string
  tournament_id: string
  user_id: string
  role: MemberRole
  created_at: string
  profile?: Profile
}

export interface Player {
  id: string
  full_name: string
  created_at: string
}

export interface TournamentPlayer {
  id: string
  tournament_id: string
  player_id: string
  skill_level: SkillLevel
  note: string
  status: 'active' | 'withdrawn'
  created_at: string
  player?: Player
}

export interface TeamMember {
  id: string
  team_id: string
  tournament_player_id: string
  tournament_player?: TournamentPlayer
}

export interface Team {
  id: string
  tournament_id: string
  team_type: TeamType
  team_name: string
  status: 'draft' | 'confirmed'
  created_at: string
  members?: TeamMember[]
}

export interface GroupTeam {
  id: string
  group_id: string
  team_id: string
  manual_rank: number | null
  team?: Team
}

export interface Group {
  id: string
  tournament_id: string
  group_name: 'A' | 'B' | 'C' | 'D'
  distribution_type: '2_mixed_1_plus' | '1_mixed_2_plus' | null
  status: 'draft' | 'confirmed'
  manual_resolution_note: string | null
  manual_resolved_by: string | null
  manual_resolved_at: string | null
  group_teams?: GroupTeam[]
}

export interface Court {
  id: string
  tournament_id: string
  court_name: string
  status: 'active' | 'inactive'
  created_at: string
}

export interface MatchSet {
  id: string
  match_id: string
  set_number: number
  score_a: number
  score_b: number
  status: 'pending' | 'in_progress' | 'completed'
  updated_at: string
}

export interface Match {
  id: string
  tournament_id: string
  group_id: string | null
  tie_break_event_id: string | null
  match_number: number
  stage: MatchStage
  bracket_slot: string | null
  team_a_id: string | null
  team_b_id: string | null
  winner_team_id: string | null
  court_id: string | null
  scheduled_at: string | null
  assigned_referee_id: string | null
  target_points: number
  best_of: number
  win_by: number
  status: MatchStatus
  created_at: string
  updated_at: string
  team_a?: Team | null
  team_b?: Team | null
  court?: Court | null
  group?: Group | null
  assigned_referee?: Profile | null
  sets?: MatchSet[]
}

export interface TieBreakEvent {
  id: string
  tournament_id: string
  group_id: string
  event_type: 'two_team' | 'three_team_round_robin' | 'decider' | 'admin_decision'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  reason: string
  resolved_by: string | null
  created_at: string
  completed_at: string | null
}

export interface DrawHistory {
  id: string
  tournament_id: string
  draw_type: 'team_draw' | 'group_draw'
  result_json: unknown
  performed_by: string | null
  created_at: string
  confirmed_at: string | null
  performer?: Profile | null
}

export interface MatchScoreAudit {
  id: string
  match_id: string
  match_set_id: string | null
  old_score_a: number | null
  old_score_b: number | null
  new_score_a: number | null
  new_score_b: number | null
  action: string
  user_id: string | null
  created_at: string
  user?: Profile | null
}

export interface ActivityLog {
  id: string
  tournament_id: string
  user_id: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
  user?: Profile | null
}

export interface TournamentSettings {
  id: string
  tournament_id: string
  settings_json: {
    group_target_points: number
    tiebreak_target_points: number
    qf_sf_target_points: number
    final_third_target_points: number
    win_by: number
    default_courts: number
  }
  updated_at: string
}

export interface StandingRow {
  team_id: string
  team_name: string
  team_type: TeamType
  played: number
  won: number
  lost: number
  points_for: number
  points_against: number
  point_diff: number
  manual_rank: number | null
  rank: number
  is_tied: boolean
}

export const STAGE_LABELS: Record<MatchStage, string> = {
  group: 'Vòng bảng',
  tie_break: 'Tie-break',
  quarterfinal: 'Tứ kết',
  semifinal: 'Bán kết',
  third_place: 'Tranh hạng 3',
  final: 'Chung kết',
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: 'Chưa diễn ra',
  in_progress: 'Đang diễn ra',
  completed: 'Đã hoàn thành',
  pending_tiebreak: 'Chờ tie-break',
  needs_reconfirmation: 'Cần xác nhận lại',
}

export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Chuẩn bị',
  team_draw: 'Bốc thăm ghép đội',
  group_draw: 'Chia bảng',
  group_stage: 'Vòng bảng',
  knockout: 'Vòng loại trực tiếp',
  completed: 'Đã kết thúc',
  archived: 'Đã lưu trữ',
}
