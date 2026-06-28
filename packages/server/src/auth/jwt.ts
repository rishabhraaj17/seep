import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production');
  }
  console.warn('[WARNING] JWT_SECRET not set — using insecure dev default. Never run this in production.');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || '__dev_only_insecure_secret__';
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
    EFFECTIVE_JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET) as jwt.JwtPayload;
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