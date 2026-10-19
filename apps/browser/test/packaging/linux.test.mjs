import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import appImageModule from 'app-builder-lib/out/targets/appimage/AppImageTarget.js';
import linuxModule from 'app-builder-lib/out/targets/LinuxTargetHelper.js';
import configModule from 'app-builder-lib/out/util/config/config.js';
import builderUtil from 'builder-util';

const metadata = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('Linux packaging configuration is accepted by electron-builder', async () => {
  await configModule.validateConfiguration(metadata.build, new builderUtil.DebugLogger());
});

test('the generated AppImage desktop entry preserves sandboxing and URL arguments', async () => {
  const packager = {
    platformSpecificBuildOptions: metadata.build.linux,
    config: metadata.build,
    appInfo: { productName: metadata.productName, buildVersion: metadata.version },
    executableName: metadata.name,
    fileAssociations: [],
    info: { metadata },
  };
  const helper = Object.create(linuxModule.LinuxTargetHelper.prototype);
  helper.packager = packager;
  const target = new appImageModule.default('AppImage', packager, helper, '/tmp');
  const desktop = await target.desktopEntry.value;
  assert.match(desktop, /^Exec=AppRun %U$/m);
  assert.doesNotMatch(desktop, /--no-sandbox/);
  assert.match(desktop, /x-scheme-handler\/http;/);
  assert.match(desktop, /x-scheme-handler\/https;/);
});
