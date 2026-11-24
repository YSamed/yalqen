import { execFileSync } from 'node:child_process';

const python = process.platform === 'win32' ? 'python' : 'python3';

// Production VMP signing needs a castLabs EVS account; without one the build keeps the development signature.
export function vmpSign(packageDir) {
  if (!process.env.EVS_ACCOUNT_NAME) {
    console.warn('EVS_ACCOUNT_NAME is not set, skipping production VMP signing');
    return;
  }
  const evs = (...args) => execFileSync(python, ['-m', 'castlabs_evs.vmp', '-n', ...args], { stdio: 'inherit' });
  evs('sign-pkg', packageDir);
  evs('verify-pkg', packageDir);
}
