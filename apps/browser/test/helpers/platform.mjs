import which from 'which';

export const winBash = async () => {
  const all = await which('bash', { all: true });
  // bash.exe in System32 is a stub to WSL
  // anything else is good: Git/Msys2
  return all.find((bash) => !/System32/i.test(bash));
};
