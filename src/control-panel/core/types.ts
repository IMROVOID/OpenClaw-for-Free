/**
 * Core types and data contracts for the OpenClaw Daytona Control Panel.
 */

export interface VpsSpecs {
  cpuCores: number;
  ramGb: number;
  storageGb: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  validated: boolean;
}

export interface LlamaSettings {
  enabled: boolean;
  isSeparateVps: boolean;
  sshTarget?: string;
  modelUrl: string;
  modelName: string;
  quantization: string;
  contextSize: number;
  batchSize: number;
  threads: number;
  enableMtp: boolean;
  enableFlashAttn: boolean;
  isMoe: boolean;
  kvCacheQuant: 'f16' | 'q8_0' | 'q4_0';
  railwayEndpointUrl?: string;
  freestyleDomainUrl?: string;
  activeEndpointUrl?: string;
}

export type CloudProviderType = 'daytona' | 'freestyle' | 'custom';

export interface ProvisionResult {
  primarySshTarget: string;
  secondarySshTarget: string;
  specs: VpsSpecs;
  apiKey?: string;
  interVmEndpoint?: string; // Private VPC IP or native TLS domain
  primaryWorkspaceId?: string;
  secondaryWorkspaceId?: string;
  primarySlug?: string;
  secondarySlug?: string;
}

export interface VpsProviderDriver {
  readonly providerId: 'daytona' | 'freestyle';
  readonly displayName: string;
  readonly defaultSpecs: VpsSpecs;
  readonly hasDirectEgress: boolean;

  validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }>;
  listExistingWorkspaces(apiKey: string): Promise<Array<{ id: string; name: string; specs: VpsSpecs }>>;
  provisionPrimary(apiKey: string, prefix?: string): Promise<ProvisionResult>;
  provisionSecondary(apiKey: string, prefix?: string, specs?: VpsSpecs): Promise<ProvisionResult>;
  provisionDualVms(apiKey: string, prefix: string): Promise<ProvisionResult>;
  detectHardware(sshTarget: string): Promise<VpsSpecs>;
  getRemoteTerminalCommand(sshTarget: string): string;
}

export interface ControlPanelConfig {
  provider: CloudProviderType;
  secondaryProvider?: CloudProviderType;
  daytonaApiKey?: string;
  secondaryDaytonaApiKey?: string;
  freestyleApiKey?: string;
  secondaryFreestyleApiKey?: string;
  freestylePrimarySlug?: string;
  freestyleLlamaSlug?: string;
  daytonaPrimaryWorkspaceId?: string;
  daytonaSecondaryWorkspaceId?: string;
  freestylePrimaryVmId?: string;
  freestyleSecondaryVmId?: string;
  _userId?: number | string;
  telegramBotToken?: string;
  telegramOwnerId?: number;
  discordBotToken?: string;
  discordGuildId?: string;
  primarySshTarget: string;
  secondarySshTarget?: string;
  openclawPort: number;
  omniroutePort: number;
  llamaPort: number;
  openclawToken: string;
  omniroutePassword: string;
  omnirouteApiKey?: string;
  vpsSpecs: VpsSpecs;
  railwayApiKey?: string;
  railwayDomain?: string;
  railwayUuid?: string;
  domainedUrlsEnabled?: boolean;
  ingressProvider?: 'railway' | 'freestyle' | 'none';
  publicBaseDomain?: string;
  customOpenclawUrl?: string;
  customOmnirouteUrl?: string;
  customLlamaUrl?: string;
  providers: Record<string, ProviderConfig>;
  llama: LlamaSettings;
}

export type StatusState = boolean | 'detecting';

export interface ServiceStatus {
  openclaw: StatusState;
  omniroute: StatusState;
  llama: StatusState;
  egressRelay: StatusState;
  primarySsh: StatusState;
  secondarySsh?: StatusState;
  sshRefreshError?: string;
}

export interface HuggingFaceModelInfo {
  repoId: string;
  isGguf: boolean;
  isMoe: boolean;
  hasMtp: boolean;
  quantizations: Array<{
    quant: string;
    filename: string;
    sizeBytes: number;
    sizeGb: number;
    downloadUrl: string;
    fitsRam: boolean;
  }>;
  minSizeBytes: number;
  minSizeGb: number;
  recommendedQuant?: string;
}

export interface RemoteVpsInspection {
  reachable: boolean;
  openclawInstalled: boolean;
  openclawToken?: string;
  omnirouteInstalled: boolean;
  omnirouteActive: boolean;
  railwayRelayConfigured: boolean;
  railwayDomain?: string;
  railwayUuid?: string;
  llamaInstalled: boolean;
  configuredProvidersCount?: number;
}

export interface DetectedVmConfig {
  reachable: boolean;
  openclawInstalled: boolean;
  openclawToken?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  discordGuildId?: string;
  omnirouteInstalled: boolean;
  omnirouteActive: boolean;
  railwayRelayConfigured: boolean;
  railwayDomain?: string;
  railwayUuid?: string;
  llamaInstalled: boolean;
  llamaRunning: boolean;
  llamaTopology?: 'same_vm' | 'second_vm';
  llamaEndpoint?: string;
  llamaModel?: string;
  llamaModelFile?: string;
  llamaModelPath?: string;
  llamaModelSize?: string;
}

export type MissingVmType = 'primary' | 'secondary' | 'both' | 'none';

export type VpsDetectorAction = 'skip_to_tui' | 'guided_repair' | 'vm_recovery' | 'full_onboarding';

export interface InstallationState {
  primaryReachable: boolean;
  secondaryReachable?: boolean;
  primaryOpenclaw: boolean;
  primaryOmniroute: boolean;
  primaryRailwayRelay?: boolean;
  secondaryLlama: boolean;
  isFullyConfigured: boolean;
  isPartiallyConfigured: boolean;
  recoveryNeeded?: boolean;
  missingVmType?: MissingVmType;
  missingServices: string[];
  primaryRenewError?: string;
  primaryRenewed?: boolean;
  secondaryRenewError?: string;
  secondaryRenewed?: boolean;
}

export interface DaytonaAccountQuota {
  valid: boolean;
  availableCores: number;
  availableRamGb: number;
  availableStorageGb: number;
  hardLimitCores: number;
  hardLimitRamGb: number;
  hardLimitStorageGb: number;
  error?: string;
}

export type ActiveTab = 'main_menu' | 'diagnostics' | 'logs' | 'service_manager' | 'ssh_select' | 'onboarding' | 'settings';
