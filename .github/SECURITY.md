# Security Policy

## Supported versions

Yalqen is in early development. Only the latest release receives security fixes.

## Reporting a vulnerability

Do not open a public issue for security problems.

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/YSamed/yalqen/security/advisories/new). Include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The Yalqen version and macOS version you tested

You should receive a response within 7 days. Please allow time for a fix to be released before disclosing the issue publicly.

## Agent connection

The agent connection (Settings → Developer, off by default) runs a local MCP server so a coding agent can read local development tabs. Its threat model:

| Threat                                           | Mitigation                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| A web page sending requests to the local port    | The server binds to `127.0.0.1`; requests with an `Origin` header are rejected; `Host` is validated |
| Another process on the machine reaching the port | A 32-byte bearer token, stored encrypted with the macOS Keychain and regenerable at any time        |
| The agent reading a banking or email tab         | Only `localhost`, `127.0.0.0/8`, `[::1]`, `*.localhost`, `*.test`, `*.local` and origins you add    |
| Private browsing                                 | Tabs in private windows are never visible to the agent                                              |
| Secrets in network data                          | `Authorization`, `Cookie`, `Set-Cookie` and token-like headers are masked; bodies are truncated     |
| Prompt injection from page content               | Tool outputs that contain page text are marked as untrusted data                                    |
| Data becoming persistent                         | Console and network records stay in memory and are cleared when the tab closes or is discarded      |

When the setting is off, no port is open and no tab is observed.
