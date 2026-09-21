import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InlineKeyboard } from 'grammy';
import { DEFAULT_CONFIG, ConfigManager } from '../src/control-panel/core/configManager.js';
import { BotSessionManager } from '../src/telegram-bot/services/botSessionManager.js';
import { OnboardingIngressHandler } from '../src/telegram-bot/handlers/onboardingIngressHandler.js';
import { OnboardingHandler } from '../src/telegram-bot/handlers/onboardingHandler.js';
import { MenuHandler } from '../src/telegram-bot/handlers/menuHandler.js';
import { RailwayClient } from '../src/control-panel/core/railwayClient.js';
import { RailwayHelper } from '../src/control-panel/core/railwayHelper.js';
import { errorMiddleware } from '../src/telegram-bot/middleware/errorMiddleware.js';
import { BotContext } from '../src/telegram-bot/types.js';
import { BotError } from 'grammy';
import https from 'https';

test('OpenClaw WebUI action generates and persists token if missing', async () => {
  const cfg = { ...structuredClone(DEFAULT_CONFIG), primarySshTarget: 'user@mock-host', openclawToken: '' };
  const replies: string[] = [];
  const edits: string[] = [];
  let savedConfig: typeof cfg | undefined;

  const mockSave = ConfigManager.save;
  ConfigManager.save = (c: any) => { savedConfig = c; };

  const ctx = {
    config: cfg,
    reply: async (text: string) => { replies.push(text); return { message_id: 101 }; },
    editMessageText: async (text: string) => { edits.push(text); return true; },
    callbackQuery: undefined
  } as unknown as BotContext;

  try {
    await MenuHandler.handleWebUiAction(ctx, 'openclaw');
    assert.ok(replies.length > 0, 'Must reply with access info');
    assert.ok(!replies[0].includes('No token found'), 'Must not display "No token found"');
    assert.ok(cfg.openclawToken.length > 10, 'Token must be generated and non-empty');
    assert.ok(savedConfig?.openclawToken === cfg.openclawToken, 'Generated token must be persisted');
    assert.ok(replies[0].includes(`?token=${cfg.openclawToken}`), 'URL must include token query');
  } finally {
    ConfigManager.save = mockSave;
  }
});

test('OnboardingIngressHandler rejects Egress Relay domain with helpful error', async () => {
  const chatId = 991122;
  const session = BotSessionManager.getSession(chatId);
  session.flow = 'ingress_settings';
  session.step = 7;
  session.awaitingField = 'customBaseDomain';
  session.onboardingDraft = {
    provider: 'daytona',
    domainedUrlsEnabled: true,
    ingressProvider: 'railway',
    railwayApiKey: 'mock-key'
  };

  const replies: string[] = [];
  const ctx = {
    chat: { id: chatId, type: 'private' },
    config: structuredClone(DEFAULT_CONFIG),
    reply: async (text: string) => { replies.push(text); return { message_id: 202 }; }
  } as unknown as BotContext;

  const handled = await OnboardingIngressHandler.handleTextInput(ctx, 'egress-relay-production.up.railway.app');
  assert.strictEqual(handled, true);
  assert.ok(replies.some(msg => msg.includes('Cannot use Egress Relay for WebUI')), 'Must explain egress relay cannot serve WebUI');
  assert.strictEqual(session.onboardingDraft.publicBaseDomain, undefined, 'Egress domain must not be saved');
  assert.strictEqual(session.awaitingField, 'customBaseDomain', 'Must remain awaiting valid domain');
});

test('Railway API key storage and reuse prompt', async () => {
  const chatId = 991133;
  const session = BotSessionManager.getSession(chatId);
  session.flow = 'ingress_settings';
  session.onboardingDraft = {
    provider: 'daytona',
    domainedUrlsEnabled: true
  };

  const replies: string[] = [];
  const ctx = {
    chat: { id: chatId, type: 'private' },
    config: { ...structuredClone(DEFAULT_CONFIG), railwayApiKey: 'existing-saved-token-12345' },
    reply: async (text: string) => { replies.push(text); return { message_id: 303 }; }
  } as unknown as BotContext;

  // 1. When selecting Railway provider and saved key exists:
  await OnboardingIngressHandler.handleDomainProviderSelect(ctx, 'railway');
  assert.ok(replies.some(msg => msg.includes('Saved Railway API token found')), 'Must prompt to reuse saved key');

  // 2. When user chooses "use_saved":
  await OnboardingIngressHandler.handleRailwayKeyChoice(ctx, 'use_saved');
  assert.strictEqual(session.onboardingDraft.railwayApiKey, 'existing-saved-token-12345');
  assert.strictEqual(session.awaitingField, 'customBaseDomain');

  // 3. When user chooses "enter_new":
  await OnboardingIngressHandler.handleRailwayKeyChoice(ctx, 'enter_new');
  assert.strictEqual(session.awaitingField, 'railwayApiKey');
});

test('Sensitive API keys are deleted upon receipt in text handler', async () => {
  const chatId = 991144;
  const session = BotSessionManager.getSession(chatId);
  session.flow = 'ingress_settings';
  session.awaitingField = 'railwayApiKey';
  session.onboardingDraft = { provider: 'daytona', domainedUrlsEnabled: true, ingressProvider: 'railway' };

  let deleted = false;
  const ctx = {
    chat: { id: chatId, type: 'private' },
    config: structuredClone(DEFAULT_CONFIG),
    message: { text: 'my-secret-key-123', message_id: 404 },
    deleteMessage: async () => { deleted = true; return true; },
    reply: async () => ({ message_id: 405 })
  } as unknown as BotContext;

  const validate = RailwayHelper.validateApiKey;
  RailwayHelper.validateApiKey = async () => ({ valid: true, user: 'test-user' });

  try {
    await OnboardingIngressHandler.handleTextInput(ctx, 'my-secret-key-123');
    assert.strictEqual(deleted, true, 'User message containing API key must be deleted');
  } finally {
    RailwayHelper.validateApiKey = validate;
  }
});

test('Message ordering: updateWizard with forceNewMessage creates new message', async () => {
  const chatId = 991155;
  const session = BotSessionManager.getSession(chatId);
  session.lastMenuMessageId = 501;

  let replyCount = 0;
  let editCount = 0;

  const ctx = {
    chat: { id: chatId, type: 'private' },
    reply: async (text: string) => { replyCount++; return { message_id: 502 }; },
    api: {
      editMessageText: async () => { editCount++; return true; }
    }
  } as unknown as BotContext;

  // When forceNewMessage is true (e.g. user sent a non-deleted message or /start)
  await OnboardingHandler.updateWizard(ctx, 'New prompt below user message', undefined, true);
  assert.strictEqual(replyCount, 1, 'Must send a new reply');
  assert.strictEqual(editCount, 0, 'Must not edit old message when forceNewMessage is true');
  assert.strictEqual(session.lastMenuMessageId, 502, 'Must update lastMenuMessageId to the new message');

  // When forceNewMessage is false (e.g. callback or deleted user message)
  await OnboardingHandler.updateWizard(ctx, 'Edited in place', undefined, false);
  assert.strictEqual(editCount, 1, 'Must edit in place when forceNewMessage is false');
  assert.strictEqual(replyCount, 1, 'Must not send additional reply');
});

test('errorMiddleware gracefully suppresses "query is too old" errors', async () => {
  let replied = false;
  let answered = false;
  const ctx = {
    update: { update_id: 9999 },
    callbackQuery: { id: 'cb-123' },
    reply: async () => { replied = true; return {}; },
    answerCallbackQuery: async () => { answered = true; }
  } as unknown as BotContext;

  const botErr = new BotError(new Error("Call to 'answerCallbackQuery' failed! (400: Bad Request: query is too old and response timeout expired)"), ctx);
  await errorMiddleware(botErr);

  assert.strictEqual(replied, false, 'Should not send reply for expired query');
  assert.strictEqual(answered, false, 'Should not attempt answerCallbackQuery for expired query');
});

test('checkRelayDomain marks HTTP 404 as unreachable', async () => {
  const origGet = https.get;
  (https as any).get = (url: any, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    const res = { statusCode: 404 };
    setTimeout(() => callback(res), 5);
    return { on: () => {}, destroy: () => {} };
  };

  try {
    const check = await RailwayHelper.checkRelayDomain('test-404-domain.up.railway.app');
    assert.strictEqual(check.reachable, false, 'HTTP 404 must be marked unreachable');
    assert.strictEqual(check.statusCode, 404);
    assert.ok(check.message?.includes('404'), 'Message must indicate 404');
  } finally {
    https.get = origGet;
  }
});

