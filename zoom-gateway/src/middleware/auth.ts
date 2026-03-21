import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * Validates the x-internal-token header against INTERNAL_SERVICE_SECRET.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function requireInternalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = req.headers['x-internal-token'];

  if (typeof token !== 'string') {
    res.status(401).json({ error: 'Missing x-internal-token header' });
    return;
  }

  try {
    const tokenBuf = Buffer.from(token, 'utf8');
    const secretBuf = Buffer.from(config.internalServiceSecret, 'utf8');

    if (
      tokenBuf.length !== secretBuf.length ||
      !timingSafeEqual(tokenBuf, secretBuf)
    ) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * Validates the `token` query-param for WebSocket upgrade requests.
 * Returns true if valid, false otherwise.
 */
export function isValidWsToken(token: string | null): boolean {
  if (!token) return false;
  try {
    const tokenBuf = Buffer.from(token, 'utf8');
    const secretBuf = Buffer.from(config.internalServiceSecret, 'utf8');
    return (
      tokenBuf.length === secretBuf.length &&
      timingSafeEqual(tokenBuf, secretBuf)
    );
  } catch {
    return false;
  }
}
