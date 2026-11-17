import fs from 'node:fs';
import path from 'node:path';

export function mainModule(directory, file) {
  const nested = path.resolve(directory, file);
  return fs.existsSync(nested) ? nested : path.resolve(directory, path.basename(file));
}
