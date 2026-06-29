import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import LobbyScreen from './components/LobbyScreen';
import GameScreen from './components/GameScreen';
import LoginScreen from './components/LoginScreen';
import './index.css';

type Screen = 'login' | 'lobby' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [role, setRole] = useState<string>('player');
  const [lobbyCode, setLobbyCode] = useState<string>('');
  const socketRef = useRef<Socket | null>(null);

  // Cleanup socket on unmount
  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const handleLogin = (id: string, authToken: string, name: string, userRole: string) => {
    setUserId(id);
    setUsername(name);
    setRole(userRole);

    // Create socket immediately on login so it's ready when LobbyScreen mounts
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    const s = io(serverUrl, {
      auth: { token: authToken },
      reconnection: true,
    });

    s.on('connect', () => {
      console.log('Connected to server:', s.id);
    });

    s.on('connect_error', (err) => {
      console.error('Failed to connect to server:', err.message);
    });

    socketRef.current = s;
    setSocket(s);
    setScreen('lobby');
  };

  const handleLogout = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSocket(null);
    setUserId('');
    setUsername('');
    setRole('player');
    setLobbyCode('');
    localStorage.removeItem('token');
    setScreen('login');
  };

  // Callback to update local role (when self-promoting in profile settings)
  const handleRoleUpdate = (newRole: string, newToken?: string) => {
    setRole(newRole);
    if (newToken) {
      localStorage.setItem('token', newToken);
      // Reconnect socket with new token
      if (socketRef.current) {
        socketRef.current.disconnect();
        const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
        const s = io(serverUrl, {
          auth: { token: newToken },
          reconnection: true,
        });
        socketRef.current = s;
        setSocket(s);
      }
    }
  };

  return (
    <>
      {screen === 'login' && <LoginScreen onLogin={handleLogin} />}
      {screen === 'lobby' && socket && (
        <LobbyScreen
          socket={socket}
          userId={userId}
          username={username}
          role={role}
          onRoleUpdate={handleRoleUpdate}
          onLogout={handleLogout}
          onJoinGame={(code) => {
            setLobbyCode(code);
            setScreen('game');
          }}
        />
      )}
      {screen === 'game' && socket && (
        <GameScreen
          socket={socket}
          userId={userId}
          username={username}
          role={role}
          lobbyCode={lobbyCode}
          onLeaveGame={() => setScreen('lobby')}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}

export default App;