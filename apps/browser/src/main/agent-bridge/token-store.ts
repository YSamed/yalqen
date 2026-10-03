import fs from 'node:fs';
import path from 'node:path';
import type { Cipher } from '../privacy/passwords.js';
import { generateToken } from './auth.js';

interface SavedToken {
  version: 1;
  secret: string;
}

export class AgentTokenStore {
  private readonly file: string;
  private token: string | null = null;

  constructor(
    directory: string,
    private readonly cipher: Cipher,
  ) {
    this.file = path.join(directory, 'agent-bridge.json');
  }

  get(): string {
    this.token ??= this.load() ?? this.replace();
    return this.token;
  }

  regenerate(): string {
    this.token = this.replace();
    return this.token;
  }

  private load(): string | null {
    if (!this.cipher.available()) return null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SavedToken>;
      return typeof saved.secret === 'string' ? this.cipher.decrypt(saved.secret) || null : null;
    } catch {
      return null;
    }
  }

  // Without Keychain encryption the token lives only in memory and changes on every launch.
  private replace(): string {
    const token = generateToken();
    if (!this.cipher.available()) return token;
    try {
      const saved: SavedToken = { version: 1, secret: this.cipher.encrypt(token) };
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(saved), { mode: 0o600 });
    } catch (error) {
      console.warn('[agent-bridge] could not save the token:', error);
    }
    return token;
  }
}
