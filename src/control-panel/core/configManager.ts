import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ControlPanelConfig, CloudProviderType } from './types.js';
import { UserDatabase } from './userDatabase.js';
import { UserCryptoStorage } from './userCryptoStorage.js';

const getProjectRootDir = (): string => {
  try {
    const curr = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(curr, '..', '..', '..');
  } catch (_) {
    return process.cwd();
  }
};

const TELEGRAM_DATA_DIR = process.env.TELEGRAM_DATA_DIR || path.join(getProjectRootDir(), 'data', 'telegram');
const USER_CONFIG_DIR = path.join(TELEGRAM_DATA_DIR, 'users');
const SESSION_DIR = path.join(TELEGRAM_DATA_DIR, 'sessions');
const BOT_LOCK_FILE = path.join(TELEGRAM_DATA_DIR, 'bot.lock');

const CONFIG_PATH = path.join(os.homedir(), '.openclaw-control-panel.json');

export const DEFAULT_CONFIG: ControlPanelConfig = {
  provider: 'freestyle',
  secondaryProvider: 'freestyle',
  primarySshTarget: '',
  secondarySshTarget: '',
  openclawPort: 18789,
  omniroutePort: 20128,
  llamaPort: 8080,
  openclawToken: '',
  omniroutePassword: 'CHANGEME',
  vpsSpecs: {
    cpuCores: 4,
    ramGb: 8,
    storageGb: 32
  },
  railwayDomain: '',
  railwayUuid: '',
  domainedUrlsEnabled: true,
  ingressProvider: 'freestyle',
  providers: {},
  llama: {
    enabled: false,
    isSeparateVps: false,
    sshTarget: '',
    modelUrl: '',
    modelName: '',
    quantization: '',
    contextSize: 8192,
    batchSize: 512,
    threads: 4,
    enableMtp: false,
    enableFlashAttn: true,
    isMoe: false,
    kvCacheQuant: 'q4_0',
    railwayEndpointUrl: '',
    freestyleDomainUrl: '',
    activeEndpointUrl: ''
  }
};

export class ConfigManager {
  static getTelegramDataDir(): string {
    return TELEGRAM_DATA_DIR;
  }

  static getSessionDir(): string {
    return SESSION_DIR;
  }

  static getBotLockPath(): string {
    return BOT_LOCK_FILE;
  }

  static getConfigPath(): string {
    return CONFIG_PATH;
  }

  static getUserConfigDir(): string {
    return USER_CONFIG_DIR;
  }

  static getUserConfigPath(userId: string | number): string {
    const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(USER_CONFIG_DIR, `${safeId}.json`);
  }

  static hasConfig(): boolean {
    if (!fs.existsSync(CONFIG_PATH)) return false;
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return Boolean(parsed.primarySshTarget && parsed.primarySshTarget.trim());
    } catch (_) {
      return false;
    }
  }

  static hasUserConfig(userId: string | number): boolean {
    if (UserDatabase.getInstance().hasUserConfig(userId)) {
      return true;
    }
    const p = this.getUserConfigPath(userId);
    if (!fs.existsSync(p)) return false;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const has = Boolean(parsed.primarySshTarget && parsed.primarySshTarget.trim());
      if (has) {
        UserDatabase.getInstance().saveUserConfig(userId, parsed);
      }
      return has;
    } catch (_) {
      return false;
    }
  }

  static clear(): void {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        fs.unlinkSync(CONFIG_PATH);
      }
      const home = os.homedir();
      for (const f of ['.openclaw-connect.json', '.omniroute-connect.json', '.llama-connect.json']) {
        const lp = path.join(home, f);
        if (fs.existsSync(lp)) {
          try { fs.unlinkSync(lp); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  static clearUserConfig(userId: string | number): void {
    try {
      UserDatabase.getInstance().deleteUserConfig(userId);
      const p = this.getUserConfigPath(userId);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch (_) {}
  }

  private static sanitizeConfig(parsed: any, base: ControlPanelConfig = DEFAULT_CONFIG): ControlPanelConfig {
    return {
      ...base,
      ...parsed,
      omniroutePassword: (parsed.omniroutePassword && parsed.omniroutePassword !== 'admin123456') ? parsed.omniroutePassword : 'CHANGEME',
      provider: (parsed.provider === 'daytona' || parsed.provider === 'freestyle') ? parsed.provider : 'freestyle',
      vpsSpecs: { ...base.vpsSpecs, ...(parsed.vpsSpecs || {}) },
      llama: { ...base.llama, ...(parsed.llama || {}) },
      providers: { ...base.providers, ...(parsed.providers || {}) }
    };
  }

  static load(): ControlPanelConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return this.sanitizeConfig(parsed);
      }
    } catch (_) {}

    // Attempt import from legacy configs if new config is absent
    return this.importLegacyConfigs();
  }

  static loadForUser(userId: string | number): ControlPanelConfig {
    const numId = typeof userId === 'number' ? userId : parseInt(String(userId), 10);
    const base: ControlPanelConfig = {
      ...DEFAULT_CONFIG,
      telegramOwnerId: !isNaN(numId) ? numId : undefined,
      _userId: userId
    };

    const fromDb = UserDatabase.getInstance().getUserConfig(userId);
    if (fromDb) {
      const config = this.sanitizeConfig(fromDb, base);
      config._userId = userId;
      return config;
    }

    const userPath = this.getUserConfigPath(userId);
    try {
      if (fs.existsSync(userPath)) {
        const raw = fs.readFileSync(userPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const config = this.sanitizeConfig(parsed, base);
        config._userId = userId;
        UserDatabase.getInstance().saveUserConfig(userId, config);
        return config;
      }
    } catch (_) {}

    return base;
  }

  static saveUserConfig(userId: string | number, cfg: ControlPanelConfig): void {
    try {
      UserDatabase.getInstance().saveUserConfig(userId, cfg);
      const userPath = this.getUserConfigPath(userId);
      if (fs.existsSync(userPath)) {
        fs.unlinkSync(userPath);
      }
    } catch (_) {}
  }

  static save(cfg: ControlPanelConfig, userId?: string | number): void {
    const targetUserId = userId ?? cfg._userId;
    if (targetUserId !== undefined) {
      this.saveUserConfig(targetUserId, cfg);
      return;
    }
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch (_) {}
  }

  static parseSshTarget(input: string, fallback: string, provider: CloudProviderType = 'daytona'): string {
    if (!input || !input.trim()) return fallback;
    let clean = input.trim().replace(/^["']|["']$/g, '').replace(/^ssh\s+/i, '').trim();
    // Block argument flags or shell metacharacters for security
    if (clean.startsWith('-') || /[^\w.@:\-]/.test(clean)) {
      return fallback;
    }
    const match = clean.match(/([a-zA-Z0-9_\-\.:]+@[a-zA-Z0-9_\-\.]+)/);
    if (match) return match[1];
    if (provider === 'freestyle') {
      if (clean.includes(':')) {
        return `${clean}@beta-ssh.freestyle.sh`;
      }
      return clean;
    }
    if (/^[a-zA-Z0-9_\-]+$/.test(clean)) {
      return `${clean}@ssh.app.daytona.io`;
    }
    return clean;
  }

  private static importLegacyConfigs(): ControlPanelConfig {
    const cfg = { ...DEFAULT_CONFIG };
    const home = os.homedir();
    const ocPath = path.join(home, '.openclaw-connect.json');
    const orPath = path.join(home, '.omniroute-connect.json');
    const lmPath = path.join(home, '.llama-connect.json');

    try {
      if (fs.existsSync(ocPath)) {
        const oc = JSON.parse(fs.readFileSync(ocPath, 'utf-8'));
        if (oc.sshTarget) cfg.primarySshTarget = oc.sshTarget;
        if (oc.openclawPort) cfg.openclawPort = oc.openclawPort;
        if (oc.omniroutePort) cfg.omniroutePort = oc.omniroutePort;
        if (oc.token) cfg.openclawToken = oc.token;
        if (oc.omniroutePassword) {
          cfg.omniroutePassword = oc.omniroutePassword === 'admin123456' ? 'CHANGEME' : oc.omniroutePassword;
        }
      }
      if (fs.existsSync(orPath)) {
        const or = JSON.parse(fs.readFileSync(orPath, 'utf-8'));
        if (or.password) {
          cfg.omniroutePassword = or.password === 'admin123456' ? 'CHANGEME' : or.password;
        }
      }
      if (fs.existsSync(lmPath)) {
        const lm = JSON.parse(fs.readFileSync(lmPath, 'utf-8'));
        if (lm.sshTarget) {
          cfg.secondarySshTarget = lm.sshTarget;
          cfg.llama.sshTarget = lm.sshTarget;
        }
        if (lm.modelName) cfg.llama.modelName = lm.modelName;
      }
    } catch (_) {}

    return cfg;
  }
}
