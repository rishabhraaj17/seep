import { motion } from 'motion/react';

interface ScoreboardProps {
  team1Score?: number;
  team2Score?: number;
  round?: number;
  seepCount?: { team1: number; team2: number };
}

export default function Scoreboard({
  team1Score = 0,
  team2Score = 0,
  round = 1,
  seepCount = { team1: 0, team2: 0 },
}: ScoreboardProps) {
  const target = 100;
  const leader = team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : 0;

  return (
    <div 
      className="w-full h-14 px-4 flex items-center justify-between z-30"
      style={{
        background: 'rgba(9, 18, 11, 0.95)',
        borderBottom: '1px solid rgba(212,175,55,0.2)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
      }}
    >
      {/* Left side: Logo & Round */}
      <div className="flex items-center gap-4">
        <span className="font-display text-xs sm:text-sm font-bold text-gold-gradient tracking-widest uppercase">Seep Club</span>
        <div className="h-4 w-[1px] bg-emerald-800/50" />
        <span className="text-[11px] text-emerald-100/60 font-semibold">Round {round}</span>
      </div>

      {/* Center: Scores & Progress */}
      <div className="flex items-center gap-4 sm:gap-8 flex-1 justify-center max-w-lg">
        {/* Team 1 */}
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold ${leader === 1 ? 'text-emerald-400' : 'text-emerald-100/60'}`}>
            T1 {leader === 1 && '👑'}
          </span>
          <span className="text-xs font-bold font-mono">{team1Score}</span>
        </div>

        {/* Progress bar */}
        <div className="hidden sm:flex items-center gap-2 flex-1 h-2 rounded-full bg-black/40 overflow-hidden relative border border-emerald-950">
          <div className="absolute top-0 bottom-0 left-[50%] right-0 bg-blue-500/20" />
          <div className="absolute top-0 bottom-0 left-0 right-[50%] bg-emerald-500/20" />
          
          {/* T1 Fill */}
          <motion.div 
            className="absolute top-0 bottom-0 right-[50%] bg-emerald-500" 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((team1Score / target) * 50, 50)}%` }}
            transition={{ duration: 0.5 }}
          />
          {/* T2 Fill */}
          <motion.div 
            className="absolute top-0 bottom-0 left-[50%] bg-blue-500" 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((team2Score / target) * 50, 50)}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Team 2 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold font-mono">{team2Score}</span>
          <span className={`text-[11px] font-semibold ${leader === 2 ? 'text-blue-400' : 'text-emerald-100/60'}`}>
            {leader === 2 && '👑'} T2
          </span>
        </div>
      </div>

      {/* Right side: Seeps info */}
      <div className="flex items-center gap-3">
        {(seepCount.team1 > 0 || seepCount.team2 > 0) && (
          <div className="text-[10px] bg-gold-gradient/10 border border-gold-gradient/30 rounded-lg px-2 sm:px-3 py-0.5 text-gold-gradient font-bold">
            🌊 Seeps: T1({seepCount.team1}) | T2({seepCount.team2})
          </div>
        )}
      </div>
    </div>
  );
}