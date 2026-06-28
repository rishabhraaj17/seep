import { useState, useEffect } from 'react';
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
  const [_token, setToken] = useState<string>('');

  useEffect(() => {
    if (!socket && screen !== 'login') {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3002';
      const s = io(serverUrl);
      setSocket(s);

      s.on('connect', () => {
        console.log('Connected to server');
      });

      s.on('connect_error', () => {
        console.error('Failed to connect to server');
      });

      return () => {
        s.close();
      };
    }
  }, [screen, socket]);

  const handleLogin = (id: string, authToken: string) => {
    setUserId(id);
    setToken(authToken);
    setScreen('lobby');
  };

  return (
    <>
      {screen === 'login' && <LoginScreen onLogin={handleLogin} />}
      {screen === 'lobby' && socket && (
        <LobbyScreen socket={socket} userId={userId} onJoinGame={() => setScreen('game')} />
      )}
      {screen === 'game' && socket && (
        <GameScreen socket={socket} userId={userId} />
      )}
    </>
  );
}

export default App;