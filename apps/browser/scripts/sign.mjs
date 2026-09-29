import { signAsync } from '@electron/osx-sign';

// electron-builder's own signer passes codesign the certificate name, which codesign cannot match when the
// name has non-ASCII letters ("Yaşar"). The options given to a custom signer carry the SHA-1 hash instead.
export default function sign(options) {
  return signAsync(options);
}
