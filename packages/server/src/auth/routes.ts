import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { generateToken, verifyToken } from './jwt.js';

const router = Router();

// In-memory user storage (use SQLite in production)
interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'player' | 'spectator';
}

const users = new Map<string, User>();

// Register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (users.has(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user: User = {
    id: Date.now().toString(),
    username,
    passwordHash,
    role: 'player', // Default role
  };

  users.set(username, user);

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  res.json({ token, user: { id: user.id, username, role: user.role } });
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  res.json({ token, user: { id: user.id, username, role: user.role } });
});

// Get current user (protected route)
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.json({ user: payload });
});

export default router;