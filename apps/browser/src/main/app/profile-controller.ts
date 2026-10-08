import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import { t } from '../../shared/i18n.js';
import type { ProfilesResult, ProfilesView } from '../../shared/types.js';
import { DEFAULT_PROFILE_ID, ProfileError, ProfileRegistry, profileArguments } from './profiles.js';

function launchProfile(id: string): Promise<void> {
  const args = profileArguments(app.isPackaged ? [] : [app.getAppPath()], id);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export class ProfileController {
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private name: string;
  constructor(
    readonly registry: ProfileRegistry,
    readonly id: string,
    name: string,
    private readonly changed: () => void,
    private readonly launch: (id: string) => Promise<void> = launchProfile,
    private readonly dialogs: Pick<typeof dialog, 'showMessageBox'> = dialog,
  ) {
    this.name = name;
  }

  currentName(): string {
    return this.name;
  }
  view(): ProfilesView {
    return this.registry.view(this.id);
  }

  start(): void {
    this.watcher = fs.watch(this.registry.root, (_event, filename) => {
      if (!filename?.startsWith(path.basename(this.registry.file))) return;
      this.timer ??= setTimeout(() => {
        this.timer = null;
        try {
          this.refreshName();
          this.changed();
        } catch {}
      }, 100);
    });
    this.watcher.unref();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.registry.close();
  }

  async run(action: unknown, id: unknown, name: unknown): Promise<ProfilesResult> {
    try {
      switch (action) {
        case 'create':
          this.registry.create(name);
          break;
        case 'rename':
          this.registry.rename(id, name);
          break;
        case 'default':
          this.registry.makeDefault(id);
          break;
        case 'open': {
          const profile = this.view().profiles.find((entry) => entry.id === id);
          if (!profile) throw new ProfileError('missing');
          await this.launch(profile.id);
          break;
        }
        case 'remove': {
          const profile = this.view().profiles.find((entry) => entry.id === id);
          if (!profile) throw new ProfileError('missing');
          if (profile.active || profile.id === DEFAULT_PROFILE_ID) throw new ProfileError('protected');
          if (profile.running) throw new ProfileError('busy');
          const { response } = await this.dialogs.showMessageBox({
            type: 'warning',
            message: t('profiles.removeTitle', { name: profile.name }),
            detail: t('profiles.removeDetail'),
            buttons: [t('profiles.cancel'), t('profiles.remove')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (response === 1) this.registry.remove(profile.id, this.id);
          break;
        }
        default:
          throw new ProfileError('failed');
      }
      this.refreshName();
      this.changed();
      return { view: this.view(), error: null };
    } catch (error) {
      return { view: this.view(), error: error instanceof ProfileError ? error.kind : 'failed' };
    }
  }

  private refreshName(): void {
    this.name = this.view().profiles.find((profile) => profile.id === this.id)?.name ?? this.name;
  }
}
