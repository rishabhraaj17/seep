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

// List all registered users (for admin panel / RBAC management)
router.get('/users', (req: any, res: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Convert users map to array, omit passwordHash
  const allUsers = Array.from(users.values()).map(u => ({
    id: u.id,
    username: u.username,
    role: u.role
  }));
  res.json({ users: allUsers });
});

// Change user role (accessible to admins, and also allows self-role change for testing)
router.post('/change-role', (req: any, res: any) => {
  const { username, role } = req.body;
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (!username || !role) {
    return res.status(400).json({ error: 'Username and role required' });
  }

  // Ensure role is valid
  if (!['admin', 'player', 'spectator'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // RBAC validation: Only admins can change other people's roles.
  // Anyone can change their own role (allows self-promotion for testing).
  const isSelf = payload.username === username;
  const isAdmin = payload.role === 'admin';

  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden: Insufficient permissions to change other users\' roles' });
  }

  const user = users.get(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.role = role;
  users.set(username, user);

  // Generate a new token if the user is changing their own role
  let newToken = undefined;
  if (isSelf) {
    newToken = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role
    });
  }

  res.json({
    message: `Role for ${username} updated to ${role}`,
    token: newToken,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

export default router;