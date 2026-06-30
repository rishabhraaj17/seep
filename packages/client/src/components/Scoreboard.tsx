import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface ScoreboardProps {
  team1Score?: number;
  team2Score?: number;
  round?: number;
  seepCount?: { team1: number; team2: number };
  teamNames?: { team1: string; team2: string };
}

export default function Scoreboard({
  team1Score = 0,
  team2Score = 0,
  round = 1,
  seepCount = { team1: 0, team2: 0 },
  teamNames = { team1: 'Team 1', team2: 'Team 2' },
}: ScoreboardProps) {
  const [expanded, setExpanded] = useState(false);
  const target = 100;
  const leader = team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : 0;

  return (
    <div className="w-full z-30" style={{ background: 'rgba(9,18,11,0.97)', borderBottom: '1px solid rgba(212,175,55,0.2)', backdropFilter: 'blur(20px)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
      {/* Main bar — always visible */}
      <div className="h-12 px-3 flex items-center justify-between gap-2">
        {/* Left: Logo & Round */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-display text-xs font-bold text-gold-gradient tracking-widest uppercase hidden sm:block">Seep Club</span>
          <span className="text-[11px] text-emerald-100/60 font-semibold">R{round}</span>
        </div>

        {/* Center: Score pill */}
        <div className="flex items-center gap-2 flex-1 justify-center max-w-md">
          {/* Team 1 */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${leader === 1 ? 'bg-emerald-900/40 border border-emerald-600/40' : 'border border-transparent'}`}>
            <span className={`text-[10px] font-bold uppercase tracking-wide ${leader === 1 ? 'text-emerald-400' : 'text-emerald-100/50'}`}>
              {leader === 1 && '👑 '}{teamNames.team1}
            </span>
            <span className="text-sm font-bold font-mono text-white">{team1Score}</span>
            {seepCount.team1 > 0 && (
              <span className="text-[9px] text-blue-300 font-bold">🌊×{seepCount.team1}</span>
            )}
          </div>

          {/* Progress bar */}
          <div className="hidden sm:flex items-center gap-0 flex-1 h-2.5 rounded-full bg-black/40 overflow-hidden relative border border-emerald-950/60" style={{ maxWidth: '200px' }}>
            <div className="absolute top-0 bottom-0 left-[50%] right-0 bg-blue-500/15" />
            <div className="absolute top-0 bottom-0 left-0 right-[50%] bg-emerald-500/15" />
            <motion.div className="absolute top-0 bottom-0 right-[50%] bg-emerald-500 origin-right"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((team1Score / target) * 50, 50)}%` }}
              transition={{ duration: 0.5 }} />
            <motion.div className="absolute top-0 bottom-0 left-[50%] bg-blue-500 origin-left"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((team2Score / target) * 50, 50)}%` }}
              transition={{ duration: 0.5 }} />
            <div className="absolute inset-y-0 left-[50%] w-px bg-emerald-950" />
          </div>

          {/* Team 2 */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${leader === 2 ? 'bg-blue-900/30 border border-blue-600/40' : 'border border-transparent'}`}>
            <span className="text-sm font-bold font-mono text-white">{team2Score}</span>
            {seepCount.team2 > 0 && (
              <span className="text-[9px] text-blue-300 font-bold">🌊×{seepCount.team2}</span>
            )}
            <span className={`text-[10px] font-bold uppercase tracking-wide ${leader === 2 ? 'text-blue-400' : 'text-emerald-100/50'}`}>
              {teamNames.team2}{leader === 2 && ' 👑'}
            </span>
          </div>
        </div>

        {/* Right: Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all border"
          style={{ background: expanded ? 'rgba(212,175,55,0.15)' : 'rgba(0,0,0,0.3)', borderColor: 'rgba(212,175,55,0.25)', color: '#d4af37' }}
        >
          <span className="text-[10px] font-bold">{expanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* Expanded details panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 grid grid-cols-2 gap-3 border-t border-emerald-900/40">
              {/* Team 1 Detail */}
              <div className="rounded-xl p-3 text-left" style={{ background: 'rgba(22,48,32,0.4)', border: '1px solid rgba(22,160,133,0.2)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">{teamNames.team1}</span>
                  {leader === 1 && <span className="text-[10px] text-gold-gradient font-bold">👑 Leading</span>}
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-bold font-mono text-white">{team1Score}</span>
                  <span className="text-[10px] text-emerald-100/40">/ {target} pts</span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mb-2">
                  <motion.div className="h-full rounded-full bg-emerald-500"
                    animate={{ width: `${Math.min((team1Score / target) * 100, 100)}%` }}
                    transition={{ duration: 0.5 }} />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-emerald-100/50">
                  <span>🌊 Seeps: <strong className="text-blue-300">{seepCount.team1}</strong></span>
                  <span>·</span>
                  <span>Need: <strong className="text-white">{Math.max(target - team1Score, 0)}</strong> pts</span>
                </div>
              </div>

              {/* Team 2 Detail */}
              <div className="rounded-xl p-3 text-left" style={{ background: 'rgba(15,30,60,0.4)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-blue-400">{teamNames.team2}</span>
                  {leader === 2 && <span className="text-[10px] text-gold-gradient font-bold">👑 Leading</span>}
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-bold font-mono text-white">{team2Score}</span>
                  <span className="text-[10px] text-emerald-100/40">/ {target} pts</span>
                </div>
                <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mb-2">
                  <motion.div className="h-full rounded-full bg-blue-500"
                    animate={{ width: `${Math.min((team2Score / target) * 100, 100)}%` }}
                    transition={{ duration: 0.5 }} />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-emerald-100/50">
                  <span>🌊 Seeps: <strong className="text-blue-300">{seepCount.team2}</strong></span>
                  <span>·</span>
                  <span>Need: <strong className="text-white">{Math.max(target - team2Score, 0)}</strong> pts</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}