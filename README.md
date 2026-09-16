# dsh-net-policy

[![tests](https://github.com/caork/dsh-net-policy/actions/workflows/ci.yml/badge.svg)](https://github.com/caork/dsh-net-policy/actions/workflows/ci.yml)

A DSH (DeepSeek Harness) plugin that gives one Harness process an outbound
transport policy: extra trusted CA certificates, per-host certificate
verification, and per-host HTTP proxies — none of which the shipped model
configuration can express.

Everything the Harness sends through the global `fetch` — the LLM adapters
(`dsh-llm-pi-ai`, `dsh-llm-deepseek`), web search, HTTP MCP servers — reaches
undici's global dispatcher, so one policy installed here covers all of them
without touching a single provider entry.

## Installation

Download the tarball from [Releases](https://github.com/caork/dsh-net-policy/releases),
then install it with **`dsh plugin add`** — not with `pnpm add` or `npm install`:

```bash
dsh plugin --profile desktop add /path/to/dsh-net-policy-<version>.tgz
```

Restart the app once afterwards. Settings then has a **Network** section, and
the Host log carries one `dsh-net-policy: applied ...` line.

The package has **no runtime dependencies** — undici is bundled into it — so
the install needs nothing from the npm registry. That is deliberate: this
plugin exists to fix a machine's outbound network, and it must be installable
before that network works.

### Installing with pnpm directly does not work

`dsh plugin add` forwards the install to pnpm **and** adds the package to
`dsh.profile.bundles` in the profile's `package.json`. That list is what makes
the profile load the plugin, and the shell only looks for a client bundle among
plugins it has loaded. Install with bare pnpm and the package sits in
`node_modules` doing nothing: no policy, and no Network section.

If that already happened, add the name to the list by hand and restart — the
dependency pnpm installed is fine:

```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-net-policy"
] } }
```

### Which `dsh` to run

The profile's `node_modules` is linked from the store of whichever pnpm built
it, so use the `dsh` that belongs to the app rather than one from your shell —
a mismatched pnpm major fails with `ERR_PNPM_UNEXPECTED_STORE`.

**DSH Desktop on Windows** puts its own `dsh` on the PATH of the processes it
starts, so the app's built-in terminal is the simplest place to run the command
(`--profile` defaults to the profile the app booted). The shim itself is at:

```
%APPDATA%\DSH Desktop\host-commands\<profile>\bin\dsh.cmd
```

**DSH Desktop on macOS and Linux** keeps its CLI under the application's state
directory:

```bash
"$HOME/Library/Application Support/DSH Desktop/cli/"*/bin/dsh plugin --profile desktop add /path/to/dsh-net-policy-<version>.tgz
```

**The standalone `dsh` CLI** needs no special path — just name the profile you
boot, and run it against the same `DSH_HOME` the app uses.

### When `dsh plugin add` hangs

`dsh plugin` forwards to pnpm with the terminal attached, so a pnpm prompt
stops everything and can look like a hang — most often the one that asks to
purge and reinstall `node_modules`, which pnpm raises when the directory was
built by a different pnpm than the one now running. Answer it in advance:

```
dsh plugin --profile desktop add C:\path\to\dsh-net-policy-<version>.tgz --config.confirmModulesPurge=false
```

Setting `CI=1` for the command has the same effect on every pnpm prompt.

A hang with no prompt at all is the registry: pnpm is waiting on a network this
plugin has not fixed yet. Since v0.3.0 the package carries no dependencies, so
nothing needs downloading; if pnpm still reaches out, add `--offline` and it
will say so instead of waiting.

A warning about `NODE_TLS_REJECT_UNAUTHORIZED` being `0` means that variable is
set in your environment. It disables certificate verification for **every** TLS
connection this process makes, which is both dangerous and unnecessary once
this plugin is installed — unset it and use `caFiles`, or an `insecure` rule
scoped to the one host you cannot fix.

### When the Network section does not appear

1. Check `dsh.profile.bundles` in `$DSH_HOME/profiles/<profile>/package.json`
   (`%USERPROFILE%\.dsh\profiles\<profile>\package.json` on Windows) for
   `dsh-net-policy`. Missing means the plugin was never loaded.
2. Search the Host log for `dsh-net-policy`. DSH Desktop writes it under its
   own application-data directory — `%APPDATA%\DSH Desktop\logs\` on Windows,
   `~/Library/Application Support/DSH Desktop/logs/` on macOS. An `applied ...`
   line means the Host half is running and only the browser half is missing.
3. Confirm you installed into the profile the app actually boots, and that the
   app has been restarted since.

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
| `debug` | Log one line per origin the moment it is first connected to, naming the route it was given. |
| `timeouts` | `{ connect, headers, body }` in milliseconds. Each one left out keeps undici's default (300 s for headers and body). |
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

## How it works

One mount does four things, in this order:

1. **Read and validate.** The settings file if it exists, the plugin's own
   config otherwise, through `normalizeConfig` — which rejects a SOCKS URL, a
   malformed host list, or a non-boolean switch by name, before any of it
   becomes the policy.
2. **Build one dispatcher.** An undici `Agent` whose `factory(origin, options)`
   decides per origin: the origin matches a proxy route, so it gets a
   `ProxyAgent`; otherwise it gets a `Pool` carrying the connect options the
   policy asks for (`ca` for the extra trust, `rejectUnauthorized: false` for an
   insecure host). Nothing is decided per request, so two requests to the same
   origin cannot disagree.
3. **Install it.** `setGlobalDispatcher(agent)`, then a check that
   `globalThis[Symbol.for('undici.globalDispatcher.1')]` really is that agent —
   that slot is what Node's built-in `fetch` reads. If a userland undici ever
   stops publishing it, the plugin wraps `globalThis.fetch` to pass the
   dispatcher explicitly and says so in the log, rather than going quiet.
4. **Extend the trust store.** `tls.setDefaultCACertificates([...the process
   default, ...your PEMs])`, which reaches callers that build their own
   connection as well as the dispatcher above.

Then `watchFile` polls the settings file every two seconds; a change rebuilds
the transport, swaps it in, and closes the old one. Unmounting restores the
dispatcher, the trust store, and `fetch` exactly as they were found.

This covers model traffic because DSH's LLM adapters call the global `fetch`
with no dispatcher of their own (`dsh-llm-deepseek`, `dsh-llm-pi-ai`), and
because the whole Harness — sessions, tools, HTTP MCP — runs in one Host
process, so one install reaches all of it.

### Finding out what one request actually did

`"debug": true` — the **Log the route each host is given** switch on the
settings page — writes one line per origin the first time it is connected to:

```
dsh-net-policy: route https://api.deepseek.com => proxy http://127.0.0.1:7890/
dsh-net-policy: route https://api.deepseek.com => direct, verification off
```

That answers the question a timing-out request raises, which no amount of
staring at the configuration can: whether the policy saw that origin at all,
and what it decided. No line for the host that is failing means the request
never reached this dispatcher. A `direct` line where you expected a proxy means
a `noProxy` entry or a rule matched.

The routing decision is made once per origin and cached, so the lines appear on
first contact, not on every request.

### Making a stuck request fail instead of hang

A request that hangs tells you less than one that fails. `timeouts` bounds the
wait:

```json
{ "proxy": "http://127.0.0.1:7890", "debug": true, "timeouts": { "connect": 5000, "headers": 20000 } }
```

`connect` bounds reaching the proxy or the origin, `headers` bounds the wait
for the first response byte, `body` bounds the gap between body chunks. A
streaming model reply arrives as many chunks, so keep `body` generous or unset;
`headers` is the one that catches a proxy that accepts the connection and then
does nothing with it.

### Proving it is in effect

Set the proxy to an address nothing listens on, `http://127.0.0.1:1`, save, and
send one message:

- The request fails to connect → the policy is in effect and does reach model
  traffic, so an earlier "no effect" was about the proxy address itself.
- The model answers normally → that traffic never saw the policy. Check the log
  line, then the list below.

Do not test with `curl` from the agent's terminal. That is a subprocess and is
not covered — see below.

## Coverage

Covered: every request that goes through this process's global `fetch` —
model requests, embeddings, web search, HTTP MCP transports — plus, for the
`caFiles` part, anything else in the process that uses the default trust store.

Not covered:

- **Subprocesses** — the bash and PowerShell tools, stdio MCP servers, and
  subagents such as Claude Code or Codex are separate processes that read their
  own environment. `curl` run from the agent's terminal is one of these: it will
  not follow this policy, and it is not a test of whether the policy works.
- **The desktop shell itself** — application updates and the plugin market go
  through Electron's own network stack, which follows the operating system's
  proxy settings rather than this policy.
- **Anything that builds its own dispatcher.** A caller that passes its own
  `dispatcher` to `fetch`, or uses an HTTP client that does, decides its own
  route. DSH's own LLM adapters and its web provider do not: they call the
  global `fetch`, which is why one install covers them. A third-party plugin
  might.

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
