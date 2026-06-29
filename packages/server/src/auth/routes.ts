import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { generateToken, verifyToken } from './jwt.js';
import { pool } from '../db.js';

const router = Router();

// Register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const id = Date.now().toString();
    const passwordHash = await bcrypt.hash(password, 10);
    const role = 'player';

    await pool.query(
      'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
      [id, username, passwordHash, role]
    );

    const token = generateToken({ userId: id, username, role });
    res.json({ token, user: { id, username, role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ userId: user.id, username: user.username, role: user.role });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get current user details
router.get('/me', async (req, res) => {
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

// List all users for admin
router.get('/users', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const result = await pool.query('SELECT id, username, role FROM users ORDER BY username ASC');
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching users' });
  }
});

// Change user role
router.post('/change-role', async (req, res) => {
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

  if (!['admin', 'player', 'spectator'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const isSelf = payload.username === username;
  const isAdmin = payload.role === 'admin';

  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const userRes = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userRes.rows[0];
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);

    let newToken = undefined;
    if (isSelf) {
      newToken = generateToken({ userId: user.id, username: user.username, role });
    }

    res.json({
      message: `Role updated`,
      token: newToken,
      user: { id: user.id, username: user.username, role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating role' });
  }
});

export default router;