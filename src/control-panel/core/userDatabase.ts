import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { UserCryptoStorage } from './userCryptoStorage.js';
import { ControlPanelConfig } from './types.js';
import { BotSessionData } from '../../telegram-bot/types.js';

export class UserDatabase {
  private static instance: UserDatabase | null = null;
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || process.env.TELEGRAM_DB_PATH || path.join(
      process.env.TELEGRAM_DATA_DIR || path.join(process.cwd(), 'data', 'telegram'),
      'telegram_assistant.db'
    );

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  static getInstance(dbPath?: string): UserDatabase {
    if (!this.instance || (dbPath && this.instance.dbPath !== dbPath)) {
      if (this.instance) {
        this.instance.close();
      }
      this.instance = new UserDatabase(dbPath);
    }
    return this.instance;
  }

  static resetInstance(): void {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_configs (
        user_id TEXT PRIMARY KEY,
        encrypted_data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id TEXT PRIMARY KEY,
        encrypted_data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getUserConfig(userId: string | number): ControlPanelConfig | null {
    try {
      const safeId = UserCryptoStorage.sanitizeUserId(userId);
      const row = this.db.prepare('SELECT encrypted_data FROM user_configs WHERE user_id = ?').get(safeId) as { encrypted_data: string } | undefined;
      if (!row || !row.encrypted_data) {
        return null;
      }
      const dataDir = path.dirname(this.dbPath);
      const decrypted = UserCryptoStorage.decryptData(safeId, row.encrypted_data, dataDir);
      return JSON.parse(decrypted) as ControlPanelConfig;
    } catch (_) {
      return null;
    }
  }

  hasUserConfig(userId: string | number): boolean {
    try {
      const cfg = this.getUserConfig(userId);
      return Boolean(cfg && cfg.primarySshTarget && cfg.primarySshTarget.trim());
    } catch (_) {
      return false;
    }
  }

  saveUserConfig(userId: string | number, cfg: ControlPanelConfig): void {
    try {
      const safeId = UserCryptoStorage.sanitizeUserId(userId);
      const dataDir = path.dirname(this.dbPath);
      const plaintext = JSON.stringify(cfg);
      const encrypted = UserCryptoStorage.encryptData(safeId, plaintext, dataDir);
      const now = Date.now();

      this.db.prepare(`
        INSERT INTO user_configs (user_id, encrypted_data, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          encrypted_data = excluded.encrypted_data,
          updated_at = excluded.updated_at
      `).run(safeId, encrypted, now);
    } catch (err: any) {
      console.error('[WARN] UserDatabase: Failed to save user config:', err.message);
    }
  }

  deleteUserConfig(userId: string | number): void {
    try {
      const safeId = UserCryptoStorage.sanitizeUserId(userId);
      this.db.prepare('DELETE FROM user_configs WHERE user_id = ?').run(safeId);
    } catch (err: any) {
      console.error('[WARN] UserDatabase: Failed to delete user config:', err.message);
    }
  }

  getUserSession(userId: string | number): Partial<BotSessionData> | null {
    try {
      const safeId = UserCryptoStorage.sanitizeUserId(userId);
      const row = this.db.prepare('SELECT encrypted_data FROM user_sessions WHERE user_id = ?').get(safeId) as { encrypted_data: string } | undefined;
      if (!row || !row.encrypted_data) {
        return null;
      }
      const dataDir = path.dirname(this.dbPath);
      const decrypted = UserCryptoStorage.decryptData(safeId, row.encrypted_data, dataDir);
      return JSON.parse(decrypted) as Partial<BotSessionData>;
    } catch (_) {
      return null;
    }
  }

  saveUserSession(userId: string | number, session: BotSessionData): void {
    try {
      const safeId = UserCryptoStorage.sanitizeUserId(userId);
      const dataDir = path.dirname(this.dbPath);
      const plaintext = JSON.stringify(session);
      const encrypted = UserCryptoStorage.encryptData(safeId, plaintext, dataDir);
      const now = Date.now();

      this.db.prepare(`
        INSERT INTO user_sessions (user_id, encrypted_data, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          encrypted_data = excluded.encrypted_data,
          updated_at = excluded.updated_at
      `).run(safeId, encrypted, now);
    } catch (err: any) {
      console.error('[WARN] UserDatabase: Failed to save user session:', err.message);
    }
  }

  deleteUserSession(userId: string | number): void {
    try {
      const safeId = UserCryptoStorage.sanitizeUserId(userId);
      this.db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(safeId);
    } catch (err: any) {
      console.error('[WARN] UserDatabase: Failed to delete user session:', err.message);
    }
  }

  migrateFromFiles(baseDir?: string): void {
    const dataDir = baseDir || path.dirname(this.dbPath);
    const usersDir = path.join(dataDir, 'users');
    const sessionsDir = path.join(dataDir, 'sessions');

    // 1. Migrate user configs
    if (fs.existsSync(usersDir)) {
      try {
        const files = fs.readdirSync(usersDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const safeId = file.replace(/\.json$/, '');
          const filePath = path.join(usersDir, file);
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!this.getUserConfig(safeId)) {
              this.saveUserConfig(safeId, parsed);
            }
            // Securely remove legacy plaintext file after migration
            try { fs.unlinkSync(filePath); } catch (_) {}
          } catch (_) {}
        }
      } catch (_) {}
    }

    // 2. Migrate user sessions
    if (fs.existsSync(sessionsDir)) {
      try {
        const files = fs.readdirSync(sessionsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const safeId = file.replace(/\.json$/, '');
          const filePath = path.join(sessionsDir, file);
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!this.getUserSession(safeId)) {
              this.saveUserSession(safeId, parsed);
            }
            // Securely remove legacy plaintext file after migration
            try { fs.unlinkSync(filePath); } catch (_) {}
          } catch (_) {}
        }
      } catch (_) {}
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch (_) {}
  }
}
