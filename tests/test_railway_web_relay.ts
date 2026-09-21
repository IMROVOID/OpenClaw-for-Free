import assert from 'assert';
import http from 'http';
import { createWebRelayServer } from '../relay/railway-web-relay/server.js';

console.log('--- Running test: Railway Web Relay Server ---');

async function testWebRelay() {
  // 1. Setup mock upstreams for OpenClaw, OmniRoute, and Llama
  let openclawHit = false;
  let omnirouteHit = false;
  let llamaHit = false;

  let lastOpenclawOrigin = '';
  const mockOpenclaw = http.createServer((req, res) => {
    openclawHit = true;
    lastOpenclawOrigin = (req.headers['origin'] as string) || '';
    if (req.url === '/redirect-test') {
      res.writeHead(302, { 'Location': 'http://127.0.0.1:19001/chat' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'openclaw', url: req.url }));
  });

  const mockOmniroute = http.createServer((req, res) => {
    omnirouteHit = true;
    if (req.url === '/login') {
      res.writeHead(302, { 'Location': '/dashboard' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'omniroute', url: req.url }));
  });

  const mockLlama = http.createServer((req, res) => {
    llamaHit = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'llama', url: req.url }));
  });

  await new Promise<void>((resolve) => mockOpenclaw.listen(19001, '127.0.0.1', () => resolve()));
  await new Promise<void>((resolve) => mockOmniroute.listen(19002, '127.0.0.1', () => resolve()));
  await new Promise<void>((resolve) => mockLlama.listen(19003, '127.0.0.1', () => resolve()));

  // 2. Start Web Relay Proxy
  const relayServer = createWebRelayServer({
    openclawUpstream: 'http://127.0.0.1:19001',
    omnirouteUpstream: 'http://127.0.0.1:19002',
    llamaUpstream: 'http://127.0.0.1:19003'
  });

  const RELAY_PORT = 19000;
  await new Promise<void>((resolve) => relayServer.listen(RELAY_PORT, '127.0.0.1', () => resolve()));

  try {
    // Test Health Endpoint
    const healthRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/health`);
    const healthData = (await healthRes.json()) as { status: string; upstreams: { openclaw: string } };
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthData.status, 'ok');
    assert.strictEqual(healthData.upstreams.openclaw, 'http://127.0.0.1:19001');
    console.log('[PASS] Test 1: Health endpoint returns 200 OK with upstreams');

    // Test OpenClaw route (/openclaw/*)
    const ocRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/openclaw/api/status`);
    const ocData = (await ocRes.json()) as { service: string };
    assert.strictEqual(ocData.service, 'openclaw');
    assert.strictEqual(openclawHit, true);
    console.log('[PASS] Test 2: /openclaw/* routed to OpenClaw upstream');

    // Test OmniRoute route (/omniroute/*)
    const orRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/omniroute/dashboard`);
    const orData = (await orRes.json()) as { service: string };
    assert.strictEqual(orData.service, 'omniroute');
    assert.strictEqual(omnirouteHit, true);
    console.log('[PASS] Test 3: /omniroute/* routed to OmniRoute upstream');

    // Test Llama route (/llama/*)
    const lmRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/llama/health`);
    const lmData = (await lmRes.json()) as { service: string };
    assert.strictEqual(lmData.service, 'llama');
    assert.strictEqual(llamaHit, true);
    console.log('[PASS] Test 4: /llama/* routed to Llama upstream');

    // Test CORS headers
    const corsRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/health`, { method: 'OPTIONS' });
    assert.strictEqual(corsRes.status, 204);
    assert.strictEqual(corsRes.headers.get('access-control-allow-origin'), '*');
    console.log('[PASS] Test 5: CORS OPTIONS request handled with 204');

    // Test Location header rewriting for OmniRoute relative redirect
    const orRedirectRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/omniroute/login`, { redirect: 'manual' });
    assert.strictEqual(orRedirectRes.status, 302);
    assert.strictEqual(orRedirectRes.headers.get('location'), '/omniroute/dashboard');
    console.log('[PASS] Test 6: /omniroute relative redirect rewritten to /omniroute/dashboard');

    // Test Location header rewriting for OpenClaw absolute redirect
    const ocRedirectRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/openclaw/redirect-test`, { redirect: 'manual' });
    assert.strictEqual(ocRedirectRes.status, 302);
    assert.strictEqual(ocRedirectRes.headers.get('location'), '/openclaw/chat');
    console.log('[PASS] Test 7: /openclaw absolute redirect rewritten to /openclaw/chat without domain leak');

    // Test Referer-based subresource routing
    omnirouteHit = false;
    openclawHit = false;
    const assetRes = await fetch(`http://127.0.0.1:${RELAY_PORT}/assets/app.js`, {
      headers: { 'referer': `http://127.0.0.1:${RELAY_PORT}/omniroute/dashboard` }
    });
    const assetData = (await assetRes.json()) as { service: string };
    assert.strictEqual(assetData.service, 'omniroute');
    assert.strictEqual(omnirouteHit, true);
    assert.strictEqual(openclawHit, false);
    console.log('[PASS] Test 8: Subresource with /omniroute Referer correctly routed to OmniRoute');

    // Test Origin header rewritten to upstream origin
    await fetch(`http://127.0.0.1:${RELAY_PORT}/openclaw/api/test`, {
      headers: { 'origin': 'https://openclaw-relay.up.railway.app' }
    });
    assert.strictEqual(lastOpenclawOrigin, 'http://127.0.0.1:19001');
    console.log('[PASS] Test 9: Client Origin rewritten to upstream origin');

  } finally {
    await Promise.all([
      new Promise((res) => { (relayServer as any).closeAllConnections?.(); relayServer.close(res); }),
      new Promise((res) => { (mockOpenclaw as any).closeAllConnections?.(); mockOpenclaw.close(res); }),
      new Promise((res) => { (mockOmniroute as any).closeAllConnections?.(); mockOmniroute.close(res); }),
      new Promise((res) => { (mockLlama as any).closeAllConnections?.(); mockLlama.close(res); })
    ]);
  }
}

testWebRelay()
  .then(() => {
    console.log('[PASS] All Railway Web Relay tests passed successfully!\n');
  })
  .catch((err) => {
    console.error('✘ Test failed:', err);
    process.exit(1);
  });
