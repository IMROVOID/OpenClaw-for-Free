/**
 * Bot Response Formatter Plugin for OpenClaw
 * Shows agent thinking preview (1-2 lines styled) and context length / latency footer.
 */

import { registerModelToolsCommand, PluginApi } from './tool-profile-command';

export interface CacheEntry {
  text?: string;
  used?: number;
  budget?: number;
  startTime?: number;
  ts: number;
}

export interface LlmOutputEvent {
  runId?: string;
  lastAssistant?: {
    reasoning_content?: string;
    content?: Array<{ type?: string; thinking?: string; text?: string }> | string;
  };
  assistantTexts?: string[];
  usage?: {
    total?: number;
  };
  contextTokenBudget?: number;
}

export interface UsageState {
  contextUsedTokens?: number;
  usage?: {
    total?: number;
  };
  contextTokenBudget?: number;
  durationMs?: number;
}

export interface ReplyPayload {
  text?: string;
  isReasoning?: boolean;
  isError?: boolean;
  [key: string]: any;
}

export interface ReplyPayloadEvent {
  runId?: string;
  payload?: ReplyPayload;
  usageState?: UsageState;
  channel?: string;
}

export interface MessageSendingEvent {
  content?: string;
  [key: string]: any;
}

export interface MessageContext {
  runId?: string;
  channelId?: string;
  [key: string]: any;
}

export interface ExtendedPluginApi extends PluginApi {
  logger?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  on(event: 'llm_output', handler: (event: LlmOutputEvent) => void): void;
  on(event: 'reply_payload_sending', handler: (event: ReplyPayloadEvent) => Promise<{ payload?: ReplyPayload }>): void;
  on(event: 'message_sending', handler: (event: MessageSendingEvent, ctx?: MessageContext) => Promise<{ content?: string } | void>): void;
}

const TTL_MS = 5 * 60 * 1000;
const thinkingCache = new Map<string, CacheEntry>();
const usageCache = new Map<string, CacheEntry>();

function prune(map: Map<string, CacheEntry>): void {
  const now = Date.now();
  for (const [key, val] of map.entries()) {
    if (now - val.ts > TTL_MS) map.delete(key);
  }
}

export function extractThinking(event?: LlmOutputEvent): string {
  if (!event) return '';
  const last = event.lastAssistant;
  if (last && typeof last === 'object') {
    if (typeof last.reasoning_content === 'string' && last.reasoning_content.trim()) {
      return last.reasoning_content.trim();
    }
    if (Array.isArray(last.content)) {
      for (const block of last.content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
          return block.thinking.trim();
        }
        if (typeof block.text === 'string' && /<\s*think/i.test(block.text)) {
          const match = block.text.match(/<\s*think\s*>([\s\S]*?)<\s*\/\s*think\s*>/i);
          if (match && match[1].trim()) return match[1].trim();
        }
      }
    } else if (typeof last.content === 'string' && /<\s*think/i.test(last.content)) {
      const match = last.content.match(/<\s*think\s*>([\s\S]*?)<\s*\/\s*think\s*>/i);
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  if (Array.isArray(event.assistantTexts)) {
    for (const text of event.assistantTexts) {
      if (typeof text === 'string' && /<\s*think/i.test(text)) {
        const match = text.match(/<\s*think\s*>([\s\S]*?)<\s*\/\s*think\s*>/i);
        if (match && match[1].trim()) return match[1].trim();
      }
    }
  }
  return '';
}

export function formatThinkingPreview(thinking: string, isDiscord: boolean): string {
  if (!thinking) return '';
  const lines = thinking.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  let preview = lines.slice(0, 2).join(' ');
  if (preview.length > 140) {
    preview = preview.slice(0, 137).trim() + '...';
  } else if (lines.length > 2) {
    preview = preview + '...';
  }
  return isDiscord
    ? `> 💭 *Thinking: ${preview}*\n\n`
    : `> 💭 _Thinking: ${preview}_\n\n`;
}

export function formatTokens(count?: number): string {
  if (typeof count !== 'number' || isNaN(count) || count < 0) return '?';
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
  return count.toLocaleString();
}

export function formatDuration(ms?: number): string | null {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return null;
  if (ms >= 60000) {
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
  }
  return (ms / 1000).toFixed(1) + 's';
}

export function buildFooter(usageState?: UsageState, cachedUsage?: CacheEntry, isDiscord?: boolean): string {
  const used = usageState?.contextUsedTokens ?? usageState?.usage?.total ?? cachedUsage?.used ?? 0;
  const budget = usageState?.contextTokenBudget ?? cachedUsage?.budget ?? 32768;
  const remaining = Math.max(0, budget - used);
  const durMs = usageState?.durationMs ?? (cachedUsage?.startTime ? Date.now() - cachedUsage.startTime : undefined);
  const durStr = formatDuration(durMs);
  const durPart = durStr ? ` • ⏱ ${durStr}` : '';
  const info = `Context: ${formatTokens(used)} / ${formatTokens(budget)} (${formatTokens(remaining)} left)${durPart}`;
  return isDiscord ? `\n\n-# 🧠 ${info}` : `\n\n\`${info}\``;
}

export function formatMessageText(text: string, runId?: string, usageState?: UsageState, channel?: string): string {
  if (typeof text !== 'string' || !text.trim()) return text;
  if (text.includes('Context:') && text.includes('left)')) return text;

  let bodyText = text;
  let thinking = '';

  if (/<\s*think/i.test(bodyText)) {
    const match = bodyText.match(/<\s*think\s*>([\s\S]*?)<\s*\/\s*think\s*>/i);
    if (match) {
      thinking = match[1].trim();
      bodyText = bodyText.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/i, '').trimStart();
    }
  }

  if (!thinking && runId && thinkingCache.has(runId)) {
    thinking = thinkingCache.get(runId)?.text ?? '';
  }

  const isDiscord = (channel || '').toLowerCase().includes('discord');
  const thinkHeader = formatThinkingPreview(thinking, isDiscord);
  const cachedUsage = runId ? usageCache.get(runId) : undefined;
  const footer = buildFooter(usageState, cachedUsage, isDiscord);

  return `${thinkHeader}${bodyText.trim()}${footer}`;
}

export default {
  id: 'bot-response-formatter',
  name: 'Bot Response Formatter',
  description: 'Formats agent thinking previews and context length / latency footers for bot replies',
  register(api: ExtendedPluginApi) {
    api.logger?.info?.('[bot-response-formatter] Initializing plugin hooks');
    registerModelToolsCommand(api);

    api.on('llm_output', (event: LlmOutputEvent) => {
      try {
        if (!event?.runId) return;
        prune(thinkingCache);
        prune(usageCache);
        const thinking = extractThinking(event);
        if (thinking) {
          thinkingCache.set(event.runId, { text: thinking, ts: Date.now() });
        }
        usageCache.set(event.runId, {
          used: event.usage?.total,
          budget: event.contextTokenBudget,
          startTime: Date.now(),
          ts: Date.now()
        });
      } catch (err: any) {
        api.logger?.warn?.(`[bot-response-formatter] llm_output error: ${err.message}`);
      }
    });

    api.on('reply_payload_sending', async (event: ReplyPayloadEvent) => {
      try {
        const payload = event?.payload;
        if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) {
          return { payload };
        }
        if (payload.isReasoning || payload.isError) {
          return { payload };
        }
        const newText = formatMessageText(payload.text, event.runId, event.usageState, event.channel);
        return {
          payload: {
            ...payload,
            text: newText
          }
        };
      } catch (err: any) {
        api.logger?.warn?.(`[bot-response-formatter] reply_payload_sending error: ${err.message}`);
        return { payload: event?.payload };
      }
    });

    api.on('message_sending', async (event: MessageSendingEvent, ctx?: MessageContext) => {
      try {
        if (!event || typeof event.content !== 'string' || !event.content.trim()) return;
        const newContent = formatMessageText(event.content, ctx?.runId, undefined, ctx?.channelId);
        if (newContent !== event.content) {
          return { content: newContent };
        }
      } catch (err: any) {
        api.logger?.warn?.(`[bot-response-formatter] message_sending error: ${err.message}`);
      }
    });
  }
};
