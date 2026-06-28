import { motion } from 'motion/react';

interface ScoreboardProps {
  team1Score?: number;
  team2Score?: number;
  round?: number;
  seepCount?: number;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Scoreboard({
  team1Score = 22,
  team2Score = 15,
  round = 1,
  seepCount = 0,
  isOpen = true,
  onClose,
}: ScoreboardProps) {
  const totalScore = team1Score + team2Score;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: isOpen ? 0 : '100%' }}
      className="absolute top-0 right-0 h-full w-56 sm:w-64 bg-gray-800/95 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto z-10"
    >
      {/* Close button for mobile */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 sm:hidden w-8 h-8 flex items-center justify-center bg-gray-700 rounded-full"
        >
          ×
        </button>
      )}

      <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 text-yellow-500 pr-8 sm:pr-0">Scoreboard</h2>

      <div className="space-y-3 sm:space-y-4">
        {/* Team Scores */}
        <div>
          <h3 className="text-xs sm:text-sm font-medium text-gray-400 mb-1 sm:mb-2">Round {round}</h3>
          <div className="grid grid-cols-2 gap-1 sm:gap-2">
            <div className="bg-green-600 rounded-lg p-2 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-gray-300">Team 1</p>
              <p className="text-xl sm:text-2xl font-bold">{team1Score}</p>
            </div>
            <div className="bg-green-600 rounded-lg p-2 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-gray-300">Team 2</p>
              <p className="text-xl sm:text-2xl font-bold">{team2Score}</p>
            </div>
          </div>
        </div>

        {/* Seep Bonus */}
        {seepCount > 0 && (
          <div className="bg-gray-700 rounded-lg p-2 sm:p-3">
            <p className="text-[10px] sm:text-xs text-gray-400">Seep Bonuses</p>
            <p className="text-sm sm:text-lg font-semibold text-yellow-500">+{seepCount * 50} pts</p>
          </div>
        )}

        {/* Game Progress */}
        <div className="bg-gray-700 rounded-lg p-2 sm:p-3">
          <p className="text-[10px] sm:text-xs text-gray-400 mb-1">Game Progress</p>
          <div className="w-full bg-gray-600 rounded-full h-1.5 sm:h-2">
            <div
              className="bg-yellow-500 h-full rounded-full transition-all"
              style={{ width: `${Math.min(totalScore / 100 * 100, 100)}%` }}
            />
          </div>
          <p className="text-[10px] sm:text-xs text-gray-500 mt-1">{totalScore}/100 pts</p>
        </div>

        {/* Captured Cards Legend */}
        <div>
          <h3 className="text-xs sm:text-sm font-medium text-gray-400 mb-1 sm:mb-2">Scoring Cards</h3>
          <div className="flex gap-2 text-sm sm:text-lg">
            <span className="text-red-500">♦ 10D = 6pts</span>
          </div>
          <div className="flex gap-2 text-xs sm:text-sm mt-1">
            <span className="text-red-500">A♥ = 1pt</span>
            <span className="text-gray-900">A♠ = 2pts</span>
          </div>
          <div className="flex gap-2 text-xs sm:text-sm mt-1">
            <span className="text-gray-900">All ♠ = 1pt each</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}