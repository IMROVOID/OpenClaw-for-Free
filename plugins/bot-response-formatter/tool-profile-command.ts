import fs from 'fs';

export interface CommandContext {
  args?: string;
  senderId?: string;
  isOwner?: boolean;
}

export interface CommandResponse {
  text: string;
}

export interface ModelEntry {
  id: string;
  name?: string;
  compat?: {
    supportsTools?: boolean;
    toolSchemaProfile?: string;
  };
}

export interface OpenClawConfig {
  models?: {
    providers?: {
      omniroute?: {
        models?: ModelEntry[];
      };
    };
  };
  tools?: {
    profile?: string;
    byProvider?: Record<string, { profile?: string; deny?: string[] }>;
  };
}

export interface PluginApi {
  registerCommand(cmd: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    exposeSenderIsOwner?: boolean;
    handler: (ctx: CommandContext) => Promise<CommandResponse>;
  }): void;
}

const CONFIG_PATH = '/home/daytona/.openclaw/openclaw.json';
const TARGET_MODEL = process.env.LLAMA_MODEL_ID || 'daytona-llama/default-model';

export function registerModelToolsCommand(api: PluginApi): void {
  if (typeof api?.registerCommand !== 'function') return;

  api.registerCommand({
    name: 'modeltools',
    description: 'Inspect or toggle tools for local llama model (/modeltools status | minimal | coding)',
    acceptsArgs: true,
    exposeSenderIsOwner: true,
    handler: async (ctx: CommandContext): Promise<CommandResponse> => {
      const args = (ctx.args || '').trim().toLowerCase();
      const tokens = args.split(/\s+/).filter(Boolean);
      const action = tokens[0] || 'status';

      let cfg: OpenClawConfig;
      try {
        cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      } catch (err: any) {
        return { text: `❌ Failed to read OpenClaw config: ${err.message}` };
      }

      const models = cfg.models?.providers?.omniroute?.models || [];
      const modelEntry = models.find((m) => m.id === TARGET_MODEL);

      if (action === 'status') {
        const toolsEnabled = modelEntry?.compat?.supportsTools !== false;
        const globalProfile = cfg.tools?.profile || 'default';
        const byProvider = cfg.tools?.byProvider?.[`omniroute/${TARGET_MODEL}`];
        return {
          text: `🛠 **Model Tool Configuration**\n` +
            `• Model: \`${TARGET_MODEL}\`\n` +
            `• Tools for this model: **${toolsEnabled ? 'ENABLED (Coding/Full)' : 'DISABLED (Minimal / Fast)'}**\n` +
            `• Global Tool Profile: \`${globalProfile}\`\n` +
            `• Policy Override: \`${byProvider?.profile || 'none'}\`\n\n` +
            `_Use \`/modeltools minimal\` to disable heavy tools (fast CPU response), or \`/modeltools coding\` to re-enable tools._`
        };
      }

      if (action === 'minimal' || action === 'off' || action === 'disable') {
        if (modelEntry) {
          modelEntry.compat = modelEntry.compat || {};
          modelEntry.compat.supportsTools = false;
        }
        cfg.tools = cfg.tools || {};
        cfg.tools.byProvider = cfg.tools.byProvider || {};
        cfg.tools.byProvider[`omniroute/${TARGET_MODEL}`] = {
          profile: 'minimal',
          deny: ['*']
        };

        try {
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (err: any) {
          return { text: `❌ Failed to write config: ${err.message}` };
        }

        return {
          text: `⚡ **Model Tools set to MINIMAL**\n` +
            `Model \`${TARGET_MODEL}\` now has 0 tools injected into prompts.\n` +
            `• Context token reduction: **~14,500 tokens saved**.\n` +
            `• Responses will now be fast on CPU!`
        };
      }

      if (action === 'coding' || action === 'on' || action === 'enable' || action === 'full') {
        if (modelEntry) {
          modelEntry.compat = modelEntry.compat || {};
          modelEntry.compat.supportsTools = true;
        }
        if (cfg.tools?.byProvider?.[`omniroute/${TARGET_MODEL}`]) {
          delete cfg.tools.byProvider[`omniroute/${TARGET_MODEL}`];
        }

        try {
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (err: any) {
          return { text: `❌ Failed to write config: ${err.message}` };
        }

        return {
          text: `🔧 **Model Tools set to CODING**\n` +
            `Model \`${TARGET_MODEL}\` now has all tools enabled.\n` +
            `⚠️ Note: Ingesting all tool schemas will increase latency on CPU.`
        };
      }

      return {
        text: `Usage: \`/modeltools [status | minimal | coding]\`\n\n` +
          `• \`/modeltools minimal\` - Disable tools for local model (fast chat)\n` +
          `• \`/modeltools coding\` - Re-enable tools for local model\n` +
          `• \`/modeltools status\` - View current configuration`
      };
    }
  });
}
