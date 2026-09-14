# dsh-net-policy

A DSH (DeepSeek Harness) plugin that gives one Harness process an outbound
transport policy: extra trusted CA certificates, per-host certificate
verification, and per-host HTTP proxies — none of which the shipped model
configuration can express.

Everything the Harness sends through the global `fetch` — the LLM adapters
(`dsh-llm-pi-ai`, `dsh-llm-deepseek`), web search, HTTP MCP servers — reaches
undici's global dispatcher, so one policy installed here covers all of them
without touching a single provider entry.

## Installation

```bash
dsh plugin --profile desktop add dsh-net-policy
```

From a local tarball (same command, a path instead of a name):

```bash
dsh plugin --profile desktop add /path/to/dsh-net-policy-0.2.0.tgz
```

On DSH Desktop the bundled CLI is the one to use, because it carries the pnpm
version that matches the profile's store:

```bash
"$HOME/Library/Application Support/DSH Desktop/cli/"*/bin/dsh plugin --profile desktop add /path/to/dsh-net-policy-0.2.0.tgz
```

`dsh plugin add` reconciles `dsh.profile.bundles` itself, so the plugin becomes
a profile layer as soon as it is installed. Restart the app once to load it.

## Settings page

The plugin adds its own **Network** section to Settings (beside Models and Git
Worktree). The form edits the same document described below — a default proxy,
its bypass list, extra CA files, the global verification switch, and the
per-host rules — and saves through the plugin's own route, which validates the
document before storing it and applies the new policy immediately. Everything
the page can do is also doable by editing the file by hand; the page is the
same document with labels.

## Configuration

The plugin reads `$DSH_HOME/net-policy.json` (`~/.dsh/net-policy.json` by
default). The file is re-read while the app runs: an edit takes effect on the
next request, with no restart. When the file does not exist, the plugin's own
config from the profile patch layer is used instead.

```json
{
  "proxy": "http://127.0.0.1:7890",
  "noProxy": ["corp.example", "192.168.31.179"],
  "caFiles": ["~/certs/corp-root.pem"],
  "insecure": false,
  "rules": [
    { "host": "llm.internal.example", "insecure": true, "proxy": null },
    { "host": "*.corp.example", "proxy": "http://proxy.corp.example:3128" }
  ]
}
```

| Field | Meaning |
|---|---|
| `proxy` | Default proxy for every origin. `http:` and `https:` proxy URLs only; SOCKS is rejected with a named error. |
| `noProxy` | Host entries that stay direct. |
| `caFiles` | PEM files added to this process's default trust store, on top of everything it already trusts. |
| `insecure` | Skip certificate verification for every host. Prefer a rule. |
| `rules` | Per-host overrides, first match wins. Each entry takes `host` (one entry or a list), and any of `proxy`, `insecure`, `caFiles`. |
| `settingsFile` | Plugin-config-only: point the plugin at a different settings file. |

A host entry matches the host and every subdomain under it, so `example.com`
also covers `api.example.com`; `.example.com` and `*.example.com` mean the same
thing, and `*` matches everything. `"proxy": null` in a rule sends that host
direct even when the document root names a proxy.

Loopback is always direct: `localhost`, the whole `127.0.0.0/8` range, and
`::1` never go through a proxy, because the Harness's own web server and local
model servers would otherwise loop through it. Their verification answer still
follows the policy, so a local server with a self-signed certificate can be
reached with a rule.

To configure it from the profile patch layer instead of the file, address the
inserted row by id in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: net-policy
  config:
    proxy: http://127.0.0.1:7890
```

## Platforms

macOS, Windows, and Linux, on Node 22.19 or newer. Nothing in the plugin
shells out or assumes a path layout, and the Windows specifics are handled:

- The settings file is `%USERPROFILE%\.dsh\net-policy.json` when `DSH_HOME` is
  unset. A byte-order mark — what Notepad writes — is accepted.
- Certificate paths take either separator, and `~\certs\root-ca.cer` expands
  the same way `~/certs/root-ca.pem` does.
- A certificate exported from the Windows certificate store as **DER**
  (`.cer`, `.der`, "Binary X.509") is converted on load. Node's trust APIs drop
  DER silently, so without this a saved policy would look applied and the
  connection would still fail. Base64/PEM exports and multi-certificate bundles
  are passed through whole.
- A save that cannot replace the file atomically — a scanner or an editor
  holding it open, which only happens on Windows — falls back to writing in
  place instead of refusing the save.

Enterprise CAs already installed in the Windows certificate store may be
trusted by the Harness runtime without this plugin, since DSH Desktop runs Node
with `--use-system-ca`. Use `caFiles` when they are not.

## Coverage

Covered: every request that goes through this process's global `fetch` —
model requests, embeddings, web search, HTTP MCP transports — plus, for the
`caFiles` part, anything else in the process that uses the default trust store.

Not covered:

- **The built-in web fetch tool** pins the addresses it validated and builds
  its own connection, so the proxy part of this policy does not reach it. Extra
  CAs do, because they join the process-wide trust store.
- **Subprocesses** — the bash tool, stdio MCP servers, and subagents such as
  Claude Code or Codex are separate processes with their own environment.
- **The desktop shell itself** — application updates and the plugin market go
  through Electron's own network stack, which follows the operating system's
  proxy settings rather than this policy.

## Diagnostics

Every install writes one line to the Host log naming the file it came from and
the policy it applied, with any proxy credentials stripped:

```
dsh-net-policy: applied from /Users/me/.dsh/net-policy.json: proxy http://127.0.0.1:7890/; 1 extra CA file(s); llm.internal.example => insecure true
```

A document the plugin cannot use — invalid JSON, an unreadable CA file, a SOCKS
proxy URL — leaves the previous policy in place and logs the reason, so a typo
in a settings file never costs a running agent its network.

## Security note

`insecure` disables certificate verification, which makes traffic to that host
readable and modifiable by anything on the path. Prefer adding the endpoint's
CA to `caFiles`; keep `insecure` for a host you control while you are
diagnosing it.

## Development

```bash
npm install
node --test tests/policy.test.mjs tests/transport.test.mjs
```

The transport tests drive the process's real `fetch` against a self-signed
HTTPS origin and a recording CONNECT proxy, which is what catches Node or
undici moving the global dispatcher out from under the plugin.
