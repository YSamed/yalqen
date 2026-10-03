import fs from 'node:fs';
import path from 'node:path';

// Main modules live in domain folders (dist/main/library/history.js). Builds from before that
// move kept them flat, so a preserved baseline directory still resolves by file name.
export function mainModule(directory, file) {
  const nested = path.resolve(directory, file);
  return fs.existsSync(nested) ? nested : path.resolve(directory, path.basename(file));
}
