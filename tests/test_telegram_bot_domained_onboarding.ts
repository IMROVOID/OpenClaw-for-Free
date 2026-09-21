import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InlineKeyboards } from '../src/telegram-bot/keyboards/inlineKeyboards.js';
import { MenuHandler } from '../src/telegram-bot/handlers/menuHandler.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { OnboardingIngressHandler } from '../src/telegram-bot/handlers/onboardingIngressHandler.js';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';
import { OnboardingFinalizer } from '../src/telegram-bot/handlers/onboardingFinalizer.js';
import { OnboardingLlamaHandler } from '../src/telegram-bot/handlers/onboardingLlamaHandler.js';
import { ConfigManager } from '../src/control-panel/core/configManager.js';
import { OpenclawConfigSyncer } from '../src/control-panel/core/openclawConfigSyncer.js';
import { OmnirouteSync } from '../src/control-panel/core/omnirouteSync.js';
import { ControlPanelConfig } from '../src/control-panel/core/types.js';
import { BotContext } from '../src/telegram-bot/types.js';

console.log('--- Running test: Telegram Bot Domained Onboarding & WebUI ---');

const baseMockConfig: ControlPanelConfig = {
  provider: 'daytona',
  primarySshTarget: 'user@ssh.app.daytona.io',
  openclawPort: 18789,
  omniroutePort: 20128,
  llamaPort: 8080,
  openclawToken: 'test-token-12345',
  omniroutePassword: 'CHANGEME',
  vpsSpecs: { cpuCores: 4, ramGb: 8, storageGb: 10 },
  providers: {},
  llama: {
    enabled: true,
    isSeparateVps: false,
    modelUrl: 'https://huggingface.co/test/model.gguf',
    modelName: 'Qwen 2.5 7B',
    quantization: 'q4_k_m',
    contextSize: 32768,
    batchSize: 512,
    threads: 4,
    enableMtp: true,
    enableFlashAttn: true,
    isMoe: false,
    kvCacheQuant: 'q4_0'
  }
};

let saveCalls = 0;
let syncCalls = 0;

async function runTests() {
  const settingsMessages: string[] = [];
  const settingsCtx = {
    chat: { id: 888225, type: 'private' },
    config: structuredClone(baseMockConfig),
    reply: async (text: string) => {
      settingsMessages.push(text);
      return { message_id: 458 };
    }
  } as unknown as BotContext;
  const settingsOriginal = structuredClone(settingsCtx.config);
  await OnboardingIngressHandler.startSettings(settingsCtx);
  assert.strictEqual(BotSessionManager.getSession(888225).flow, 'ingress_settings');
  assert.ok(settingsMessages.some(text => text.includes('WebUI Access')));
  assert.deepStrictEqual(settingsCtx.config, settingsOriginal);
  await OnboardingIngressHandler.handleIngressSelect(settingsCtx, 'port_forward');
  assert.deepStrictEqual(settingsCtx.config, {
    ...settingsOriginal, domainedUrlsEnabled: false, ingressProvider: 'none'
  });
  assert.strictEqual(saveCalls, 1);
  assert.strictEqual(syncCalls, 0);
  assert.strictEqual(BotSessionManager.getSession(888225).flow, 'none');
  assert.ok(settingsMessages.every(text => !text.includes('Bootstrapping') && !text.includes('Onboarding Complete')));
  console.log('[PASS] settings-only action persists ingress without full finalization');
  const menuButtons = InlineKeyboards.buildMainMenu(settingsCtx.config).inline_keyboard.flat();
  assert.ok(menuButtons.some(button => 'callback_data' in button && button.callback_data === 'menu:webui-settings'));
  for (const action of ['back', 'cancel'] as const) {
    await OnboardingIngressHandler.startSettings(settingsCtx);
    await OnboardingIngressHandler.handleIngressSelect(settingsCtx, 'domained');
    await OnboardingIngressHandler.handleDomainProviderSelect(settingsCtx, 'railway');
    const beforeCancel: ControlPanelConfig = structuredClone(settingsCtx.config);
    await OnboardingIngressHandler.handleSettingsNavigation(settingsCtx, action);
    assert.strictEqual(BotSessionManager.getSession(888225).flow, 'none');
    assert.strictEqual(BotSessionManager.getSession(888225).awaitingField, undefined);
    assert.deepStrictEqual(settingsCtx.config, beforeCancel);
    assert.strictEqual(saveCalls, 1);
    await OnboardingIngressHandler.handleIngressSelect(settingsCtx, 'port_forward');
    assert.strictEqual(saveCalls, 1, 'stale ingress callbacks must not save');
  }
  await OnboardingIngressHandler.startSettings(settingsCtx);
  await OnboardingIngressHandler.handleIngressSelect(settingsCtx, 'domained');
  await OnboardingFinalizer.finalizeSetup(settingsCtx);
  assert.strictEqual(saveCalls, 1, 'domain=true without a domain must not finalize');
  const validate = RailwayClient.validateApiKey;
  const listRelays = RailwayClient.listExistingRelays;
  RailwayClient.validateApiKey = async () => ({ valid: true, user: 'fixture' });
  RailwayClient.listExistingRelays = async () => [{
    projectId: 'project-fixture',
    projectName: 'fixture project',
    serviceId: 'service-fixture',
    serviceName: 'web relay',
    domain: 'web-relay-production.up.railway.app',
    fullUrl: 'https://web-relay-production.up.railway.app',
    isLlama: false
  }];
  const validateConnected = RailwayHelper.validateApiKey;
  RailwayHelper.validateApiKey = async (token: string) =>
    token === 'fixture-token' ? { valid: true, user: 'fixture' } : { valid: false, error: 'expired' };
  try {
    await OnboardingIngressHandler.handleDomainProviderSelect(settingsCtx, 'railway');
    assert.strictEqual(BotSessionManager.getSession(888225).awaitingField, 'railwayApiKey');
    assert.ok(settingsMessages.some(text => text.includes('Railway API Token')));
    await OnboardingIngressHandler.handleTextInput(settingsCtx, 'bad-token');
    assert.strictEqual(saveCalls, 1, 'invalid Railway token must not save');
    assert.strictEqual(BotSessionManager.getSession(888225).awaitingField, 'railwayApiKey');
    await OnboardingIngressHandler.handleTextInput(settingsCtx, 'expired-token');
    assert.strictEqual(saveCalls, 1, 'expired Railway token must not save');
    try {
      await OnboardingIngressHandler.handleTextInput(settingsCtx, 'fixture-token');
    } finally {
      RailwayHelper.validateApiKey = validateConnected;
    }
    assert.strictEqual(BotSessionManager.getSession(888225).awaitingField, 'customBaseDomain');
    assert.ok(settingsMessages.some(text => text.includes('web-relay-production.up.railway.app')));
    assert.ok(settingsMessages.some(text => text.includes('Example:')));
    await OnboardingIngressHandler.handleTextInput(settingsCtx, 'https://');
    assert.strictEqual(saveCalls, 1, 'invalid domain must not save');
    await OnboardingIngressHandler.handleTextInput(settingsCtx, 'https://relay.example.com/');
  } finally {
    RailwayClient.validateApiKey = validate;
    RailwayClient.listExistingRelays = listRelays;
  }
  assert.deepStrictEqual(settingsCtx.config, {
    ...settingsOriginal, domainedUrlsEnabled: true, ingressProvider: 'railway', publicBaseDomain: 'relay.example.com', railwayApiKey: 'fixture-token'
  });
  assert.strictEqual(saveCalls, 2);
  assert.strictEqual(syncCalls, 0);
  assert.ok(settingsMessages.some(text => text.includes('Railway') && text.includes('relay.example.com')));
  Object.assign(settingsCtx.config, {
    customOpenclawUrl: 'https://old.example.com/openclaw',
    customOmnirouteUrl: 'https://old.example.com/omniroute',
    customLlamaUrl: 'https://old.example.com/llama'
  });
  await OnboardingIngressHandler.startSettings(settingsCtx);
  await OnboardingIngressHandler.handleIngressSelect(settingsCtx, 'port_forward');
  assert.deepStrictEqual(settingsCtx.config, {
    ...settingsOriginal, domainedUrlsEnabled: false, ingressProvider: 'none', railwayApiKey: 'fixture-token'
  });
  assert.strictEqual(saveCalls, 3);
  assert.strictEqual(syncCalls, 0);
  console.log('[PASS] settings domains, stale URL cleanup, cancellation, and stale callbacks');
  saveCalls = 0;

  const cloudSession = BotSessionManager.startOnboarding(888223);
  const messages: string[] = [];
  const buttons: string[] = [];
  const cloudCtx = {
    chat: { id: 888223, type: 'private' },
    config: structuredClone(baseMockConfig),
    reply: async (text: string, options?: { reply_markup?: ReturnType<typeof InlineKeyboards.buildOnboardingIngressChoice> }) => {
      messages.push(text);
      buttons.push(...(options?.reply_markup?.inline_keyboard.flat().flatMap(button =>
        'callback_data' in button ? [button.callback_data] : []) ?? []));
      return { message_id: 457 };
    }
  } as unknown as BotContext;
  const originalConfig = structuredClone(cloudCtx.config);

  await OnboardingLlamaHandler.handleTopologySelect(cloudCtx, 'cloud_only');
  assert.ok(buttons.includes('onboard:ingress:port_forward') && buttons.includes('onboard:ingress:domained'),
    'cloud_only must show ingress choice before finalizing');
  assert.strictEqual(cloudSession.step, 7);
  assert.strictEqual(cloudSession.flow, 'onboarding');
  assert.strictEqual(cloudSession.onboardingDraft.llamaTopology, 'cloud_only');
  assert.strictEqual(saveCalls, 0, 'cloud_only must not save before ingress choice');
  assert.strictEqual(syncCalls, 0, 'cloud_only must not sync before ingress choice');
  assert.deepStrictEqual(cloudCtx.config, originalConfig);
  assert.ok(messages.every(text => !text.includes('Finalizing') && !text.includes('Onboarding Complete')));
  console.log('[PASS] cloud_only requires ingress choice without saving, syncing, or finalizing');

  messages.length = 0;
  buttons.length = 0;
  await OnboardingFinalizer.finalizeSetup(cloudCtx);
  assert.ok(buttons.includes('onboard:ingress:port_forward'));
  assert.strictEqual(saveCalls, 0);
  assert.strictEqual(syncCalls, 0);
  assert.deepStrictEqual(cloudCtx.config, originalConfig);
  console.log('[PASS] shared finalizer blocks full-onboarding bypasses');

  await OnboardingIngressHandler.handleIngressSelect(cloudCtx, 'port_forward');
  assert.strictEqual(saveCalls, 1);
  assert.strictEqual(cloudCtx.config.domainedUrlsEnabled, false);
  assert.strictEqual(cloudCtx.config.llama.enabled, false);
  assert.strictEqual(cloudSession.flow, 'none');
  console.log('[PASS] explicit port forwarding allows cloud_only completion');

  const secondarySession = BotSessionManager.startOnboarding(888224);
  secondarySession.onboardingDraft.secondaryOnly = true;
  const secondaryCtx = {
    ...cloudCtx,
    chat: { id: 888224, type: 'private' },
    config: structuredClone(baseMockConfig)
  } as unknown as BotContext;
  buttons.length = 0;
  const syncsBeforeSecondary = syncCalls;
  await OnboardingFinalizer.finalizeSetup(secondaryCtx);
  assert.strictEqual(saveCalls, 2);
  assert.strictEqual(syncCalls, syncsBeforeSecondary);
  assert.strictEqual(secondarySession.flow, 'none');
  assert.ok(!buttons.includes('onboard:ingress:port_forward'));
  console.log('[PASS] secondary-only onboarding completes without ingress gating');

  // Test 1: Ingress choice keyboard builders
  const ingressKb = InlineKeyboards.buildOnboardingIngressChoice();
  const ingressButtons = ingressKb.inline_keyboard.flat().map((b: any) => b.callback_data);
  assert.ok(ingressButtons.includes('onboard:ingress:port_forward'));
  assert.ok(ingressButtons.includes('onboard:ingress:domained'));
  console.log('[PASS] Test 1: Ingress choice keyboard buttons verified');

  // Test 2: Domain provider keyboard builder for FreeStyle vs Daytona
  const fsDomainKb = InlineKeyboards.buildOnboardingDomainProvider('freestyle');
  const fsButtons = fsDomainKb.inline_keyboard.flat().map((b: any) => b.callback_data);
  assert.ok(fsButtons.includes('onboard:dom:freestyle'));
  assert.ok(fsButtons.includes('onboard:dom:railway'));

  const daytonaDomainKb = InlineKeyboards.buildOnboardingDomainProvider('daytona');
  const daytonaButtons = daytonaDomainKb.inline_keyboard.flat().map((b: any) => b.callback_data);
  assert.ok(daytonaButtons.includes('onboard:dom:railway'));
  assert.ok(!daytonaButtons.includes('onboard:dom:freestyle'), 'Daytona should not offer freestyle domain');
  console.log('[PASS] Test 2: Provider-specific domain choice keyboards verified');

  // Test 3: MenuHandler formatWebUiText with Domained URLs
  let repliedText = '';
  const mockDomCtx: BotContext = {
    chat: { id: 999111, type: 'private' },
    config: {
      ...baseMockConfig,
      domainedUrlsEnabled: true,
      publicBaseDomain: 'my-openclaw.up.railway.app'
    },
    reply: async (text: string) => {
      repliedText = text;
      return { message_id: 123 } as any;
    }
  } as any;

  await MenuHandler.handleWebUiAction(mockDomCtx, 'openclaw');
  assert.ok(repliedText.includes('https://my-openclaw.up.railway.app/openclaw/?token=test-token-12345'));
  assert.ok(repliedText.includes('Permanent Public URL') || repliedText.includes('Domained URL'));
  console.log('[PASS] Test 3: MenuHandler displays Domained URL for OpenClaw');

  await MenuHandler.handleWebUiAction(mockDomCtx, 'omniroute');
  assert.ok(repliedText.includes('https://my-openclaw.up.railway.app/omniroute/dashboard'));
  console.log('[PASS] Test 4: MenuHandler displays Domained URL for OmniRoute');

  await MenuHandler.handleWebUiAction(mockDomCtx, 'llama');
  assert.ok(repliedText.includes('https://my-openclaw.up.railway.app/llama'));
  console.log('[PASS] Test 5: MenuHandler displays Domained URL for Llama');

  // Test 6: Ingress selection updates session draft and proceeds to finalize
  const testChatId = 888222;
  const session = BotSessionManager.startOnboarding(testChatId);
  session.onboardingDraft.provider = 'freestyle';
  session.onboardingDraft.primarySlug = 'openclaw-node';

  let updatedText = '';
  const wizardCtx: BotContext = {
    chat: { id: testChatId, type: 'private' },
    config: { ...baseMockConfig, provider: 'freestyle' },
    reply: async (text: string) => {
      updatedText = text;
      return { message_id: 456 } as any;
    }
  } as any;

  await OnboardingIngressHandler.handleIngressSelect(wizardCtx, 'port_forward');
  assert.strictEqual(session.onboardingDraft.domainedUrlsEnabled, false);
  console.log('[PASS] Test 6: Port forwarding choice sets domainedUrlsEnabled=false');

  BotSessionManager.startOnboarding(testChatId);
  session.onboardingDraft.provider = 'freestyle';
  session.onboardingDraft.primarySlug = 'openclaw-node';

  await OnboardingIngressHandler.handleIngressSelect(wizardCtx, 'domained');
  assert.strictEqual(session.onboardingDraft.domainedUrlsEnabled, true);
  console.log('[PASS] Test 7: Domained choice sets domainedUrlsEnabled=true');

  await OnboardingIngressHandler.handleDomainProviderSelect(wizardCtx, 'freestyle');
  assert.strictEqual(session.onboardingDraft.ingressProvider, 'freestyle');
  assert.strictEqual(session.onboardingDraft.publicBaseDomain, 'openclaw-node.style.dev');
  console.log('[PASS] Test 8: FreeStyle native domain auto-sets <slug>.style.dev');

  // Test 9: OnboardingFinalizer persists domained configuration
  await OnboardingFinalizer.finalizeSetup(wizardCtx);
  assert.strictEqual(wizardCtx.config.domainedUrlsEnabled, true);
  assert.strictEqual(wizardCtx.config.ingressProvider, 'freestyle');
  assert.strictEqual(wizardCtx.config.publicBaseDomain, 'openclaw-node.style.dev');
  console.log('[PASS] Test 9: OnboardingFinalizer successfully persists domained fields');
}

async function main() {
  const origSave = ConfigManager.save;
  const origSync = OpenclawConfigSyncer.sync;
  const origOmni = OmnirouteSync.syncProvidersToRemoteVps;

  const origSessionDir = BotSessionManager.getSessionDir;
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-ingress-test-'));
  BotSessionManager.getSessionDir = () => sessionDir;
  ConfigManager.save = () => { saveCalls++; };
  OpenclawConfigSyncer.sync = async () => { syncCalls++; };
  OmnirouteSync.syncProvidersToRemoteVps = async () => {
    syncCalls++;
    return { success: true, syncedCount: 0 };
  };

  try {
    await runTests();
    console.log('[PASS] All Telegram Bot Domained Onboarding tests passed successfully!\n');
  } finally {
    BotSessionManager.getSessionDir = origSessionDir;
    fs.rmSync(sessionDir, { recursive: true, force: true });
    ConfigManager.save = origSave;
    OpenclawConfigSyncer.sync = origSync;
    OmnirouteSync.syncProvidersToRemoteVps = origOmni;
  }
}

main().catch((err) => {
  console.error('✘ Test failed:', err);
  process.exit(1);
});
