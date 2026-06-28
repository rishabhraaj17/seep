import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

export type UserRole = 'admin' | 'player' | 'spectator';

export interface TokenPayload {
  userId: string;
  username: string;
  role: UserRole;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(
    {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    return {
      userId: decoded.userId as string,
      username: decoded.username as string,
      role: decoded.role as UserRole,
    };
  } catch {
    return null;
  }
}

// Role hierarchy for permission checks
export const ROLE_WEIGHTS: Record<UserRole, number> = {
  admin: 3,
  player: 2,
  spectator: 1,
};

export function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_WEIGHTS[userRole] >= ROLE_WEIGHTS[requiredRole];
}