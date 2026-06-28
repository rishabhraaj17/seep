import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { motion } from 'motion/react';
import { PlusCircle, DoorOpen, Users, Lock, Globe, AlertCircle } from 'lucide-react';

interface LobbyScreenProps {
  socket: Socket;
  userId: string;
  onJoinGame: () => void;
  onLobbyCreated?: (code: string) => void;
}

export default function LobbyScreen({ socket, userId, onJoinGame, onLobbyCreated }: LobbyScreenProps) {
  const [lobbyCode, setLobbyCode] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [players, setPlayers] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    // Handle lobby created event
    socket.on('lobby-created', ({ code, isPrivate: privateRoom }: { code: string; isPrivate: boolean }) => {
      setLobbyCode(code);
      setIsPrivate(privateRoom);
      setIsHost(true);
      setError('');
      onLobbyCreated?.(code);
    });

    // Handle player joined event
    socket.on('player-joined', (data: { userId: string }) => {
      setPlayers(prev => {
        if (!prev.includes(data.userId)) {
          return [...prev, data.userId];
        }
        return prev;
      });
    });

    // Handle game started event
    socket.on('game-started', () => {
      onJoinGame();
    });

    // Handle errors
    socket.on('error-message', (data: { message: string }) => {
      setError(data.message);
    });

    // Handle lobby state sync
    socket.on('lobby-state', ({ players: roomPlayers }: { players: string[] }) => {
      setPlayers(roomPlayers);
    });

    return () => {
      socket.off('lobby-created');
      socket.off('player-joined');
      socket.off('game-started');
      socket.off('error-message');
      socket.off('lobby-state');
    };
  }, [socket, onJoinGame, onLobbyCreated]);

  const createLobby = useCallback(() => {
    setError('');
    socket.emit('create-lobby', { userId, isPrivate });
  }, [socket, userId, isPrivate]);

  const joinLobby = useCallback(() => {
    if (lobbyCode) {
      setError('');
      socket.emit('join-lobby', { lobbyCode, userId });
      socket.emit('get-lobby-state', { lobbyCode });
    }
  }, [socket, lobbyCode, userId]);

  const startGame = useCallback(() => {
    if (lobbyCode && players.length === 4 && isHost) {
      socket.emit('start-game', { lobbyCode });
    }
  }, [socket, lobbyCode, players.length, isHost]);

  const leaveLobby = useCallback(() => {
    if (lobbyCode) {
      socket.emit('leave-lobby', { lobbyCode, userId });
    }
    setLobbyCode('');
    setPlayers([]);
    setIsHost(false);
    setIsPrivate(false);
  }, [socket, lobbyCode, userId]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gray-800 rounded-xl p-8 w-full max-w-2xl card-shadow"
      >
        <h1 className="text-3xl font-bold mb-6 text-yellow-500">Game Lobby</h1>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg flex items-center gap-2 text-red-300">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {!lobbyCode ? (
          <div className="space-y-6">
            {/* Create Lobby Section */}
            <div>
              <h2 className="text-lg font-medium mb-3">Create New Lobby</h2>
              <div className="flex gap-3 items-center mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span>Private Room</span>
                </label>
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={createLobby}
                className="w-full py-3 px-6 bg-yellow-600 rounded-lg font-semibold flex items-center justify-center gap-2"
              >
                <PlusCircle className="w-5 h-5" />
                Create Lobby
              </motion.button>
            </div>

            {/* Join Lobby Section */}
            <div className="border-t border-gray-600 pt-6">
              <h2 className="text-lg font-medium mb-4">Join Existing Lobby</h2>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={lobbyCode}
                  onChange={(e) => setLobbyCode(e.target.value.toUpperCase())}
                  className="flex-1 px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 focus:border-yellow-500 focus:outline-none"
                  placeholder="Enter lobby code"
                  maxLength={6}
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={joinLobby}
                  className="px-6 py-2 bg-gray-600 rounded-lg font-medium flex items-center gap-2"
                >
                  <DoorOpen className="w-4 h-4" />
                  Join
                </motion.button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* Lobby Info */}
            <div className="flex items-center justify-between mb-4 text-gray-300">
              <div className="flex items-center gap-2">
                {isPrivate ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                <span>Lobby Code: <strong className="text-yellow-500 text-xl">{lobbyCode}</strong></span>
              </div>
              <button
                onClick={leaveLobby}
                className="text-sm text-gray-400 hover:text-red-400"
              >
                Leave
              </button>
            </div>

            {/* Players */}
            <div className="mb-6">
              <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
                <Users className="w-5 h-5" />
                Players ({players.length}/4)
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {players.map((p, i) => (
                  <div
                    key={p}
                    className="bg-gray-700 rounded-lg p-3 text-center"
                  >
                    {p === userId ? 'You (Seat ' + (i + 1) + ')' : p}
                  </div>
                ))}
                {Array.from({ length: 4 - players.length }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="bg-gray-700/50 rounded-lg p-3 text-center text-gray-500"
                  >
                    Waiting...
                  </div>
                ))}
              </div>
            </div>

            {/* Start Game Button */}
            {isHost && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={startGame}
                disabled={players.length < 4}
                className={`w-full py-3 px-6 rounded-lg font-semibold ${
                  players.length === 4
                    ? 'bg-yellow-600 hover:bg-yellow-700'
                    : 'bg-gray-600 cursor-not-allowed'
                }`}
              >
                Start Game
              </motion.button>
            )}

            {!isHost && (
              <p className="text-center text-sm text-gray-400">
                Waiting for host to start the game...
              </p>
            )}

            <p className="text-center text-sm text-gray-400 mt-4">
              Share the lobby code with your friends to join!
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}