import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';

interface LobbyScreenProps {
  socket: Socket;
  userId: string;
  username: string;
  role: string;
  onRoleUpdate: (newRole: string, newToken?: string) => void;
  onLogout: () => void;
  onJoinGame: (code: string) => void;
  onLobbyCreated?: (code: string) => void;
}

interface AdminUser {
  id: string;
  username: string;
  role: string;
}

interface AdminLobby {
  code: string;
  isPrivate: boolean;
  players: string[];
  status: string;
}

const TEAM_NAME_POOL_1 = ['🦁 Lions', '🐉 Dragons', '♠ Spades', '🔥 Flames', '⚡ Bolts', '🌿 Vipers'];
const TEAM_NAME_POOL_2 = ['🦅 Eagles', '🌊 Tides', '♥ Hearts', '❄ Frost', '🌙 Wolves', '💎 Diamonds'];
function randomTeamName(team: 1 | 2) {
  const pool = team === 1 ? TEAM_NAME_POOL_1 : TEAM_NAME_POOL_2;
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function LobbyScreen({
  socket,
  userId,
  username,
  role,
  onRoleUpdate,
  onLogout,
  onJoinGame,
  onLobbyCreated,
}: LobbyScreenProps) {
  const [lobbyCode, setLobbyCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [players, setPlayers] = useState<string[]>([]);
  const [playerDetails, setPlayerDetails] = useState<{ id: string; team: 1 | 2; seat: number }[]>([]);
  const [error, setError] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [inLobby, setInLobby] = useState(false);
  const [copied, setCopied] = useState(false);
  const [teamNames, setTeamNames] = useState({ team1: randomTeamName(1), team2: randomTeamName(2) });
  const [showTeamEdit, setShowTeamEdit] = useState(false);

  // Profile & Settings states
  const [showProfile, setShowProfile] = useState(false);
  
  // Admin Panel states
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminLobbies, setAdminLobbies] = useState<AdminLobby[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    socket.on('lobby-created', ({ code, isPrivate: priv }: { code: string; isPrivate: boolean }) => {
      setLobbyCode(code);
      setIsPrivate(priv);
      setIsHost(true);
      setInLobby(true);
      setError('');
      setPlayers([userId]);
      setPlayerDetails([{ id: userId, team: 1, seat: 1 }]);
      onLobbyCreated?.(code);
    });

    socket.on('lobby-state', ({ players: roomPlayers, playerDetails: pd, teamNames: tn }: {
      players: string[];
      playerDetails?: { id: string; team: 1 | 2; seat: number }[];
      teamNames?: { team1: string; team2: string };
    }) => {
      setPlayers(roomPlayers);
      if (pd) setPlayerDetails(pd);
      if (tn) setTeamNames(tn);
      if (roomPlayers.length > 0) setInLobby(true);
    });

    socket.on('teams-updated', ({ players: pd, teamNames: tn }: {
      players: { id: string; team: 1 | 2; seat: number }[];
      teamNames: { team1: string; team2: string };
    }) => {
      setPlayerDetails(pd);
      setTeamNames(tn);
    });

    socket.on('player-joined', (data: { userId: string }) => {
      setPlayers(prev => prev.includes(data.userId) ? prev : [...prev, data.userId]);
    });

    socket.on('game-started', () => { onJoinGame(lobbyCode); });

    socket.on('player-left', ({ players: remaining }: { players: string[] }) => {
      setPlayers(remaining);
      if (remaining[0] === userId) {
        setIsHost(true);
      }
    });

    socket.on('error-message', (data: { message: string }) => {
      setError(data.message);
    });

    return () => {
      socket.off('lobby-created');
      socket.off('lobby-state');
      socket.off('teams-updated');
      socket.off('player-joined');
      socket.off('game-started');
      socket.off('player-left');
      socket.off('error-message');
    };
  }, [socket, onJoinGame, onLobbyCreated, userId]);

  const createLobby = useCallback(() => {
    setError('');
    socket.emit('create-lobby', { isPrivate });
  }, [socket, isPrivate]);

  const joinLobby = useCallback(() => {
    const code = inputCode.trim().toUpperCase();
    if (!code) { setError('Please enter a lobby code'); return; }
    setError('');
    setLobbyCode(code);
    socket.emit('join-lobby', { lobbyCode: code });
  }, [socket, inputCode]);

  const startGame = useCallback(() => {
    if (lobbyCode && players.length === 4 && isHost) socket.emit('start-game', { lobbyCode });
  }, [socket, lobbyCode, players.length, isHost]);

  const leaveLobby = useCallback(() => {
    if (lobbyCode) socket.emit('leave-lobby', { lobbyCode });
    setLobbyCode(''); setInputCode(''); setPlayers([]);
    setIsHost(false); setIsPrivate(false); setInLobby(false);
  }, [socket, lobbyCode]);

  const addBot = useCallback(() => {
    if (lobbyCode) {
      socket.emit('add-bot', { lobbyCode });
    }
  }, [socket, lobbyCode]);

  const applyTeams = useCallback(() => {
    if (!lobbyCode || !isHost || players.length !== 4) return;
    const assignments = players.map((pid, idx) => ({
      userId: pid,
      team: (playerDetails.find(p => p.id === pid)?.team ?? ((idx % 2 === 0) ? 1 : 2)) as 1 | 2,
    }));
    socket.emit('set-teams', { lobbyCode, assignments, teamNames });
  }, [socket, lobbyCode, isHost, players, playerDetails, teamNames]);

  const togglePlayerTeam = (pid: string) => {
    setPlayerDetails(prev => prev.map(p => p.id === pid ? { ...p, team: p.team === 1 ? 2 : 1 } : p));
  };

  const copyCode = () => {
    navigator.clipboard.writeText(lobbyCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Fetch admin panel data
  const fetchAdminData = async () => {
    setAdminLoading(true);
    const token = localStorage.getItem('token');
    try {
      const usersRes = await fetch('/api/auth/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const usersData = await usersRes.json();
      if (usersRes.ok) {
        setAdminUsers(usersData.users || []);
      }

      const lobbiesRes = await fetch('/api/admin/lobbies', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const lobbiesData = await lobbiesRes.json();
      if (lobbiesRes.ok) {
        setAdminLobbies(lobbiesData.lobbies || []);
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (showAdminPanel && role === 'admin') {
      fetchAdminData();
    }
  }, [showAdminPanel, role]);

  const changeUserRole = async (targetUsername: string, newRole: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch('/api/auth/change-role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username: targetUsername, role: newRole })
      });
      const data = await res.json();
      if (res.ok) {
        if (targetUsername === username) {
          onRoleUpdate(newRole, data.token);
        }
        fetchAdminData();
      } else {
        alert(data.error || 'Failed to update role');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteLobby = async (code: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`/api/lobby/${code}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchAdminData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete lobby');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const changeSelfRole = async (newRole: string) => {
    await changeUserRole(username, newRole);
    setShowProfile(false);
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 overflow-hidden felt-bg">
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.15) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(22,48,32,0.8) 0%, transparent 70%)' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-2xl z-10 animate-deal-in"
      >
        <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl">
          {/* Top gold bar */}
          <div className="h-1.5" style={{ background: 'linear-gradient(90deg, transparent, #d4af37, #f5d78e, #d4af37, transparent)' }} />

          <div className="p-6 sm:p-8">
            {/* Header / Navbar */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gold-500/10">
              <div className="text-left">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-gold-gradient tracking-wide">
                  SEEP CARD TABLE
                </h1>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(245,240,232,0.4)' }}>
                  {inLobby ? `Lobby: ${lobbyCode} · ${players.length}/4` : 'Create or join a card table'}
                </p>
              </div>
              
              <div className="flex items-center gap-2">
                {role === 'admin' && (
                  <button
                    onClick={() => setShowAdminPanel(!showAdminPanel)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold font-display tracking-wider border transition-all cursor-pointer"
                    style={{
                      background: showAdminPanel ? 'rgba(212,175,55,0.2)' : 'rgba(0,0,0,0.3)',
                      borderColor: 'rgba(212,175,55,0.4)',
                      color: '#d4af37',
                      minHeight: '36px'
                    }}
                  >
                    🛠️ {showAdminPanel ? 'Play Area' : 'Admin Panel'}
                  </button>
                )}

                {/* Profile Widget */}
                <div className="relative">
                  <button
                    onClick={() => setShowProfile(!showProfile)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-black/35 border border-gold-500/25 hover:border-gold-500/50 transition-all cursor-pointer"
                    style={{ minHeight: '36px' }}
                  >
                    <span className="text-base">👤</span>
                    <span className="hidden sm:inline text-gold-gradient">{username}</span>
                  </button>

                  <AnimatePresence>
                    {showProfile && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-56 rounded-xl p-4 shadow-xl z-50 text-left"
                        style={{
                          background: 'rgba(9, 18, 11, 0.96)',
                          backdropFilter: 'blur(20px)',
                          border: '1px solid rgba(212, 175, 55, 0.3)',
                          boxShadow: '0 10px 25px rgba(0,0,0,0.6)'
                        }}
                      >
                        <h3 className="font-display text-sm font-bold text-gold-gradient border-b border-gold-500/10 pb-2 mb-3">
                          Player Profile
                        </h3>
                        
                        <div className="space-y-3 text-xs mb-4">
                          <div>
                            <span className="text-gray-400">Username:</span>
                            <div className="font-bold text-white mt-0.5">{username}</div>
                          </div>
                          <div>
                            <span className="text-gray-400">Current Role:</span>
                            <div className="font-bold mt-0.5 uppercase tracking-wider text-yellow-500">
                              {role}
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-400">Switch Role (Dev Testing):</span>
                            <select
                              value={role}
                              onChange={(e) => changeSelfRole(e.target.value)}
                              className="w-full mt-1.5 px-2 py-1.5 rounded bg-black/50 border border-gold-500/30 text-white outline-none"
                            >
                              <option value="player">Player</option>
                              <option value="admin">Admin</option>
                              <option value="spectator">Spectator</option>
                            </select>
                          </div>
                        </div>

                        <button
                          onClick={onLogout}
                          className="w-full py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                          style={{
                            background: 'rgba(139,26,26,0.3)',
                            border: '1px solid rgba(192,57,43,0.4)',
                            color: '#f1948a',
                            minHeight: '32px'
                          }}
                        >
                          🚪 Logout
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Error display */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
                  style={{ background: 'rgba(139,26,26,0.3)', border: '1px solid rgba(192,57,43,0.4)', color: '#f1948a' }}
                >
                  ⚠️ {error}
                  <button onClick={() => setError('')} className="ml-auto opacity-60 hover:opacity-100 text-lg leading-none" style={{ minHeight: 'auto' }}>×</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main content area switcher */}
            <AnimatePresence mode="wait">
              {showAdminPanel && role === 'admin' ? (
                <motion.div
                  key="admin-panel"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-6 text-left"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold text-gold-gradient">
                      🛠️ RBAC & Admin Dashboard
                    </h2>
                    <button
                      onClick={fetchAdminData}
                      className="px-2 py-1 rounded bg-gold-500/10 border border-gold-500/30 text-xs text-gold-300 cursor-pointer"
                      style={{ minHeight: '28px' }}
                    >
                      🔄 Refresh
                    </button>
                  </div>

                  {adminLoading ? (
                    <div className="text-center py-8 text-sm text-gold-500 animate-pulse">
                      Loading server status...
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Active Lobbies */}
                      <div className="bg-black/25 rounded-xl p-4 border border-gold-500/10">
                        <h3 className="text-xs font-display font-semibold tracking-[0.2em] text-gold-300 uppercase mb-3">
                          Active Lobbies
                        </h3>
                        {adminLobbies.length === 0 ? (
                          <p className="text-xs text-gray-500 italic">No active lobbies in server memory.</p>
                        ) : (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {adminLobbies.map(lobby => (
                              <div
                                key={lobby.code}
                                className="flex items-center justify-between p-2.5 rounded bg-black/45 border border-gold-500/5 text-xs"
                              >
                                <div>
                                  <span className="font-mono font-bold text-gold-500 text-sm tracking-wide mr-2">
                                    {lobby.code}
                                  </span>
                                  <span className="text-gray-400">
                                    ({lobby.players.length}/4 players) · <span className="capitalize">{lobby.status}</span>
                                  </span>
                                  <div className="text-[10px] text-gray-500 mt-0.5">
                                    Players: {lobby.players.join(', ')}
                                  </div>
                                </div>
                                <button
                                  onClick={() => deleteLobby(lobby.code)}
                                  className="px-2 py-1 rounded bg-red-950/40 border border-red-500/30 text-red-300 hover:bg-red-900/30 transition-all cursor-pointer"
                                  style={{ minHeight: '24px' }}
                                >
                                  Terminate
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Registered Users */}
                      <div className="bg-black/25 rounded-xl p-4 border border-gold-500/10">
                        <h3 className="text-xs font-display font-semibold tracking-[0.2em] text-gold-300 uppercase mb-3">
                          Registered Users (RBAC Manager)
                        </h3>
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {adminUsers.map(u => (
                            <div
                              key={u.id}
                              className="flex items-center justify-between p-2.5 rounded bg-black/45 border border-gold-500/5 text-xs"
                            >
                              <div>
                                <span className="font-semibold text-white">{u.username}</span>
                                <span className="text-gray-500 ml-2">(ID: {u.id})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase text-gold-500 bg-gold-500/10 px-1.5 py-0.5 rounded font-bold">
                                  {u.role}
                                </span>
                                <select
                                  value={u.role}
                                  onChange={(e) => changeUserRole(u.username, e.target.value)}
                                  className="px-1.5 py-1 rounded bg-black/80 border border-gold-500/30 text-white outline-none text-xs"
                                >
                                  <option value="player">Player</option>
                                  <option value="admin">Admin</option>
                                  <option value="spectator">Spectator</option>
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setShowAdminPanel(false)}
                    className="btn-gold w-full py-3 rounded-xl text-xs tracking-widest uppercase mt-4"
                  >
                    ← Back to Table Area
                  </button>
                </motion.div>
              ) : !inLobby ? (
                <motion.div
                  key="pre-lobby"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  {/* Create */}
                  <div className="rounded-xl p-5 text-left" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(212,175,55,0.12)' }}>
                    <h2 className="font-display text-sm font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: 'rgba(212,175,55,0.8)' }}>
                      ✦ Create New Lobby
                    </h2>
                    <label className="flex items-center gap-3 mb-4 cursor-pointer group">
                      <div
                        onClick={() => setIsPrivate(!isPrivate)}
                        className={`w-5 h-5 rounded flex items-center justify-center transition-all ${isPrivate ? 'btn-gold' : ''}`}
                        style={!isPrivate ? { background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,175,55,0.3)' } : {}}
                      >
                        {isPrivate && <span className="text-[10px] font-bold">✓</span>}
                      </div>
                      <span className="text-sm group-hover:text-white transition-colors" style={{ color: 'rgba(245,240,232,0.7)' }}>
                        Private Room
                        <span className="ml-2 text-xs" style={{ color: 'rgba(245,240,232,0.35)' }}>(invite only)</span>
                      </span>
                    </label>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={createLobby}
                      className="btn-gold w-full py-3 rounded-xl text-sm tracking-widest uppercase"
                    >
                      ✦ Create Lobby
                    </motion.button>
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1 divider-gold" />
                    <span className="text-xs tracking-[0.2em] uppercase" style={{ color: 'rgba(212,175,55,0.5)' }}>or</span>
                    <div className="flex-1 divider-gold" />
                  </div>

                  {/* Join */}
                  <div className="rounded-xl p-5 text-left" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(212,175,55,0.12)' }}>
                    <h2 className="font-display text-sm font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: 'rgba(212,175,55,0.8)' }}>
                      ✦ Join Existing Lobby
                    </h2>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inputCode}
                        onChange={e => setInputCode(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && joinLobby()}
                        className="input-premium flex-1 px-4 py-3 rounded-xl text-sm font-mono tracking-widest"
                        placeholder="A3F12B"
                        maxLength={6}
                      />
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={joinLobby}
                        className="btn-gold px-6 py-3 rounded-xl text-sm tracking-wide"
                      >
                        Join →
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="in-lobby"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* Lobby code banner */}
                  <div className="rounded-xl p-4 mb-6 flex items-center justify-between text-left"
                    style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
                    <div>
                      <div className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: 'rgba(212,175,55,0.6)' }}>
                        {isPrivate ? '🔒 Private' : '🌐 Public'} · Lobby Code
                      </div>
                      <div className="font-display text-3xl font-bold tracking-[0.35em] text-gold-gradient">
                        {lobbyCode}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={copyCode}
                        className="px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer"
                        style={{
                          background: copied ? 'rgba(22,160,133,0.3)' : 'rgba(212,175,55,0.15)',
                          border: `1px solid ${copied ? 'rgba(22,160,133,0.5)' : 'rgba(212,175,55,0.3)'}`,
                          color: copied ? '#1abc9c' : '#d4af37',
                          minHeight: '32px',
                        }}
                      >
                        {copied ? '✓ Copied' : '⎘ Copy'}
                      </motion.button>
                      <button
                        onClick={leaveLobby}
                        className="px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer"
                        style={{
                          background: 'rgba(139,26,26,0.2)',
                          border: '1px solid rgba(192,57,43,0.3)',
                          color: 'rgba(241,148,138,0.8)',
                          minHeight: '32px',
                        }}
                      >
                        Leave
                      </button>
                    </div>
                  </div>

                  {/* Player seats + Team assignment */}
                  <div className="mb-5 text-left">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-display text-sm font-semibold tracking-[0.2em] uppercase" style={{ color: 'rgba(212,175,55,0.7)' }}>
                        Players · {players.length} / 4
                      </h2>
                      <div className="flex items-center gap-2">
                        {isHost && players.length > 1 && (
                          <button
                            onClick={() => setShowTeamEdit(e => !e)}
                            className="px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                            style={{ background: showTeamEdit ? 'rgba(212,175,55,0.2)' : 'rgba(0,0,0,0.3)', borderColor: 'rgba(212,175,55,0.4)', color: '#d4af37', minHeight: '28px' }}
                          >
                            {showTeamEdit ? '✓ Done' : '🏷 Teams'}
                          </button>
                        )}
                        {players.length < 4 && (
                          <button
                            onClick={addBot}
                            className="px-2.5 py-1 rounded bg-gold-500/10 border border-gold-500/30 text-[10px] font-bold text-gold-300 uppercase tracking-wider hover:bg-gold-500/20 transition-all cursor-pointer"
                            style={{ minHeight: '28px' }}
                          >
                            🤖 Add Bot
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Team management panel */}
                    <AnimatePresence>
                      {showTeamEdit && isHost && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mb-4 rounded-xl p-4 overflow-hidden"
                          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.2)' }}
                        >
                          <p className="text-[10px] uppercase tracking-widest text-gold-gradient font-bold mb-3">
                            ✦ Assign Teams — click a player to switch their team
                          </p>

                          {/* Team name inputs */}
                          <div className="grid grid-cols-2 gap-3 mb-4">
                            {(['team1', 'team2'] as const).map(tk => (
                              <div key={tk}>
                                <label className="text-[9px] uppercase tracking-wider text-emerald-100/40 block mb-1">
                                  {tk === 'team1' ? '🟢 Team 1 Name' : '🔵 Team 2 Name'}
                                </label>
                                <input
                                  value={teamNames[tk]}
                                  onChange={e => setTeamNames(prev => ({ ...prev, [tk]: e.target.value }))}
                                  className="input-premium w-full px-2.5 py-1.5 rounded-lg text-xs"
                                  maxLength={20}
                                />
                              </div>
                            ))}
                          </div>

                          {/* Players grouped by team */}
                          <div className="grid grid-cols-2 gap-2 mb-4">
                            {([1, 2] as const).map(t => (
                              <div key={t} className="rounded-lg p-2.5" style={{ background: t === 1 ? 'rgba(22,48,32,0.5)' : 'rgba(15,30,60,0.5)', border: `1px solid ${t === 1 ? 'rgba(22,160,133,0.25)' : 'rgba(59,130,246,0.25)'}` }}>
                                <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${t === 1 ? 'text-emerald-400' : 'text-blue-400'}`}>
                                  {t === 1 ? teamNames.team1 : teamNames.team2}
                                </div>
                                {players.filter(pid => {
                                  const det = playerDetails.find(p => p.id === pid);
                                  return det ? det.team === t : t === (players.indexOf(pid) % 2 === 0 ? 1 : 2);
                                }).map(pid => (
                                  <button
                                    key={pid}
                                    onClick={() => togglePlayerTeam(pid)}
                                    className="w-full text-left px-2 py-1 rounded text-xs font-semibold mb-1 transition-all hover:brightness-125 cursor-pointer"
                                    style={{ background: pid === userId ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.05)', color: pid === userId ? '#d4af37' : '#f5f0e8', border: '1px solid rgba(255,255,255,0.07)', minHeight: '28px' }}
                                    title="Click to move to other team"
                                  >
                                    {pid === userId ? '⭐ You' : pid.startsWith('Bot_') ? `🤖 ${pid}` : pid} ↔
                                  </button>
                                ))}
                                {players.filter(pid => {
                                  const det = playerDetails.find(p => p.id === pid);
                                  return det ? det.team === t : t === (players.indexOf(pid) % 2 === 0 ? 1 : 2);
                                }).length === 0 && (
                                  <div className="text-[10px] text-emerald-100/30 italic">Empty</div>
                                )}
                              </div>
                            ))}
                          </div>

                          <button
                            onClick={() => { applyTeams(); setShowTeamEdit(false); }}
                            className="btn-gold w-full py-2 rounded-xl text-[10px] tracking-widest uppercase"
                            disabled={players.length !== 4}
                          >
                            ✦ Apply Team Setup
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Default seat cards */}
                    <div className="grid grid-cols-2 gap-3">
                      {Array.from({ length: 4 }).map((_, i) => {
                        const player = players[i];
                        const isMe = player === userId;
                        const isBot = player?.startsWith('Bot_');
                        const detail = playerDetails.find(p => p.id === player);
                        const team = detail?.team ?? (i % 2 === 0 ? 1 : 2);
                        const teamLabel = team === 1 ? teamNames.team1 : teamNames.team2;
                        const teamColor = team === 1 ? '#4ade80' : '#60a5fa';
                        return (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.08 }}
                            className={`rounded-xl p-4 transition-all ${player ? (isMe ? 'seat-card mine' : 'seat-card occupied') : 'seat-card'}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                                style={{
                                  background: player ? (isMe ? 'rgba(212,175,55,0.3)' : 'rgba(22,48,32,0.6)') : 'rgba(0,0,0,0.3)',
                                  border: `1px solid ${player ? (isMe ? 'rgba(212,175,55,0.6)' : 'rgba(212,175,55,0.2)') : 'rgba(212,175,55,0.1)'}`,
                                }}
                              >
                                {player ? (isMe ? '⭐' : (isBot ? '🤖' : player.charAt(0).toUpperCase())) : (
                                  <span className="animate-pulse" style={{ color: 'rgba(245,240,232,0.2)' }}>?</span>
                                )}
                              </div>
                              <div>
                                <div className="text-sm font-semibold truncate max-w-[120px]" style={{ color: player ? (isMe ? '#d4af37' : '#f5f0e8') : 'rgba(245,240,232,0.2)' }}>
                                  {player ? (isMe ? 'You' : player) : 'Waiting...'}
                                </div>
                                <div className="text-xs mt-0.5 flex items-center gap-1">
                                  <span style={{ color: 'rgba(245,240,232,0.35)' }}>Seat {i + 1} ·</span>
                                  {player && <span className="font-semibold text-[10px]" style={{ color: teamColor }}>{teamLabel}</span>}
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>


                  {/* Progress bar */}
                  <div className="mb-5">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: 'linear-gradient(90deg, #d4af37, #f5d78e)' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(players.length / 4) * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                    <div className="text-xs mt-2 text-center" style={{ color: 'rgba(245,240,232,0.35)' }}>
                      {players.length === 4 ? '✓ All players ready!' : `${4 - players.length} more player${4 - players.length !== 1 ? 's' : ''} needed`}
                    </div>
                  </div>

                  {/* Start / wait */}
                  {isHost ? (
                    <motion.button
                      whileTap={players.length === 4 ? { scale: 0.97 } : undefined}
                      onClick={startGame}
                      disabled={players.length < 4}
                      className={`w-full py-4 rounded-xl text-sm tracking-widest uppercase font-display font-bold transition-all cursor-pointer ${
                        players.length === 4 ? 'btn-gold animate-glow-pulse' : 'cursor-not-allowed'
                      }`}
                      style={players.length < 4 ? { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.15)', color: 'rgba(245,240,232,0.3)' } : {}}
                    >
                      {players.length === 4 ? '✦ Begin the Game' : `⏳ Waiting for players (${players.length}/4)`}
                    </motion.button>
                  ) : (
                    <div className="text-center py-4 text-sm" style={{ color: 'rgba(245,240,232,0.4)' }}>
                      <div className="animate-pulse mb-1">⏳</div>
                      Waiting for the host to start the game...
                    </div>
                  )}

                  <p className="text-center text-xs mt-4" style={{ color: 'rgba(245,240,232,0.25)' }}>
                    Share code <span className="font-mono font-bold" style={{ color: 'rgba(212,175,55,0.6)' }}>{lobbyCode}</span> with friends
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,175,55,0.2), transparent)' }} />
        </div>
      </motion.div>
    </div>
  );
}