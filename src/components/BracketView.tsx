import { Link } from 'react-router-dom'
import { Trophy, Award, Medal } from 'lucide-react'
import { evaluateMatch } from '@/lib/scoring'
import { Badge } from '@/components/ui/badge'
import { MATCH_STATUS_LABELS, type Match } from '@/types/database'

interface BracketViewProps {
  matches: Match[]
  tournamentId?: string
  showScoreLink?: boolean
}

const SLOT_TITLES: Record<string, string> = {
  QF1: 'Tứ kết 1 (Nhất A vs Nhì B)',
  QF2: 'Tứ kết 2 (Nhất B vs Nhì A)',
  QF3: 'Tứ kết 3 (Nhất C vs Nhì D)',
  QF4: 'Tứ kết 4 (Nhất D vs Nhì C)',
  SF1: 'Bán kết 1 (Thắng TK1 vs Thắng TK3)',
  SF2: 'Bán kết 2 (Thắng TK2 vs Thắng TK4)',
  THIRD: 'Tranh hạng 3 (BO3 • 21đ)',
  FINAL: 'CHUNG KẾT (BO3 • 21đ)',
}

function BracketMatchCard({
  match,
  tournamentId,
  showScoreLink,
  highlight,
}: {
  match?: Match
  tournamentId?: string
  showScoreLink?: boolean
  highlight?: 'gold' | 'bronze'
}) {
  if (!match) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 text-center text-xs text-slate-400">
        Chưa khởi tạo trận
      </div>
    )
  }

  const evalRes = evaluateMatch(match.sets || [], match.target_points, match.best_of, match.win_by)
  const membersA = (match.team_a?.members || [])
    .map((m) => m.tournament_player?.player?.full_name)
    .filter(Boolean)
    .join(' / ')
  const membersB = (match.team_b?.members || [])
    .map((m) => m.tournament_player?.player?.full_name)
    .filter(Boolean)
    .join(' / ')

  const borderClass =
    highlight === 'gold'
      ? 'border-2 border-amber-400 bg-gradient-to-b from-amber-50/60 to-white shadow-md'
      : highlight === 'bronze'
        ? 'border-2 border-orange-300 bg-white'
        : 'border border-slate-200 bg-white shadow-xs'

  return (
    <div className={`rounded-xl overflow-hidden ${borderClass}`}>
      <div className="flex items-center justify-between gap-2 bg-slate-100/90 px-3 py-1.5 border-b border-slate-200">
        <span className="text-[11px] font-bold text-navy-900 truncate">
          #{match.match_number} • {SLOT_TITLES[match.bracket_slot || ''] || match.bracket_slot}
        </span>
        <Badge
          variant={
            match.status === 'completed'
              ? 'success'
              : match.status === 'in_progress'
                ? 'live'
                : 'secondary'
          }
          className="text-[10px] px-2 py-0"
        >
          {MATCH_STATUS_LABELS[match.status]}
        </Badge>
      </div>

      <div className="divide-y divide-slate-100">
        {/* Team A */}
        <div
          className={`flex items-center justify-between gap-2 px-3 py-2.5 ${
            match.winner_team_id && match.winner_team_id === match.team_a_id
              ? 'bg-emerald-50/70'
              : ''
          }`}
        >
          <div className="min-w-0">
            <p
              className={`text-xs sm:text-sm font-bold truncate ${
                match.winner_team_id && match.winner_team_id === match.team_a_id
                  ? 'text-emerald-800'
                  : 'text-slate-900'
              }`}
            >
              {match.team_a?.team_name || 'Chờ xác định'}
            </p>
            {membersA && <p className="text-[10px] text-slate-500 truncate">{membersA}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(match.sets || []).map((s) => (
              <span
                key={s.id}
                className="w-6 text-center font-mono text-xs text-slate-600 bg-slate-100 rounded py-0.5"
              >
                {s.score_a}
              </span>
            ))}
            <span className="w-6 text-center font-mono text-sm font-black text-navy-950">
              {evalRes.setsWonA}
            </span>
          </div>
        </div>

        {/* Team B */}
        <div
          className={`flex items-center justify-between gap-2 px-3 py-2.5 ${
            match.winner_team_id && match.winner_team_id === match.team_b_id
              ? 'bg-emerald-50/70'
              : ''
          }`}
        >
          <div className="min-w-0">
            <p
              className={`text-xs sm:text-sm font-bold truncate ${
                match.winner_team_id && match.winner_team_id === match.team_b_id
                  ? 'text-emerald-800'
                  : 'text-slate-900'
              }`}
            >
              {match.team_b?.team_name || 'Chờ xác định'}
            </p>
            {membersB && <p className="text-[10px] text-slate-500 truncate">{membersB}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(match.sets || []).map((s) => (
              <span
                key={s.id}
                className="w-6 text-center font-mono text-xs text-slate-600 bg-slate-100 rounded py-0.5"
              >
                {s.score_b}
              </span>
            ))}
            <span className="w-6 text-center font-mono text-sm font-black text-navy-950">
              {evalRes.setsWonB}
            </span>
          </div>
        </div>
      </div>

      {showScoreLink && tournamentId && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-right">
          <Link
            to={`/tournament/${tournamentId}/referee?match=${match.id}`}
            className="text-[11px] font-semibold text-navy-700 hover:underline"
          >
            Nhập / sửa tỷ số →
          </Link>
        </div>
      )}
    </div>
  )
}

export function BracketView({ matches, tournamentId, showScoreLink = false }: BracketViewProps) {
  const bySlot = new Map<string, Match>()
  for (const m of matches) {
    if (m.bracket_slot) bySlot.set(m.bracket_slot, m)
  }

  const finalMatch = bySlot.get('FINAL')
  const thirdMatch = bySlot.get('THIRD')

  const champion =
    finalMatch?.winner_team_id === finalMatch?.team_a_id
      ? finalMatch?.team_a
      : finalMatch?.winner_team_id === finalMatch?.team_b_id
        ? finalMatch?.team_b
        : null

  const runnerUp =
    finalMatch?.winner_team_id === finalMatch?.team_a_id
      ? finalMatch?.team_b
      : finalMatch?.winner_team_id === finalMatch?.team_b_id
        ? finalMatch?.team_a
        : null

  const thirdPlace =
    thirdMatch?.winner_team_id === thirdMatch?.team_a_id
      ? thirdMatch?.team_a
      : thirdMatch?.winner_team_id === thirdMatch?.team_b_id
        ? thirdMatch?.team_b
        : null

  return (
    <div className="space-y-6">
      {/* Podium when completed */}
      {(champion || thirdPlace) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-50 to-white p-4 flex items-center gap-3">
            <div className="rounded-xl bg-amber-500 p-2.5 text-white">
              <Trophy className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-amber-700">Vô địch</p>
              <p className="text-base font-extrabold text-navy-950 truncate">
                {champion?.team_name || 'Đang chờ'}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-300 bg-white p-4 flex items-center gap-3">
            <div className="rounded-xl bg-slate-500 p-2.5 text-white">
              <Award className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-slate-500">Á quân (Hạng 2)</p>
              <p className="text-base font-extrabold text-navy-950 truncate">
                {runnerUp?.team_name || 'Đang chờ'}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-orange-300 bg-orange-50/40 p-4 flex items-center gap-3">
            <div className="rounded-xl bg-orange-600 p-2.5 text-white">
              <Medal className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-orange-700">Hạng 3</p>
              <p className="text-base font-extrabold text-navy-950 truncate">
                {thirdPlace?.team_name || 'Đang chờ'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Responsive Bracket Columns */}
      <div className="grid gap-6 lg:grid-cols-3 items-start">
        {/* Column 1: Tứ kết */}
        <div className="space-y-3">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-navy-900 border-b border-slate-200 pb-2">
            Vòng Tứ kết (BO3 • 15 điểm)
          </h3>
          <div className="space-y-3">
            {['QF1', 'QF3', 'QF2', 'QF4'].map((slot) => (
              <BracketMatchCard
                key={slot}
                match={bySlot.get(slot)}
                tournamentId={tournamentId}
                showScoreLink={showScoreLink}
              />
            ))}
          </div>
        </div>

        {/* Column 2: Bán kết */}
        <div className="space-y-3 lg:pt-12">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-navy-900 border-b border-slate-200 pb-2">
            Vòng Bán kết (BO3 • 15 điểm)
          </h3>
          <div className="space-y-6">
            {['SF1', 'SF2'].map((slot) => (
              <BracketMatchCard
                key={slot}
                match={bySlot.get(slot)}
                tournamentId={tournamentId}
                showScoreLink={showScoreLink}
              />
            ))}
          </div>
        </div>

        {/* Column 3: Chung kết & Tranh hạng 3 */}
        <div className="space-y-6 lg:pt-16">
          <div className="space-y-3">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-amber-700 border-b border-amber-200 pb-2">
              Trận Chung kết (BO3 • 21 điểm)
            </h3>
            <BracketMatchCard
              match={finalMatch}
              tournamentId={tournamentId}
              showScoreLink={showScoreLink}
              highlight="gold"
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-orange-700 border-b border-orange-200 pb-2">
              Tranh hạng 3 (BO3 • 21 điểm)
            </h3>
            <BracketMatchCard
              match={thirdMatch}
              tournamentId={tournamentId}
              showScoreLink={showScoreLink}
              highlight="bronze"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
