import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface EncryptedEnvelope {
  $encrypted: true;
  v: number;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
  updatedAt: number;
}

export class UserCryptoStorage {
  private static cachedMasterKey: Buffer | null = null;

  static sanitizeUserId(userId: string | number): string {
    const str = String(userId).trim();
    if (!str || !/^[a-zA-Z0-9_-]+$/.test(str) || str.length > 64) {
      throw new Error(`Invalid userId: "${userId}". Must be 1-64 alphanumeric, dash, or underscore chars.`);
    }
    return str;
  }

  static getMasterKey(dataDir?: string): Buffer {
    if (this.cachedMasterKey) {
      return this.cachedMasterKey;
    }

    const envKey = process.env.OPENCLAW_DATA_ENCRYPTION_KEY ||
      process.env.DATA_ENCRYPTION_KEY ||
      process.env.TELEGRAM_DATA_ENCRYPTION_KEY;

    if (envKey && envKey.trim()) {
      const clean = envKey.trim();
      const keyBuf = clean.length === 64 && /^[0-9a-fA-F]+$/.test(clean)
        ? Buffer.from(clean, 'hex')
        : crypto.scryptSync(clean, 'openclaw_master_kdf_salt_2026', 32);
      this.cachedMasterKey = keyBuf;
      return keyBuf;
    }

    const targetDir = dataDir || process.env.TELEGRAM_DATA_DIR || path.join(process.cwd(), 'data', 'telegram');
    const keyFile = path.join(targetDir, '.master.key');

    try {
      if (fs.existsSync(keyFile)) {
        const raw = fs.readFileSync(keyFile);
        if (raw.length === 32) {
          this.cachedMasterKey = raw;
          return raw;
        }
        if (raw.length === 64) {
          const parsed = Buffer.from(raw.toString('utf-8').trim(), 'hex');
          if (parsed.length === 32) {
            this.cachedMasterKey = parsed;
            return parsed;
          }
        }
      }
    } catch (err: any) {
      console.error('[WARN] UserCryptoStorage: Failed to read master key file:', err.message);
    }

    // Generate new 256-bit random master key and persist with restricted permissions
    const newKey = crypto.randomBytes(32);
    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(keyFile, newKey, { mode: 0o600 });
    } catch (err: any) {
      console.error('[FATAL] UserCryptoStorage: Failed to persist master key to disk:', err.message);
      throw new Error(`Failed to persist encryption master key to "${keyFile}": ${err.message}`);
    }

    this.cachedMasterKey = newKey;
    return newKey;
  }

  static setMasterKeyForTesting(key: Buffer | null): void {
    this.cachedMasterKey = key;
  }

  static deriveUserKey(userId: string | number, dataDir?: string): Buffer {
    const safeId = this.sanitizeUserId(userId);
    const masterKey = this.getMasterKey(dataDir);
    // Derive a high-entropy durable salt deterministically from master key
    const salt = crypto.createHmac('sha256', masterKey).update('openclaw_user_salt_kdf').digest().subarray(0, 16);
    const info = Buffer.from(`openclaw_user_${safeId}`, 'utf-8');
    const derived = crypto.hkdfSync('sha256', masterKey, salt, info, 32);
    return Buffer.from(derived);
  }

  static encryptData(userId: string | number, plaintext: string, dataDir?: string): string {
    const userKey = this.deriveUserKey(userId, dataDir);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', userKey, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    const envelope: EncryptedEnvelope = {
      $encrypted: true,
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: ciphertext.toString('base64'),
      updatedAt: Date.now()
    };

    return JSON.stringify(envelope);
  }

  static decryptData(userId: string | number, payload: string, dataDir?: string): string {
    if (!payload || typeof payload !== 'string') {
      return '';
    }

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch (_) {
      // Not JSON, return as-is
      return payload;
    }

    if (!parsed || parsed.$encrypted !== true) {
      // Legacy unencrypted JSON payload
      return payload;
    }

    const envelope = parsed as EncryptedEnvelope;
    if (envelope.alg !== 'aes-256-gcm' || !envelope.iv || !envelope.tag || !envelope.data) {
      throw new Error('Unsupported or corrupted encrypted envelope format');
    }

    const userKey = this.deriveUserKey(userId, dataDir);
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.data, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', userKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return decrypted.toString('utf-8');
  }
}
