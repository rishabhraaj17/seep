import { motion, AnimatePresence } from 'motion/react';

interface ScoreboardProps {
  team1Score?: number;
  team2Score?: number;
  round?: number;
  seepCount?: { team1: number; team2: number };
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Scoreboard({
  team1Score = 0,
  team2Score = 0,
  round = 1,
  seepCount = { team1: 0, team2: 0 },
  isOpen = true,
  onClose,
  const target = 100;
  const t1Pct = Math.min((team1Score / target) * 100, 100);
  const t2Pct = Math.min((team2Score / target) * 100, 100);
  const leader = team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="absolute top-0 right-0 h-full w-56 sm:w-64 z-20 flex flex-col overflow-hidden"
          style={{
            background: 'rgba(9, 18, 11, 0.92)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(212,175,55,0.2)',
            boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
          }}
        >
          {/* Header */}
          <div className="p-4 flex items-center justify-between flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(212,175,55,0.15)' }}>
            <div>
              <h2 className="font-display text-base font-bold text-gold-gradient">Scoreboard</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(245,240,232,0.4)' }}>Round {round}</p>
            </div>
            {onClose && (
              <button onClick={onClose}
                className="w-7 h-7 rounded-full flex items-center justify-center text-sm transition-colors"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.2)', color: 'rgba(245,240,232,0.5)', minHeight: 'auto' }}
              >
                ×
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Team scores */}
            {[
              { label: 'Team 1', score: team1Score, pct: t1Pct, isLeader: leader === 1, color: '#22c55e', bg: 'rgba(22,160,133,0.1)' },
              { label: 'Team 2', score: team2Score, pct: t2Pct, isLeader: leader === 2, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
            ].map(team => (
              <div key={team.label} className="rounded-xl p-3"
                style={{ background: team.isLeader ? team.bg : 'rgba(0,0,0,0.25)', border: `1px solid ${team.isLeader ? team.color + '40' : 'rgba(212,175,55,0.1)'}` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-display font-semibold tracking-wide" style={{ color: team.isLeader ? team.color : 'rgba(245,240,232,0.5)' }}>
                    {team.label} {team.isLeader && '👑'}
                  </span>
                  <span className="text-2xl font-bold font-display" style={{ color: team.isLeader ? team.color : 'rgba(245,240,232,0.8)' }}>
                    {team.score}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${team.color}88, ${team.color})` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${team.pct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
                <div className="text-right text-[10px] mt-1" style={{ color: 'rgba(245,240,232,0.25)' }}>
                  {team.score} / {target}
                </div>
              </div>
            ))}

            {/* Seep bonus */}
            {((seepCount?.team1 || 0) > 0 || (seepCount?.team2 || 0) > 0) && (
              <div className="rounded-xl p-3 text-center"
                style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
                <p className="text-xs font-display tracking-wide mb-1" style={{ color: 'rgba(212,175,55,0.7)' }}>🌊 Seep Bonus</p>
                <div className="flex flex-col gap-1 text-xs">
                  {((seepCount?.team1 || 0) > 0) && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Team 1:</span>
                      <span className="font-bold text-gold-gradient">+{seepCount.team1 * 50} pts</span>
                    </div>
                  )}
                  {((seepCount?.team2 || 0) > 0) && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Team 2:</span>
                      <span className="font-bold text-gold-gradient">+{seepCount.team2 * 50} pts</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="divider-gold" />

            {/* Scoring legend */}
            <div>
              <p className="text-xs font-display tracking-[0.15em] uppercase mb-2" style={{ color: 'rgba(245,240,232,0.35)' }}>
                Scoring Cards
              </p>
              {[
                { label: '10 ♦ (Dehla)', value: '6 pts', color: '#c0392b' },
                { label: 'A ♠', value: '2 pts', color: 'rgba(245,240,232,0.8)' },
                { label: 'All Aces', value: '1 pt each', color: '#c0392b' },
                { label: 'All ♠', value: '1 pt each', color: 'rgba(245,240,232,0.8)' },
                { label: '🌊 Seep', value: '50 pts!', color: '#d4af37' },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between py-1.5"
                  style={{ borderBottom: '1px solid rgba(212,175,55,0.06)' }}>
                  <span className="text-xs" style={{ color: item.color }}>{item.label}</span>
                  <span className="text-xs font-semibold" style={{ color: 'rgba(245,240,232,0.5)' }}>{item.value}</span>
                </div>
              ))}
            </div>

            {/* Win condition */}
            <div className="rounded-xl p-3 text-center"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.1)' }}>
              <p className="text-[10px] tracking-wide uppercase" style={{ color: 'rgba(245,240,232,0.3)' }}>Win Condition</p>
              <p className="text-sm font-bold font-display mt-1" style={{ color: 'rgba(212,175,55,0.6)' }}>First to 100 pts</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}