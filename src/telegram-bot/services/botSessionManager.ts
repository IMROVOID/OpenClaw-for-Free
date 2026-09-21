import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../../control-panel/core/configManager.js';
import { UserDatabase } from '../../control-panel/core/userDatabase.js';
import { BotSessionData, OnboardingDraft, RecoveryDraft } from '../types.js';

export class BotSessionManager {
  private static sessions: Map<number, BotSessionData> = new Map();
  private static lastActivity: Map<number, number> = new Map();
  private static readonly TTL_MS = 2 * 60 * 60 * 1000; // 2 hours in-memory TTL

  static getSessionDir(): string {
    return ConfigManager.getSessionDir();
  }

  private static getSessionFilePath(userId: number): string {
    const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.getSessionDir(), `${safeId}.json`);
  }

  private static pruneStale(): void {
    const now = Date.now();
    for (const [id, time] of this.lastActivity.entries()) {
      if (now - time > this.TTL_MS) {
        this.sessions.delete(id);
        this.lastActivity.delete(id);
      }
    }
  }

  static defaultOnboardingDraft(): OnboardingDraft {
    return {
      provider: 'freestyle',
      primaryMethod: 'api',
      llamaTopology: 'dedicated',
      modelType: 'qwen7b',
      upstreamKeys: {}
    };
  }

  static defaultRecoveryDraft(): RecoveryDraft {
    return {
      missingType: 'primary',
      action: 'new_primary'
    };
  }

  static getSession(userId: number): BotSessionData {
    this.pruneStale();
    this.lastActivity.set(userId, Date.now());

    let session = this.sessions.get(userId);
    if (session) {
      return session;
    }

    // Try loading persisted session from SQLite DB first
    const fromDb = UserDatabase.getInstance().getUserSession(userId);
    if (fromDb) {
      session = {
        flow: fromDb.flow || 'none',
        step: fromDb.step || 0,
        onboardingDraft: fromDb.onboardingDraft || this.defaultOnboardingDraft(),
        recoveryDraft: fromDb.recoveryDraft || this.defaultRecoveryDraft(),
        awaitingField: fromDb.awaitingField,
        lastMenuMessageId: fromDb.lastMenuMessageId,
        lastLogsService: fromDb.lastLogsService,
        userMemory: fromDb.userMemory || {}
      };
      this.sessions.set(userId, session);
      return session;
    }

    // Try loading persisted session from legacy disk file
    const filePath = this.getSessionFilePath(userId);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        session = {
          flow: parsed.flow || 'none',
          step: parsed.step || 0,
          onboardingDraft: parsed.onboardingDraft || this.defaultOnboardingDraft(),
          recoveryDraft: parsed.recoveryDraft || this.defaultRecoveryDraft(),
          awaitingField: parsed.awaitingField,
          lastMenuMessageId: parsed.lastMenuMessageId,
          lastLogsService: parsed.lastLogsService,
          userMemory: parsed.userMemory || {}
        };
        UserDatabase.getInstance().saveUserSession(userId, session);
        this.sessions.set(userId, session);
        return session;
      }
    } catch (_) {}

    session = {
      flow: 'none',
      step: 0,
      onboardingDraft: this.defaultOnboardingDraft(),
      recoveryDraft: this.defaultRecoveryDraft(),
      userMemory: {}
    };
    this.sessions.set(userId, session);
    return session;
  }

  static saveSession(userId: number, session?: BotSessionData): void {
    const targetSession = session || this.sessions.get(userId);
    if (!targetSession) return;

    try {
      UserDatabase.getInstance().saveUserSession(userId, targetSession);
      const filePath = this.getSessionFilePath(userId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  }

  static resetSession(userId: number): BotSessionData {
    const current = this.sessions.get(userId);
    const userMem = { ...(current?.userMemory || {}) };
    delete userMem['onboarding:workspaces'];
    delete userMem['onboarding:llama-existing'];
    const fresh: BotSessionData = {
      flow: 'none',
      step: 0,
      onboardingDraft: this.defaultOnboardingDraft(),
      recoveryDraft: this.defaultRecoveryDraft(),
      userMemory: userMem
    };
    this.sessions.set(userId, fresh);
    this.lastActivity.set(userId, Date.now());
    this.saveSession(userId, fresh);
    return fresh;
  }

  static startOnboarding(userId: number): BotSessionData {
    const session = this.getSession(userId);
    session.flow = 'onboarding';
    session.step = 1;
    session.onboardingDraft = this.defaultOnboardingDraft();
    session.awaitingField = undefined;
    if (session.userMemory) {
      delete session.userMemory['onboarding:workspaces'];
      delete session.userMemory['onboarding:llama-existing'];
    }
    this.saveSession(userId, session);
    return session;
  }

  static setOnboardingStep(userId: number, step: number, awaitingField?: string): void {
    const session = this.getSession(userId);
    session.flow = 'onboarding';
    session.step = step;
    session.awaitingField = awaitingField;
    this.saveSession(userId, session);
  }

  static startRecovery(userId: number, missingType: 'primary' | 'secondary' | 'both' = 'primary'): BotSessionData {
    const session = this.getSession(userId);
    session.flow = 'recovery';
    session.step = 1;
    session.recoveryDraft = {
      missingType,
      action: missingType === 'secondary' ? 'new_secondary' : 'new_primary'
    };
    session.awaitingField = undefined;
    this.saveSession(userId, session);
    return session;
  }

  static clearFlow(userId: number): void {
    const session = this.getSession(userId);
    session.flow = 'none';
    session.step = 0;
    session.awaitingField = undefined;
    this.lastActivity.set(userId, Date.now());
    this.saveSession(userId, session);
  }

  static getUserMemory<T = any>(userId: number, key: string): T | undefined {
    const session = this.getSession(userId);
    return session.userMemory ? session.userMemory[key] : undefined;
  }

  static setUserMemory(userId: number, key: string, value: any): void {
    const session = this.getSession(userId);
    if (!session.userMemory) {
      session.userMemory = {};
    }
    session.userMemory[key] = value;
    this.saveSession(userId, session);
  }

  static clearUserSession(userId: number): void {
    this.sessions.delete(userId);
    this.lastActivity.delete(userId);
    try {
      UserDatabase.getInstance().deleteUserSession(userId);
      const filePath = this.getSessionFilePath(userId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  }

  static getActiveSessionCount(): number {
    this.pruneStale();
    return this.sessions.size;
  }

  static clearAll(): void {
    this.sessions.clear();
    this.lastActivity.clear();
  }
}
