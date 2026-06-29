import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface LoginScreenProps {
  onLogin: (userId: string, token: string, username: string, role: string) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const endpoint = isRegistering ? '/api/auth/register' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }
      localStorage.setItem('token', data.token);
      onLogin(
        data.user?.id || username,
        data.token,
        data.user?.username || username,
        data.user?.role || 'player'
      );
    } catch {
      setError('Connection error — is the server running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.06) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.04) 0%, transparent 70%)' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(22,48,32,0.8) 0%, transparent 70%)' }} />
      </div>

      {/* Floating card decorations */}
      <div className="absolute top-16 left-16 opacity-10 text-7xl select-none animate-float pointer-events-none" style={{ animationDelay: '0s' }}>♠</div>
      <div className="absolute top-24 right-20 opacity-10 text-6xl select-none animate-float pointer-events-none" style={{ animationDelay: '0.8s', color: '#c0392b' }}>♥</div>
      <div className="absolute bottom-20 left-20 opacity-10 text-6xl select-none animate-float pointer-events-none" style={{ animationDelay: '1.6s', color: '#c0392b' }}>♦</div>
      <div className="absolute bottom-16 right-16 opacity-10 text-7xl select-none animate-float pointer-events-none" style={{ animationDelay: '2.4s' }}>♣</div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Card */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          {/* Gold top bar */}
          <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, transparent, #d4af37, #f5d78e, #d4af37, transparent)' }} />

          <div className="p-8 sm:p-10">
            {/* Logo / Title */}
            <div className="text-center mb-8">
              <div className="text-6xl mb-3 select-none">🃏</div>
              <h1 className="font-display text-4xl sm:text-5xl font-bold text-gold-gradient mb-2">
                SEEP
              </h1>
              <p className="text-sm tracking-[0.3em] uppercase font-medium" style={{ color: 'rgba(212,175,55,0.6)' }}>
                Indian Card Game
              </p>
            </div>

            {/* Tab switcher */}
            <div className="flex rounded-xl p-1 mb-8" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.15)' }}>
              {['Login', 'Register'].map(tab => (
                <button
                  key={tab}
                  onClick={() => { setIsRegistering(tab === 'Register'); setError(''); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold font-display tracking-wide transition-all duration-200 ${
                    isRegistering === (tab === 'Register')
                      ? 'btn-gold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  style={{ minHeight: '36px' }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username */}
              <div>
                <label className="block text-xs font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'rgba(212,175,55,0.7)' }}>
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="input-premium w-full px-4 py-3 rounded-xl text-sm"
                  placeholder="Enter your username"
                  autoComplete="username"
                  required
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'rgba(212,175,55,0.7)' }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input-premium w-full px-4 py-3 rounded-xl text-sm"
                  placeholder="Enter your password"
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                  required
                />
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
                    style={{ background: 'rgba(139,26,26,0.3)', border: '1px solid rgba(192,57,43,0.4)', color: '#f1948a' }}
                  >
                    <span>⚠️</span>
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={loading}
                className="btn-gold w-full py-4 rounded-xl text-sm tracking-widest uppercase"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {isRegistering ? 'Creating Account...' : 'Signing In...'}
                  </span>
                ) : (
                  isRegistering ? '✦ Create Account' : '✦ Enter the Table'
                )}
              </motion.button>
            </form>

            {/* Divider */}
            <div className="my-6 divider-gold" />
            <p className="text-center text-xs" style={{ color: 'rgba(245,240,232,0.3)' }}>
              {isRegistering
                ? 'Joining as a new player. Enjoy the game!'
                : 'New to Seep? Switch to Register above.'}
            </p>
          </div>

          {/* Bottom gold bar */}
          <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)' }} />
        </div>

        {/* Reflection effect */}
        <div className="h-12 rounded-b-2xl mx-6 opacity-20"
          style={{
            background: 'linear-gradient(180deg, rgba(212,175,55,0.15) 0%, transparent 100%)',
            filter: 'blur(8px)',
            transform: 'scaleY(-1)',
            marginTop: '-2px'
          }}
        />
      </motion.div>
    </div>
  );
}