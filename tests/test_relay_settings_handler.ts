import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RelaySettingsHandler } from '../src/telegram-bot/handlers/relaySettingsHandler.js';
import { RailwayClient, RailwayRelayItem } from '../src/control-panel/core/railwayClient.js';
import { RailwaySafetyGuard } from '../src/control-panel/core/railwaySafetyGuard.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { BotContext } from '../src/telegram-bot/types.js';
import { DEFAULT_CONFIG } from '../src/control-panel/core/configManager.js';

describe('RelaySettingsHandler', () => {
  const origList = RailwayClient.listExistingRelays;
  const origValidate = RailwayClient.validateApiKey;

  beforeEach(() => {
    RailwaySafetyGuard.reset();
  });

  afterEach(() => {
    RailwayClient.listExistingRelays = origList;
    RailwayClient.validateApiKey = origValidate;
  });

  const createMockContext = (overrides?: Partial<BotContext>): BotContext => {
    const sentMessages: Array<{ text: string; markup?: unknown }> = [];
    const ctx = {
      chat: { id: 12345, type: 'private' },
      from: { id: 12345, first_name: 'Tester' },
      config: { ...DEFAULT_CONFIG, railwayApiKey: 'test-api-key' },
      botConfig: { botToken: 'test-token', allowedUserIds: [], isPublic: true },
      session: BotSessionManager.getSession(12345),
      reply: async (text: string, options?: { reply_markup?: unknown }) => {
        sentMessages.push({ text, markup: options?.reply_markup });
        return { message_id: 1 };
      },
      editMessageText: async (text: string, options?: { reply_markup?: unknown }) => {
        sentMessages.push({ text, markup: options?.reply_markup });
        return true;
      },
      answerCallbackQuery: async () => true,
      ...overrides
    } as unknown as BotContext;
    (ctx as any).sentMessages = sentMessages;
    return ctx;
  };

  it('showSettings sets flow to ingress_settings and renders menu', async () => {
    const ctx = createMockContext();
    await RelaySettingsHandler.showSettings(ctx);

    const session = BotSessionManager.getSession(12345);
    assert.equal(session.flow, 'ingress_settings');
    const sent = (ctx as any).sentMessages;
    assert.ok(sent.length > 0);
    assert.ok(sent[0].text.includes('Relays & Domain Settings'));
  });

  it('handleGateway discovers candidate Egress Relays and builds keyboard', async () => {
    const ctx = createMockContext();
    RailwayClient.listExistingRelays = async () => [
      {
        projectId: 'p1',
        projectName: 'My Egress',
        serviceId: 's1',
        serviceName: 'gateway-relay',
        domain: 'egress.up.railway.app',
        fullUrl: 'https://egress.up.railway.app',
        isLlama: false
      }
    ];

    await RelaySettingsHandler.handleGateway(ctx);
    const sent = (ctx as any).sentMessages;
    assert.ok(sent.some((m: any) => m.text.includes('Select Gateway (Egress) Relay')));
  });

  it('handleLlama discovers candidate LLaMA Relays and builds keyboard', async () => {
    const ctx = createMockContext();
    RailwayClient.listExistingRelays = async () => [
      {
        projectId: 'p2',
        projectName: 'My Llama',
        serviceId: 's2',
        serviceName: 'llama-relay',
        domain: 'llama.up.railway.app',
        fullUrl: 'https://llama.up.railway.app',
        isLlama: true
      }
    ];

    await RelaySettingsHandler.handleLlama(ctx);
    const sent = (ctx as any).sentMessages;
    assert.ok(sent.some((m: any) => m.text.includes('Select LLaMA AI Relay')));
  });

  it('handlePickRelay saves Gateway domain and LLaMA endpoint URL', async () => {
    const ctx = createMockContext();
    await RelaySettingsHandler.handlePickRelay(ctx, 'gateway', 'my-egress.up.railway.app');
    assert.equal(ctx.config.railwayDomain, 'my-egress.up.railway.app');

    await RelaySettingsHandler.handlePickRelay(ctx, 'llama', 'my-llama.up.railway.app');
    assert.equal(ctx.config.llama.railwayEndpointUrl, 'https://my-llama.up.railway.app');
    assert.ok(ctx.config.llama.activeEndpointUrl?.includes('/v1'));
  });

  it('handleTextInput validates and saves new Railway token for reuse', async () => {
    const ctx = createMockContext();
    const session = BotSessionManager.getSession(12345);
    session.awaitingField = 'railwayToken';

    RailwayClient.validateApiKey = async () => ({
      valid: true,
      user: 'test-user@example.com',
      tokenType: 'account'
    });

    const handled = await RelaySettingsHandler.handleTextInput(ctx, 'rlw_new_token_123');
    assert.equal(handled, true);
    assert.equal(ctx.config.railwayApiKey, 'rlw_new_token_123');
  });

  it('respects RailwaySafetyGuard cooldown and halts automated discovery', async () => {
    const ctx = createMockContext();
    RailwaySafetyGuard.recordError('test-api-key', 'Rate limit exceeded');

    await RelaySettingsHandler.handleGateway(ctx);
    const sent = (ctx as any).sentMessages;
    assert.ok(sent.some((m: any) => m.text.includes('Railway Safety Cooldown Active')));
    const session = BotSessionManager.getSession(12345);
    assert.equal(session.awaitingField, 'gatewayDomain');
  });
});
