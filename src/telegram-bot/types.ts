import { Context } from 'grammy';
import { ControlPanelConfig, CloudProviderType, VpsSpecs } from '../control-panel/core/types.js';

export type ActiveBotFlow = 'none' | 'onboarding' | 'ingress_settings' | 'recovery' | 'awaiting_input';

export interface OnboardingDraft {
  provider: CloudProviderType;
  secondaryOnly?: boolean;
  primaryMethod?: 'api' | 'ssh';
  primaryApiKey?: string;
  primarySshTarget?: string;
  primaryWorkspaceId?: string;
  primarySlug?: string;
  specs?: VpsSpecs;
  railwayDomain?: string;
  railwayUuid?: string;
  telegramToken?: string;
  discordToken?: string;
  discordGuildId?: string;
  llamaTopology?: 'dedicated' | 'same_vm' | 'cloud_only';
  secondaryProvider?: CloudProviderType;
  secondaryApiKey?: string;
  secondarySshTarget?: string;
  secondaryWorkspaceId?: string;
  secondarySlug?: string;
  secondaryMethod?: 'api' | 'ssh';
  modelType?: 'qwen7b' | 'qwen14b' | 'custom';
  customModelRepo?: string;
  customModelQuant?: string;
  upstreamKeys?: Record<string, string>;
  skipLlamaProvisioning?: boolean;
  activeEndpointUrl?: string;
  modelName?: string;
  domainedUrlsEnabled?: boolean;
  ingressProvider?: 'railway' | 'freestyle' | 'none';
  publicBaseDomain?: string;
  railwayApiKey?: string;
  openclawToken?: string;
}

export interface RecoveryDraft {
  missingType?: 'primary' | 'secondary' | 'both';
  action?: 'new_primary' | 'new_secondary' | 'new_both' | 'retry' | 'disable_secondary';
  provider?: CloudProviderType;
  apiKey?: string;
  sshTarget?: string;
}

export interface BotSessionData {
  flow: ActiveBotFlow;
  step: number;
  onboardingDraft: OnboardingDraft;
  recoveryDraft: RecoveryDraft;
  awaitingField?: string;
  lastMenuMessageId?: number;
  lastLogsService?: string;
  userMemory?: Record<string, any>;
}

export type BotContext = Context & {
  session?: BotSessionData;
  config: ControlPanelConfig;
  isOwner: boolean;
  botConfig?: BotConfig;
};

export interface BotConfig {
  botToken: string;
  ownerTelegramId?: number;
  allowedUserIds: number[];
  isPublic?: boolean;
}

export type ActionCallbackData =
  | 'menu:openclaw'
  | 'menu:omniroute'
  | 'menu:llama'
  | 'menu:services'
  | 'menu:diagnostics'
  | 'menu:logs'
  | 'menu:terminal'
  | 'menu:onboard'
  | 'menu:ping'
  | 'menu:recovery'
  | 'menu:refresh'
  | 'menu:logout';
