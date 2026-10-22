# Contributing to Yalqen

Thanks for your interest in improving Yalqen.

## Before you start

- For bugs, search [existing issues](https://github.com/YSamed/yalqen/issues) first, then open one using the bug report template.
- For questions and ideas, use [Discussions](https://github.com/YSamed/yalqen/discussions).
- For larger changes or new features, open an issue to discuss the idea before writing code.
- Never report security vulnerabilities in public issues; follow [SECURITY.md](SECURITY.md).

## Development setup

Requires Node.js 24 and Git on macOS or Linux. Linux support is experimental; initial testing covers Ubuntu with GNOME Wayland. Windows is not yet supported.

```bash
npm install
cd apps/browser
npm ci
npm start
```

Running `npm install` at the repository root sets up Git hooks: commit messages are checked with commitlint, staged files are linted and formatted with ESLint and Prettier, and typecheck and tests run before each push.

## Testing Linux

In `apps/browser`, run `npm run check` for the standard checks and `npm run package:linux` to build an AppImage in `release/`. Test the packaged app as well as the development build. Chromium sandboxing requires working unprivileged user namespaces; Yalqen refuses to start with `--no-sandbox`.

When reporting a Linux issue, include your distribution and version, CPU architecture, desktop environment, display server (Wayland or X11), Yalqen version or commit, and steps to reproduce. Do not include credentials or private browsing data in logs.

Share platform test results in the [Linux preview discussion](https://github.com/YSamed/yalqen/discussions/280). Contributions for additional distributions, desktop environments, and Windows support are welcome.

## Making changes

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on a single change.
3. Add or update tests in `apps/browser/test` for behavior changes.
4. Run `npm run check` (lint, typecheck, tests) and `npm run format` in `apps/browser`.
5. Open a pull request and fill in the template. Type-specific templates are available for [bug fixes](PULL_REQUEST_TEMPLATE/bugfix.md), [features](PULL_REQUEST_TEMPLATE/feature.md) and [refactors](PULL_REQUEST_TEMPLATE/refactor.md); append `?template=feature.md` to the pull request URL to use one.

## Measuring performance

Run `npm run bench` in `apps/browser` to measure startup, page loads, the command bar and idle cost from fresh temporary profiles; `npm run bench -- --help` lists the options. Records are appended to `bench/results/` as JSONL and a median summary is printed. Compare against a run on `main` before and after a performance change. Earlier performance passes are written up in [docs/performance](../docs/performance/).

## Releasing

Releases are cut by release-please from the commit history; [RELEASING.md](../apps/browser/RELEASING.md) covers signing, notarization and publishing.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <imperative summary>
```

`type` is one of `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `style`, `build` or `ci`. Keep the summary lowercase with no trailing period, for example `fix: restore pinned tabs after crash`.

## Code style

- ESLint, Prettier and TypeScript settings in the repository are the source of truth.
- Prefer clear names and small functions over explanatory comments; comment only when the reason is not obvious from the code.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](../LICENSE).
