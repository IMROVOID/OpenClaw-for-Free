import assert from 'assert';
import http from 'http';
import { SshTunnelManager } from '../src/control-panel/core/sshTunnelManager.js';
import { MenuView } from '../src/control-panel/tui/menuView.js';
import { MenuActions, ActionContext } from '../src/control-panel/core/menuActions.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';
import { ControlPanelConfig, ServiceStatus } from '../src/control-panel/core/types.js';
import { DaytonaApi } from '../src/control-panel/core/daytonaApi.js';
import { FreestyleDriver } from '../src/control-panel/core/freestyleDriver.js';
import { FreestyleApi } from '../src/control-panel/core/freestyleApi.js';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { OnboardingFinalizer } from '../src/telegram-bot/handlers/onboardingFinalizer.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { BotContext } from '../src/telegram-bot/types.js';
import { VpsConfigDetector } from '../src/control-panel/core/vpsConfigDetector.js';

async function runTests() {
  console.log('--- Testing Existing Setup & Remote Llama Fixes ---');

  // Test 1: SshTunnelManager detects remote activeEndpointUrl
  console.log('Test 1: SshTunnelManager remote endpoint probe...');
  // Spin up a quick mock HTTP server to act as remote /health
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  const mockEndpoint = `http://127.0.0.1:${addr.port}/v1`;

  try {
    const configWithRemoteLlama: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      llamaPort: 59999, // Unbound local port
      llama: {
        ...DEFAULT_CONFIG.llama,
        enabled: true,
        isSeparateVps: true,
        activeEndpointUrl: mockEndpoint
      }
    };

    const tunnelMgr = new SshTunnelManager(configWithRemoteLlama);
    const tunnels = await tunnelMgr.checkTunnels();
    assert.strictEqual(tunnels.llamaActive, true, 'Remote endpoint responding to /health must mark llamaActive true');

    // Test 2: MenuView displays activeEndpointUrl when sshTarget is not set
    console.log('Test 2: MenuView header display...');
    const status: ServiceStatus = {
      primarySsh: true,
      openclaw: false,
      omniroute: false,
      llama: true,
      egressRelay: true
    };
    const rendered = MenuView.render(configWithRemoteLlama, status, 0, 90);
    const joined = rendered.lines.join('\n');
    assert(!joined.includes('Llama Daytona Target   : N/A'), 'MenuView must not show N/A when activeEndpointUrl is set');
    assert(joined.includes(mockEndpoint), `MenuView header must display the activeEndpointUrl (${mockEndpoint})`);

    // Test 3: MenuActions.openLlama uses remote endpoint when local tunnel is inactive
    console.log('Test 3: MenuActions.openLlama fallback to remote endpoint...');
    let openedUrl = '';
    const origOpenBrowser = SshTunnelManager.openBrowser;
    SshTunnelManager.openBrowser = (url: string) => { openedUrl = url; };

    let statusMsg = '';
    const actionCtx: ActionContext = {
      config: configWithRemoteLlama,
      status: { ...status, llama: false },
      tunnelMgr,
      setStatusMessage: (msg: string) => { statusMsg = msg; },
      render: () => {}
    };

    await MenuActions.openLlama(actionCtx);
    assert(openedUrl.startsWith(`http://127.0.0.1:${addr.port}`), `MenuActions must open remote endpoint URL, got ${openedUrl}`);
    assert(statusMsg.includes('[OK]'), 'Status message must be OK');
    SshTunnelManager.openBrowser = origOpenBrowser;

  } finally {
    server.close();
  }

  // Test 4: Deleted VM filtering in DaytonaApi
  console.log('Test 4: DaytonaApi filters deleted VMs...');
  const origDaytonaHttp = DaytonaApi.httpRequest;
  DaytonaApi.httpRequest = async () => ({
    statusCode: 200,
    body: JSON.stringify([
      { id: 'vm-active', name: 'active-sandbox', state: 'started', resources: { cpu: 2, memory: 4096, disk: 10 } },
      { id: 'vm-deleted-state', name: 'deleted-sandbox', state: 'deleted', resources: { cpu: 2, memory: 4096, disk: 10 } },
      { id: 'vm-deleted-flag', name: 'flagged-sandbox', isDeleted: true, resources: { cpu: 2, memory: 4096, disk: 10 } },
      { id: 'vm-deleted-at', name: 'at-sandbox', deletedAt: '2026-09-01T00:00:00Z', resources: { cpu: 2, memory: 4096, disk: 10 } },
      { id: 'vm-destroyed', name: 'destroyed-sandbox', status: 'destroyed', resources: { cpu: 2, memory: 4096, disk: 10 } }
    ])
  });

  const daytonaList = await DaytonaApi.listWorkspaces('test-key');
  assert.strictEqual(daytonaList.length, 1, 'Only non-deleted Daytona workspaces should be listed');
  assert.strictEqual(daytonaList[0].id, 'vm-active', 'Active sandbox must be returned');
  DaytonaApi.httpRequest = origDaytonaHttp;

  // Test 5: Deleted VM filtering in FreestyleDriver
  console.log('Test 5: FreestyleDriver filters deleted VMs...');
  const origFreestyleValidate = FreestyleApi.validateApiKey;
  FreestyleApi.validateApiKey = async () => ({
    valid: true,
    vms: [
      { id: 'vm-live', slug: 'live-vm', state: 'running', resources: { cpu: 4, memory: 8192, storage: 32768 } },
      { id: 'vm-terminated', slug: 'terminated-vm', state: 'terminated', resources: { cpu: 4, memory: 8192, storage: 32768 } },
      { id: 'vm-deleted-field', slug: 'deleted-vm', deleted: true, resources: { cpu: 4, memory: 8192, storage: 32768 } } as any
    ]
  });

  const freestyleDriver = new FreestyleDriver();
  const freestyleList = await freestyleDriver.listExistingWorkspaces('test-key');
  assert.strictEqual(freestyleList.length, 1, 'Only non-deleted Freestyle VMs should be listed');
  assert.strictEqual(freestyleList[0].id, 'vm-live', 'Live VM must be returned');
  FreestyleApi.validateApiKey = origFreestyleValidate;

  // Test 6: Telegram Bot Step 3 -> Step 4 Bot channel detection & keep option
  console.log('Test 6: Telegram Bot Step 4 existing channels...');
  const chatId = 778899;
  let lastText = '';
  let lastKb: any = null;

  const mockCtx: BotContext = {
    chat: { id: chatId },
    from: { id: chatId },
    config: { ...DEFAULT_CONFIG },
    callbackQuery: { id: 'cb', message: { message_id: 1 } },
    answerCallbackQuery: async () => true,
    api: {
      editMessageText: async (_c: number, _m: number, text: string, opts?: any) => {
        lastText = text;
        lastKb = opts?.reply_markup ?? null;
        return true;
      }
    }
  } as unknown as BotContext;

  const session = BotSessionManager.startOnboarding(chatId);
  session.onboardingDraft.primarySshTarget = 'ubuntu@1.2.3.4';
  session.onboardingDraft.provider = 'freestyle';

  // Mock VpsConfigDetector.inspect returning bot token and llama
  const origInspect = VpsConfigDetector.inspect;
  VpsConfigDetector.inspect = async () => ({
    reachable: true,
    openclawInstalled: true,
    omnirouteInstalled: true,
    telegramBotToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    discordBotToken: 'discord-test-token-1234567890',
    llamaInstalled: true,
    llamaRunning: true,
    llamaTopology: 'second_vm',
    llamaEndpoint: 'https://llama-relay-production.up.railway.app/v1',
    llamaModel: 'Qwen 2.5 7B MTP'
  } as any);

  await OnboardingHandler.advanceToStep3(mockCtx);

  // Check Step 3 stored detected in session userMemory
  assert(session.userMemory?.['onboarding:vm-detected'], 'Step 3 must cache detected VM config');
  assert(lastText.includes('Hardware Probe & Service Discovery'), 'Step 3 must announce service discovery');
  const step3Callbacks = (lastKb?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);
  assert(step3Callbacks.includes('onboard:step3:next'), 'Step 3 keyboard must offer continue to Step 4');

  // Step 4: Advance to Channels
  await OnboardingHandler.showBotChannels(mockCtx);
  assert(lastText.includes('Existing Bot Tokens Found'), 'Step 4 must announce detected bot tokens');
  const kbCallbacks = (lastKb?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);
  assert(kbCallbacks.includes('onboard:keep:channels'), 'Step 4 keyboard must offer keep existing channels');

  // Test 7: Advance to Step 5 uses cache and immediately offers keep existing LLM
  console.log('Test 7: Telegram Bot Step 5 cached Llama detection...');
  // Force inspect to throw if called again, verifying it uses cache!
  VpsConfigDetector.inspect = async () => {
    throw new Error('Should not re-inspect VPS in Step 5 when cached');
  };

  await OnboardingHandler.advanceToStep5(mockCtx);
  assert(lastText.includes('Existing LLM setup / connection found'), 'Step 5 must find existing Llama from cache');
  assert(lastText.includes('https://llama-relay-production.up.railway.app/v1'), 'Step 5 must display detected endpoint');

  // Test 8: finalizeSetup saves activeEndpointUrl and modelName into ctx.config
  console.log('Test 8: Telegram Bot finalizeSetup preserves activeEndpointUrl & modelName...');
  const origFinalizer = OnboardingFinalizer.finalizeSetup;
  OnboardingFinalizer.finalizeSetup = async () => {};
  await OnboardingHandler.handleKeepExistingLlama(mockCtx);
  assert(lastText.includes('Secondary VM Connection'), 'Must ask for separate-VM connection before finalizing');
  OnboardingFinalizer.finalizeSetup = origFinalizer;
  const cfgDraft = session.onboardingDraft;
  assert.strictEqual(cfgDraft.skipLlamaProvisioning, true, 'Existing Llama must skip provisioning');
  assert.strictEqual(cfgDraft.activeEndpointUrl, 'https://llama-relay-production.up.railway.app/v1', 'Detected endpoint must stay in the draft');
  assert.strictEqual(cfgDraft.modelName, 'Qwen 2.5 7B MTP', 'Detected model must stay in the draft');
  assert.strictEqual(cfgDraft.llamaTopology, 'dedicated', 'Separate VM must select dedicated topology');
  assert.strictEqual(mockCtx.config.llama.enabled, DEFAULT_CONFIG.llama.enabled, 'Step 6 must not persist config before SSH choice');

  OnboardingFinalizer.finalizeSetup = origFinalizer;
  VpsConfigDetector.inspect = origInspect;
  console.log('\n[PASS] All existing setup & remote Llama fixes tested successfully!');
}

runTests().catch((err) => {
  console.error('\n[FAIL] Test failed:', err);
  process.exit(1);
});
