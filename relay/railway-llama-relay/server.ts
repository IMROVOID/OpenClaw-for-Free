import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface HealthResponse {
  status: string;
  target: string;
  uptime: number;
}

export interface ErrorResponse {
  error: {
    message: string;
    details?: string;
  };
}

const PORT: number = parseInt(process.env.PORT || '8080', 10);
const TARGET: string | undefined = process.env.TARGET_URL;

if (!TARGET) {
  console.error('[ERROR] TARGET_URL environment variable is required (e.g. https://8080-<sandbox-id>.proxy.daytona.work)');
  process.exit(1);
}

const targetUrl = new URL(TARGET);

console.log(`Starting Llama Relay on port ${PORT} -> ${TARGET}`);

export const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/ping') {
    const healthPayload: HealthResponse = {
      status: 'ok',
      target: TARGET,
      uptime: process.uptime()
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthPayload));
    return;
  }

  const options: https.RequestOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname
    }
  };

  if (options.headers) {
    delete options.headers['connection'];
  }

  const proxyReq = https.request(options, (proxyRes: http.IncomingMessage) => {
    const responseHeaders: http.OutgoingHttpHeaders = { ...proxyRes.headers };
    responseHeaders['access-control-allow-origin'] = '*';
    responseHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    responseHeaders['access-control-allow-headers'] = '*';

    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(0);

  proxyReq.on('error', (err: Error) => {
    console.error('Proxy request error:', err.message);
    if (!res.headersSent) {
      const errPayload: ErrorResponse = {
        error: {
          message: 'Bad Gateway: failed to reach Daytona upstream',
          details: err.message
        }
      };
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errPayload));
    }
  });

  req.pipe(proxyReq);
});

server.setTimeout(0);

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Llama Relay listening on 0.0.0.0:${PORT}`);
  });
}
