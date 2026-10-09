import { generateKeyPairSync } from 'node:crypto';
import store from '../../dist/main/extensions/chrome-web-store.js';

export function storeIdentity() {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  return { key, id: store.extensionIdOfKey(key) };
}

export function extensionPackage(identity, manifest) {
  const files = [
    ['manifest.json', JSON.stringify(manifest)],
    ['content.txt', `version ${manifest.version}`],
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const filename = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, filename, data);
    centrals.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  const header = Buffer.alloc(16);
  header.write('Cr24');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(identity.key.length, 8);
  return Buffer.concat([header, identity.key, ...locals, central, end]);
}
