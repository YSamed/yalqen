import { sign as signApp } from '@electron/osx-sign';

export default function sign(options) {
  return signApp(options);
}
