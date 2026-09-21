import http from 'http';
import https from 'https';
import { URL, fileURLToPath } from 'url';
import type { Duplex } from 'stream';

export interface WebRelayConfig {
  openclawUpstream: string;
  omnirouteUpstream: string;
  llamaUpstream: string;
  port?: number;
}

function rewriteLocation(loc: string, target: URL, prefix: string): string {
  try {
    if (loc.startsWith('http://') || loc.startsWith('https://')) {
      const parsed = new URL(loc);
      if (parsed.origin === target.origin || parsed.hostname === target.hostname) {
        const p = parsed.pathname + parsed.search + parsed.hash;
        if (prefix && !p.startsWith(prefix)) {
          return `${prefix}${p.startsWith('/') ? '' : '/'}${p}`;
        }
        return p;
      }
      return loc;
    }
    if (prefix && !loc.startsWith(prefix)) {
      return `${prefix}${loc.startsWith('/') ? '' : '/'}${loc}`;
    }
    return loc;
  } catch {
    return loc;
  }
}

export function createWebRelayServer(config: WebRelayConfig): http.Server {
  const openclawUrl = config.openclawUpstream ? new URL(config.openclawUpstream) : undefined;
  const omnirouteUrl = config.omnirouteUpstream ? new URL(config.omnirouteUpstream) : undefined;
  const llamaUrl = config.llamaUpstream ? new URL(config.llamaUpstream) : undefined;

  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    // Universal CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const rawUrl = req.url || '/';

    // Health / Ping Route
    if (rawUrl === '/health' || rawUrl === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        upstreams: {
          openclaw: config.openclawUpstream,
          omniroute: config.omnirouteUpstream,
          llama: config.llamaUpstream
        }
      }));
      return;
    }

    // Determine target upstream
    let targetUrl: URL | undefined;
    let forwardPath = rawUrl;
    let servicePrefix = '';

    if (rawUrl.startsWith('/omniroute')) {
      targetUrl = omnirouteUrl;
      forwardPath = rawUrl.replace(/^\/omniroute/, '') || '/';
      servicePrefix = '/omniroute';
    } else if (rawUrl.startsWith('/llama')) {
      targetUrl = llamaUrl;
      forwardPath = rawUrl.replace(/^\/llama/, '') || '/';
      servicePrefix = '/llama';
    } else if (rawUrl.startsWith('/openclaw')) {
      targetUrl = openclawUrl;
      forwardPath = rawUrl.replace(/^\/openclaw/, '') || '/';
      servicePrefix = '/openclaw';
    } else {
      const referer = (req.headers['referer'] as string) || '';
      if (referer.includes('/omniroute')) {
        targetUrl = omnirouteUrl;
        forwardPath = rawUrl;
        servicePrefix = '/omniroute';
      } else if (referer.includes('/llama')) {
        targetUrl = llamaUrl;
        forwardPath = rawUrl;
        servicePrefix = '/llama';
      } else if (referer.includes('/openclaw')) {
        targetUrl = openclawUrl;
        forwardPath = rawUrl;
        servicePrefix = '/openclaw';
      } else {
        // Default root to OpenClaw
        targetUrl = openclawUrl;
        forwardPath = rawUrl;
        servicePrefix = '';
      }
    }

    if (!targetUrl) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream service not configured' }));
      return;
    }

    const isTls = targetUrl.protocol === 'https:';
    const transport = isTls ? https : http;
    const defaultPort = isTls ? 443 : 80;

    const reqHeaders: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: targetUrl.hostname
    };
    delete reqHeaders['connection'];
    if (reqHeaders['origin']) {
      reqHeaders['origin'] = `${targetUrl.protocol}//${targetUrl.host}`;
    }

    const options: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port ? parseInt(targetUrl.port, 10) : defaultPort,
      path: forwardPath,
      method: req.method,
      headers: reqHeaders
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      const respHeaders = { ...proxyRes.headers };
      respHeaders['access-control-allow-origin'] = '*';
      respHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
      respHeaders['access-control-allow-headers'] = '*';

      if (proxyRes.headers.location) {
        const rawLoc = Array.isArray(proxyRes.headers.location)
          ? proxyRes.headers.location[0]
          : proxyRes.headers.location;
        if (rawLoc) {
          respHeaders['location'] = rewriteLocation(rawLoc, targetUrl!, servicePrefix);
        }
      }

      res.writeHead(proxyRes.statusCode || 502, respHeaders);
      proxyRes.pipe(res);
    });

    // Zero timeout for LLM token streaming
    proxyReq.setTimeout(0);

    proxyReq.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Bad Gateway: failed to reach upstream',
          target: targetUrl?.hostname,
          details: err.message
        }));
      }
    });

    req.pipe(proxyReq);
  });

  // Universal WebSocket Upgrade Proxy
  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const rawUrl = req.url || '/';
    let targetUrl: URL | undefined;
    let forwardPath = rawUrl;

    if (rawUrl.startsWith('/omniroute')) {
      targetUrl = omnirouteUrl;
      forwardPath = rawUrl.replace(/^\/omniroute/, '') || '/';
    } else if (rawUrl.startsWith('/llama')) {
      targetUrl = llamaUrl;
      forwardPath = rawUrl.replace(/^\/llama/, '') || '/';
    } else if (rawUrl.startsWith('/openclaw')) {
      targetUrl = openclawUrl;
      forwardPath = rawUrl.replace(/^\/openclaw/, '') || '/';
    } else {
      const referer = (req.headers['referer'] as string) || '';
      if (referer.includes('/omniroute')) {
        targetUrl = omnirouteUrl;
        forwardPath = rawUrl;
      } else if (referer.includes('/llama')) {
        targetUrl = llamaUrl;
        forwardPath = rawUrl;
      } else {
        targetUrl = openclawUrl;
        forwardPath = rawUrl;
      }
    }

    if (!targetUrl) {
      socket.destroy();
      return;
    }

    const isTls = targetUrl.protocol === 'https:';
    const transport = isTls ? https : http;
    const defaultPort = isTls ? 443 : 80;

    const reqHeaders: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: targetUrl.hostname
    };
    if (reqHeaders['origin']) {
      reqHeaders['origin'] = `${targetUrl.protocol}//${targetUrl.host}`;
    }

    const options: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port ? parseInt(targetUrl.port, 10) : defaultPort,
      path: forwardPath,
      method: 'GET',
      headers: reqHeaders
    };

    const proxyReq = transport.request(options);
    proxyReq.setTimeout(0);

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => Array.isArray(v) ? v.map(vi => `${k}: ${vi}`).join('\r\n') : `${k}: ${v}`)
          .join('\r\n') +
        `\r\n\r\n`
      );
      if (proxyHead && proxyHead.length) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
      proxySocket.on('close', () => socket.destroy());
      socket.on('close', () => proxySocket.destroy());
    });

    proxyReq.on('error', () => {
      socket.destroy();
    });

    proxyReq.end();
  });

  server.setTimeout(0);
  return server;
}

// Direct execution in Node / Railway container
const isMainModule = (): boolean => {
  if (typeof process !== 'undefined' && process.argv && process.argv[1]) {
    try {
      const currentPath = fileURLToPath(import.meta.url).replace(/\\/g, '/').toLowerCase();
      const execPath = process.argv[1].replace(/\\/g, '/').toLowerCase();
      return currentPath === execPath;
    } catch {
      return false;
    }
  }
  return false;
};

if (isMainModule()) {
  const port = parseInt(process.env.PORT || '8080', 10);
  const openclawUpstream = process.env.OPENCLAW_UPSTREAM || 'http://127.0.0.1:18789';
  const omnirouteUpstream = process.env.OMNIROUTE_UPSTREAM || 'http://127.0.0.1:20128';
  const llamaUpstream = process.env.LLAMA_UPSTREAM || 'http://127.0.0.1:8080';

  const srv = createWebRelayServer({
    openclawUpstream,
    omnirouteUpstream,
    llamaUpstream,
    port
  });

  srv.listen(port, '0.0.0.0', () => {
    console.log(`OpenClaw Unified Web Relay listening on 0.0.0.0:${port}`);
    console.log(`  • OpenClaw  (/openclaw) -> ${openclawUpstream}`);
    console.log(`  • OmniRoute (/omniroute) -> ${omnirouteUpstream}`);
    console.log(`  • Llama     (/llama)     -> ${llamaUpstream}`);
  });
}
