import type { RequestHandler } from 'express';

const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const headers = new Set(['content-type']);

export function createOriginPolicy(allowedOrigin: string): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    const changing = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'CROSS_ORIGIN' });
    if (!origin && (changing || req.method === 'OPTIONS')) return res.status(403).json({ error: 'CROSS_ORIGIN' });

    if (origin) {
      res.vary('Origin');
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      const method = req.get('access-control-request-method')?.toUpperCase();
      const requestedHeaders = (req.get('access-control-request-headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if ((method && !methods.has(method)) || requestedHeaders.some(header => !headers.has(header))) return res.status(403).json({ error: 'CROSS_ORIGIN' });
      res.set('Access-Control-Allow-Methods', [...methods].join(', '));
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    next();
  };
}
