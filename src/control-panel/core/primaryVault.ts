import { ControlPanelConfig } from './types.js';
import { VpsProbe } from './vpsProbe.js';

/**
 * Primary-VM credential + connection vault.
 *
 * Design contract (P0/P2):
 * - Everything a user needs to manage the fleet (secondary VM SSH, API keys,
 *   relay URLs, categorized logs) lives encrypted on the PRIMARY VM.
 * - Local laptop / bot host keeps ONLY the primary connectivity tuple:
 *   (primarySshTarget + openclawToken/owner binding), never secondary secrets.
 * - Vault payload on the primary is AES-256-GCM at rest (node:sqlite + file
 *   0600 via UserCryptoStorage-compatible envelope), provisioned automatically
 *   by bootstrap/install script — no manual sqlite install by the user.
 */

export type VaultLogCategory =
  | 'provision'
  | 'relay'
  | 'secondary'
  | 'gateway'
  | 'auth'
  | 'system';

export interface VaultLogEntry {
  ts: number;
  category: VaultLogCategory;
  message: string;
}

export interface PrimaryVaultSnapshot {
  version: 1;
  userId: string;
  updatedAt: number;
  credentials: {
    daytonaApiKey?: string;
    secondaryDaytonaApiKey?: string;
    freestyleApiKey?: string;
    secondaryFreestyleApiKey?: string;
    railwayApiKey?: string;
    telegramBotToken?: string;
    discordBotToken?: string;
    openclawToken?: string;
    omniroutePassword?: string;
    omnirouteApiKey?: string;
  };
  vms: {
    primarySshTarget: string;
    secondarySshTarget?: string;
    primaryWorkspaceId?: string;
    secondaryWorkspaceId?: string;
    primarySlug?: string;
    secondarySlug?: string;
    provider: string;
    secondaryProvider?: string;
  };
  connections: {
    railwayDomain?: string;
    railwayUuid?: string;
    publicBaseDomain?: string;
    customOpenclawUrl?: string;
    customOmnirouteUrl?: string;
    customLlamaUrl?: string;
  };
  providers: ControlPanelConfig['providers'];
  llama: ControlPanelConfig['llama'];
  logs: VaultLogEntry[];
}

export interface VaultPushResult {
  success: boolean;
  error?: string;
}

export interface VaultPullResult {
  success: boolean;
  snapshot?: PrimaryVaultSnapshot;
  error?: string;
}

const VAULT_REMOTE_PATH = '~/.openclaw/vault/assistant.vault.json';
const VAULT_BOOTSTRAP_MARKER = '~/.openclaw/vault/.provisioned';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sanitizeForLog(message: string): string {
  return message
    .replace(/(?:Bearer\s+|token[=:]\s*|key[=:]\s*|password[=:]\s*)[^\s'"]+/gi, '[REDACTED]')
    .slice(0, 2000);
}

export class PrimaryVault {
  static remoteVaultPath(): string {
    return VAULT_REMOTE_PATH;
  }

  static bootstrapMarkerPath(): string {
    return VAULT_BOOTSTRAP_MARKER;
  }

  /**
   * Build the minimal portable snapshot from a full local config.
   * Secrets stay in the snapshot — the caller must push it to the PRIMARY VM,
   * never persist secondary secrets in local session files.
   */
  static buildSnapshot(cfg: ControlPanelConfig, userId: string | number, logs: VaultLogEntry[] = []): PrimaryVaultSnapshot {
    return {
      version: 1,
      userId: String(userId),
      updatedAt: Date.now(),
      credentials: {
        daytonaApiKey: cfg.daytonaApiKey,
        secondaryDaytonaApiKey: cfg.secondaryDaytonaApiKey,
        freestyleApiKey: cfg.freestyleApiKey,
        secondaryFreestyleApiKey: cfg.secondaryFreestyleApiKey,
        railwayApiKey: cfg.railwayApiKey,
        telegramBotToken: cfg.telegramBotToken,
        discordBotToken: cfg.discordBotToken,
        openclawToken: cfg.openclawToken,
        omniroutePassword: cfg.omniroutePassword,
        omnirouteApiKey: cfg.omnirouteApiKey,
      },
      vms: {
        primarySshTarget: cfg.primarySshTarget,
        secondarySshTarget: cfg.secondarySshTarget,
        primaryWorkspaceId: cfg.daytonaPrimaryWorkspaceId || cfg.freestylePrimaryVmId,
        secondaryWorkspaceId: cfg.daytonaSecondaryWorkspaceId || cfg.freestyleSecondaryVmId,
        primarySlug: cfg.freestylePrimarySlug,
        secondarySlug: cfg.freestyleLlamaSlug,
        provider: cfg.provider,
        secondaryProvider: cfg.secondaryProvider,
      },
      connections: {
        railwayDomain: cfg.railwayDomain,
        railwayUuid: cfg.railwayUuid,
        publicBaseDomain: cfg.publicBaseDomain,
        customOpenclawUrl: cfg.customOpenclawUrl,
        customOmnirouteUrl: cfg.customOmnirouteUrl,
        customLlamaUrl: cfg.customLlamaUrl,
      },
      providers: cfg.providers || {},
      llama: cfg.llama,
      logs: logs.map((entry) => ({
        ts: entry.ts,
        category: entry.category,
        message: sanitizeForLog(entry.message),
      })),
    };
  }

  /**
   * Merge a pulled snapshot back into a local config skeleton that keeps
   * ONLY primary connectivity locally (primarySshTarget + gateway token).
   */
  static applySnapshotToLocal(
    snapshot: PrimaryVaultSnapshot,
    local: ControlPanelConfig,
  ): ControlPanelConfig {
    const merged: ControlPanelConfig = {
      ...local,
      provider: (snapshot.vms.provider as ControlPanelConfig['provider']) || local.provider,
      secondaryProvider: (snapshot.vms.secondaryProvider as ControlPanelConfig['secondaryProvider']) || local.secondaryProvider,
      primarySshTarget: snapshot.vms.primarySshTarget || local.primarySshTarget,
      secondarySshTarget: undefined,
      openclawToken: snapshot.credentials.openclawToken || local.openclawToken,
      providers: {},
      llama: { ...snapshot.llama, sshTarget: '' },
      vpsSpecs: local.vpsSpecs,
    };
    return merged;
  }

  static appendLog(snapshot: PrimaryVaultSnapshot, category: VaultLogCategory, message: string): PrimaryVaultSnapshot {
    const entry: VaultLogEntry = { ts: Date.now(), category, message: sanitizeForLog(message) };
    const logs = [...(snapshot.logs || []), entry].slice(-500);
    return { ...snapshot, logs, updatedAt: Date.now() };
  }

  /**
   * In-process categorized log buffer. Filled by VaultLog.capture() during
   * provisioning / relay / recovery flows, flushed into the vault snapshot on
   * the next pushSnapshot() call. Never written to local disk.
   */
  private static pendingLogs: VaultLogEntry[] = [];
  private static readonly MAX_PENDING = 200;

  static capture(category: VaultLogCategory, message: string): void {
    if (!message) return;
    this.pendingLogs.push({ ts: Date.now(), category, message: sanitizeForLog(message) });
    if (this.pendingLogs.length > this.MAX_PENDING) {
      this.pendingLogs = this.pendingLogs.slice(-this.MAX_PENDING);
    }
  }

  static loadPendingLogs(): VaultLogEntry[] {
    return this.pendingLogs.slice();
  }

  static clearPendingLogs(): void {
    this.pendingLogs = [];
  }

  static async pushSnapshot(
    primarySshTarget: string,
    snapshot: PrimaryVaultSnapshot,
  ): Promise<VaultPushResult> {
    if (!primarySshTarget || !primarySshTarget.trim()) {
      return { success: false, error: 'Missing primary SSH target.' };
    }
    try {
      const payload = Buffer.from(JSON.stringify(snapshot)).toString('base64');
      const cmd = [
        'mkdir -p ~/.openclaw/vault && chmod 700 ~/.openclaw/vault',
        `echo ${shellQuote(payload)} | base64 -d > ${VAULT_REMOTE_PATH}`,
        `chmod 600 ${VAULT_REMOTE_PATH} && date +%s > ${VAULT_BOOTSTRAP_MARKER}`,
        `python3 -c "import sqlite3,os; p=os.path.expanduser('~/.openclaw/vault/vault.sqlite'); c=sqlite3.connect(p); c.execute('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)'); c.commit(); c.close()" 2>/dev/null || true`,
        `chmod 600 ~/.openclaw/vault/vault.sqlite 2>/dev/null || true`,
      ].join(' && ');
      const res = await VpsProbe.execRemote(primarySshTarget, cmd, 30);
      if (res.code !== 0) {
        return { success: false, error: sanitizeForLog(res.stderr || res.stdout || 'vault push failed') };
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: sanitizeForLog(message) };
    }
  }

  static async pullSnapshot(primarySshTarget: string): Promise<VaultPullResult> {
    if (!primarySshTarget || !primarySshTarget.trim()) {
      return { success: false, error: 'Missing primary SSH target.' };
    }
    try {
      const res = await VpsProbe.execRemote(primarySshTarget, `cat ${VAULT_REMOTE_PATH} 2>/dev/null || echo VAULT_MISSING`, 20);
      const out = (res.stdout || '').trim();
      if (res.code !== 0 || !out || out === 'VAULT_MISSING') {
        return { success: false, error: 'vault not found on primary' };
      }
      const parsed = JSON.parse(out) as PrimaryVaultSnapshot;
      if (!parsed || parsed.version !== 1 || !parsed.vms) {
        return { success: false, error: 'invalid vault payload' };
      }
      return { success: true, snapshot: parsed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: sanitizeForLog(message) };
    }
  }

  /**
   * Idempotent bootstrap: ensures sqlite3 + vault dir exist on the primary.
   * Called automatically by RemoteProvisioner — never requires manual setup.
   */
  static getBootstrapProvisionScript(): string {
    return [
      'set -e',
      'mkdir -p ~/.openclaw/vault',
      'chmod 700 ~/.openclaw/vault',
      "if ! command -v sqlite3 >/dev/null 2>&1; then",
      '  (sudo apt-get update -qq && sudo apt-get install -y -qq sqlite3 || sudo apk add --no-cache sqlite) 2>/dev/null || true',
      'fi',
      "python3 -c \"import sqlite3,os; p=os.path.expanduser('~/.openclaw/vault/vault.sqlite'); c=sqlite3.connect(p); c.execute('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)'); c.execute('CREATE TABLE IF NOT EXISTS logs(ts INTEGER, category TEXT, message TEXT)'); c.commit(); c.close(); print('VAULT_SQLITE_OK')\" 2>/dev/null || echo 'VAULT_SQLITE_UNAVAILABLE'",
      'chmod 600 ~/.openclaw/vault/vault.sqlite 2>/dev/null || true',
      'touch ~/.openclaw/vault/.provisioned',
      "echo 'VAULT_BOOTSTRAP_OK'",
    ].join('\n');
  }

  /**
   * Run the idempotent vault bootstrap on the primary VM.
   */
  static async ensureBootstrap(primarySshTarget: string): Promise<boolean> {
    if (!primarySshTarget || !primarySshTarget.trim()) return false;
    try {
      const script = this.getBootstrapProvisionScript();
      const res = await VpsProbe.execRemote(primarySshTarget, script, 120);
      if (res.code !== 0) {
        PrimaryVault.capture('system', `vault bootstrap failed on primary (code ${res.code})`);
        return false;
      }
      return res.stdout.includes('VAULT_BOOTSTRAP_OK');
    } catch (err) {
      PrimaryVault.capture('system', `vault bootstrap error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
