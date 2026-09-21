import assert from 'assert';
import http from 'http';
import { WebIngressDeployer, RailwayWebRelayDeployOptions } from '../src/control-panel/core/webIngressDeployer.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';
import { RailwayDomainManager } from '../src/control-panel/core/railwayDomainManager.js';

console.log('--- Running test: Railway Web Ingress Deployer & Health Checks ---');

async function runTests(): Promise<void> {
  // 1. Test buildDaytonaUpstreams
  const upstreams1 = WebIngressDeployer.buildDaytonaUpstreams('ws-prim-123', 'ws-sec-456');
  assert.strictEqual(upstreams1.openclaw, 'https://18789-ws-prim-123.proxy.daytona.work');
  assert.strictEqual(upstreams1.omniroute, 'https://20128-ws-prim-123.proxy.daytona.work');
  assert.strictEqual(upstreams1.llama, 'https://8080-ws-sec-456.proxy.daytona.work');

  // Single VM topology (no secondary workspace)
  const upstreams2 = WebIngressDeployer.buildDaytonaUpstreams('ws-prim-123');
  assert.strictEqual(upstreams2.openclaw, 'https://18789-ws-prim-123.proxy.daytona.work');
  assert.strictEqual(upstreams2.llama, 'https://8080-ws-prim-123.proxy.daytona.work');

  // Missing workspace IDs fallback to localhost
  const upstreams3 = WebIngressDeployer.buildDaytonaUpstreams();
  assert.strictEqual(upstreams3.openclaw, 'http://127.0.0.1:18789');
  assert.strictEqual(upstreams3.omniroute, 'http://127.0.0.1:20128');
  assert.strictEqual(upstreams3.llama, 'http://127.0.0.1:8080');
  console.log('[PASS] Test 1: buildDaytonaUpstreams constructs correct preview URLs');

  // 2. Test deployRailwayWebRelay validation
  const invalidRes1 = await WebIngressDeployer.deployRailwayWebRelay({
    apiKey: '',
    domain: 'my-relay.up.railway.app'
  });
  assert.strictEqual(invalidRes1.success, false);
  assert.ok(invalidRes1.message.includes('API token is required'));

  const invalidRes2 = await WebIngressDeployer.deployRailwayWebRelay({
    apiKey: 'mock-token',
    domain: ''
  });
  assert.strictEqual(invalidRes2.success, false);
  assert.ok(invalidRes2.message.includes('Domain is required'));
  console.log('[PASS] Test 2: deployRailwayWebRelay input validation');

  // 3. Test deployRailwayWebRelay execution with mocked runner
  let executedCmds: Array<{ cmd: string; args: string[]; env: Record<string, string> }> = [];
  const origRunner = WebIngressDeployer.execCliCommand;
  WebIngressDeployer.execCliCommand = async (cmd: string, args: string[], env: Record<string, string>) => {
    executedCmds.push({ cmd, args, env });
    return { code: 0, stdout: 'Deploy initiated', stderr: '' };
  };

  try {
    const deployOpts: RailwayWebRelayDeployOptions = {
      apiKey: 'test-railway-token',
      domain: 'https://openclaw-relay.up.railway.app/',
      upstreams: {
        openclaw: 'https://18789-test-ws.proxy.daytona.work',
        omniroute: 'https://20128-test-ws.proxy.daytona.work',
        llama: 'https://8080-test-ws.proxy.daytona.work'
      }
    };

    const res = await WebIngressDeployer.deployRailwayWebRelay(deployOpts);
    if (!res.success) console.log('Deploy result error:', res);
    assert.strictEqual(res.success, true);
    assert.ok(executedCmds.length >= 2, 'Should execute variables and up/domain commands');

    // Verify token was passed in env
    const varCmd = executedCmds.find(c => c.args.includes('variable') || c.args.includes('variables'));
    assert.ok(varCmd, 'Should run railway variables command');
    assert.strictEqual(varCmd.env.RAILWAY_API_TOKEN, 'test-railway-token');
    assert.ok(varCmd.args.some(a => a.includes('OPENCLAW_UPSTREAM=https://18789-test-ws.proxy.daytona.work')));

    const upCmd = executedCmds.find(c => c.args.includes('up'));
    assert.ok(upCmd, 'Should run railway up command');
    assert.strictEqual(upCmd.env.RAILWAY_API_TOKEN, 'test-railway-token');

    // 3b. Test deployRailwayWebRelay redeployment with same existing domain
    const origCheckAvail = RailwayDomainManager.checkDomainAvailability;
    RailwayDomainManager.checkDomainAvailability = async () => ({
      available: false,
      isUserOwned: true,
      isOccupied: false,
      domain: 'openclaw-relay.up.railway.app',
      subdomain: 'openclaw-relay',
      message: 'Domain already belongs to your Railway account'
    });

    const redeployRes = await WebIngressDeployer.deployRailwayWebRelay(deployOpts);
    assert.strictEqual(redeployRes.success, true);
    console.log('[PASS] Test 3b: deployRailwayWebRelay allows redeployment to existing user-owned domain');

    // 3c. Test deployRailwayWebRelay with forceRedeploy when domain is reported occupied
    RailwayDomainManager.checkDomainAvailability = async () => ({
      available: false,
      isUserOwned: false,
      isOccupied: true,
      domain: 'openclaw-relay.up.railway.app',
      subdomain: 'openclaw-relay',
      message: 'Domain is taken'
    });

    const forceRedeployRes = await WebIngressDeployer.deployRailwayWebRelay({
      ...deployOpts,
      forceRedeploy: true
    });
    assert.strictEqual(forceRedeployRes.success, true);
    console.log('[PASS] Test 3c: deployRailwayWebRelay allows redeployment when forceRedeploy is true despite occupied check');
    RailwayDomainManager.checkDomainAvailability = origCheckAvail;
  } finally {
    WebIngressDeployer.execCliCommand = origRunner;
  }
  console.log('[PASS] Test 3: deployRailwayWebRelay invokes Railway CLI with correct variables');

  // 4. Test RailwayHelper.checkRelayDomain with probePath
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.url === '/not-found') {
      res.writeHead(404, { 'Content-Type': 'application/json', 'x-railway-fallback': 'true' });
      res.end(JSON.stringify({ status: 'error', code: 404, message: 'Application not found' }));
    } else {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Gateway' }));
    }
  });

  const TEST_PORT = 19123;
  await new Promise<void>((resolve) => mockServer.listen(TEST_PORT, '127.0.0.1', () => resolve()));

  try {
    const checkOk = await RailwayHelper.checkRelayDomain(`http://127.0.0.1:${TEST_PORT}`, 3000, '/health');
    assert.strictEqual(checkOk.reachable, true);
    assert.strictEqual(checkOk.statusCode, 200);

    const check404 = await RailwayHelper.checkRelayDomain(`http://127.0.0.1:${TEST_PORT}`, 3000, '/not-found');
    assert.strictEqual(check404.reachable, false);
    assert.strictEqual(check404.statusCode, 404);
    assert.ok(check404.message?.includes('404'));

    const check502 = await RailwayHelper.checkRelayDomain(`http://127.0.0.1:${TEST_PORT}`, 3000, '/');
    assert.strictEqual(check502.reachable, false);
    assert.strictEqual(check502.statusCode, 502);
  } finally {
    await new Promise<void>((resolve) => {
      (mockServer as any).closeAllConnections?.();
      mockServer.close(() => resolve());
    });
  }
  console.log('[PASS] Test 4: checkRelayDomain supports probePath and status classification');
}

runTests().then(() => {
  console.log('[PASS] All Railway Web Ingress Deployer tests passed!\n');
}).catch((err) => {
  console.error('✘ Test failed:', err);
  process.exit(1);
});
