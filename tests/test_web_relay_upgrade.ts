import assert from 'assert';
import http from 'http';
import net from 'net';
import { createWebRelayServer } from '../relay/railway-web-relay/server.js';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';

console.log('--- Running test: Railway Web Relay WebSocket Upgrade & Gateway Token Sync ---');

async function testWebRelayUpgradeAndToken() {
  let upstreamUpgradeReceived = false;
  let receivedHost = '';

  // 1. Mock upstream OpenClaw server with WebSocket upgrade support
  const mockOpenclaw = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end('http ok');
  });

  mockOpenclaw.on('upgrade', (req, socket) => {
    upstreamUpgradeReceived = true;
    receivedHost = req.headers['host'] || '';
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n'
    );
    socket.write('OPENCLAW_READY');
    socket.on('error', () => {});
    socket.on('close', () => socket.destroy());
  });

  const UPSTREAM_PORT = 19101;
  const RELAY_PORT = 19100;

  await new Promise<void>((resolve) => mockOpenclaw.listen(UPSTREAM_PORT, '127.0.0.1', () => resolve()));

  // 2. Start Web Relay Proxy
  const relayServer = createWebRelayServer({
    openclawUpstream: `http://127.0.0.1:${UPSTREAM_PORT}`,
    omnirouteUpstream: `http://127.0.0.1:${UPSTREAM_PORT}`,
    llamaUpstream: `http://127.0.0.1:${UPSTREAM_PORT}`
  });

  await new Promise<void>((resolve) => relayServer.listen(RELAY_PORT, '127.0.0.1', () => resolve()));

  try {
    // 3. Test WebSocket Upgrade over /openclaw
    const clientSocket = net.connect(RELAY_PORT, '127.0.0.1');

    const upgradeResponse = await new Promise<string>((resolve, reject) => {
      let data = '';
      clientSocket.on('connect', () => {
        clientSocket.write(
          'GET /openclaw/?token=test-token-123 HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${RELAY_PORT}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      clientSocket.on('data', (chunk) => {
        data += chunk.toString('utf-8');
        if (data.includes('OPENCLAW_READY') || data.includes('101 Switching Protocols')) {
          resolve(data);
        }
      });
      clientSocket.on('error', reject);
    });

    assert.strictEqual(upstreamUpgradeReceived, true);
    assert.strictEqual(receivedHost, '127.0.0.1');
    assert(upgradeResponse.includes('101 Switching Protocols'), 'Response should include 101 Switching Protocols');
    assert(upgradeResponse.includes('OPENCLAW_READY'), 'Response should stream upstream socket data');
    console.log('[PASS] Test 1: WebSocket upgrade request successfully proxied to upstream OpenClaw');

    clientSocket.destroy();

    // 4. Test VpsConfigDetector parsing of OC_TOKEN
    const sampleOutput = [
      'OC_BIN:/usr/local/bin/openclaw',
      'OC_CONF:/home/daytona/.openclaw/openclaw.json',
      'OC_TOKEN:64477d7110f8fe4c1b089704ad69067bc06c8032371f430d',
      'TG_TOKEN:12345678:ABCDEF-ghijklmn_opqrstuvwxyz12345',
      'DC_TOKEN:',
      'DC_GUILD:',
      'OR_BIN:/usr/local/bin/omniroute',
      'OR_DIR:/home/daytona/.omniroute',
      'OR_ACTIVE:YES',
      'XRAY_CONF:/home/daytona/.xray/config.json',
      'XRAY_ACTIVE:YES',
      'RW_DOMAIN:openclaw-relay.up.railway.app',
      'RW_UUID:d4b8e21a-79f1-4320-a612-4c5386f91f7a',
      'LLAMA_INST:YES',
      'LLAMA_RUN:YES',
      'LL_TOP:same_vm',
      'LL_URL:http://127.0.0.1:8080',
      'LL_MOD:qwen2.5-7b',
      'LL_MODEL_PATH:/home/daytona/models/qwen2.5-7b.gguf',
      'LL_MODEL_FILE:qwen2.5-7b.gguf',
      'LL_MODEL_NAME:Qwen 2.5 7B MTP',
      'LL_MODEL_SIZE:4.2G'
    ].join('\n');

    const detected = VpsConfigDetector.parseProbeOutput(sampleOutput, true);
    assert.strictEqual(detected.openclawInstalled, true);
    assert.strictEqual(detected.openclawToken, '64477d7110f8fe4c1b089704ad69067bc06c8032371f430d');
    assert.strictEqual(detected.omnirouteActive, true);
    assert.strictEqual(detected.railwayDomain, 'openclaw-relay.up.railway.app');
    console.log('[PASS] Test 2: VpsConfigDetector correctly parsed OpenClaw token and Relay domain');

  } finally {
    try {
      (relayServer as any).closeAllConnections?.();
      (mockOpenclaw as any).closeAllConnections?.();
      relayServer.close();
      mockOpenclaw.close();
    } catch (_) {}
  }
}

testWebRelayUpgradeAndToken()
  .then(() => {
    console.log('[PASS] All Web Relay Upgrade & Token tests passed successfully!\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('✘ Test failed:', err);
    process.exit(1);
  });
