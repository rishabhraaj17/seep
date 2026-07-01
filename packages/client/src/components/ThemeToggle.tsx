import { useEffect, useState } from 'react';
import { getTheme, toggleTheme, subscribeToTheme, type Theme } from '../theme';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>(getTheme());

  useEffect(() => subscribeToTheme(setThemeState), []);

  return (
    <button
      onClick={toggleTheme}
      className={`theme-toggle ${className}`}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to day mode'}
      aria-label="Toggle color theme"
    >
      <span className="text-sm">{theme === 'light' ? '🌙' : '☀️'}</span>
    </button>
  );
}
