import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { DB_PATH } from '../config.js';

/**
 * Symmetric encryption for sensitive settings (OAuth client secret, refresh
 * token) stored in the SQLite `settings` table. Uses AES-256-GCM.
 *
 * Key resolution:
 *  - TODO_SECRET_KEY env (64 hex chars) if provided, else
 *  - a key auto-generated once and persisted to a 0600 file next to the DB.
 *
 * Encrypted values are tagged with an "enc:v1:" prefix so legacy plaintext
 * values (and non-secret settings) are handled transparently on read.
 */

const PREFIX = 'enc:v1:';
let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.TODO_SECRET_KEY;
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) {
      throw new Error('TODO_SECRET_KEY must be 64 hex characters (32 bytes).');
    }
    cachedKey = Buffer.from(fromEnv, 'hex');
    return cachedKey;
  }

  const keyPath = path.join(path.dirname(DB_PATH), '.todo-secret-key');
  if (fs.existsSync(keyPath)) {
    cachedKey = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
  } else {
    cachedKey = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, cachedKey.toString('hex'), { mode: 0o600 });
    console.log(`[secrets] Generated at-rest encryption key: ${keyPath}`);
  }
  return cachedKey;
}

export function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // plaintext / non-secret
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
