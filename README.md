# SIBS Code

SIBS Code is a desktop app for the [Pi](https://pi.dev) coding agent. It is a
stripped-down, desktop-only fork of [t3code](https://github.com/pingdotgg/t3code)
that ships a single provider — Pi — driven over Pi's native RPC mode.

## Requirements

SIBS Code drives the `pi` CLI, so you need it installed and authenticated:

```bash
npm install -g @earendil-works/pi-coding-agent
pi                       # then run /login, pick a provider, and authenticate
```

Verify Pi can reach a model before launching the app:

```bash
printf 'hi\n/exit\n' | pi
```

## Run from source

This fork is not published to a package registry; build and run it locally.
[go-task](https://taskfile.dev) wraps the common workflows (run `task --list`),
over the underlying pnpm scripts.

```bash
corepack pnpm install          # or: task install
task dev                       # build + launch the desktop app (hot reload)
```

Other useful tasks:

```bash
task start:desktop             # launch the built app (runs ensure:electron first)
task build:desktop             # compile only (apps/server/dist + apps/desktop/dist-electron)
task dist:linux                # package an installer -> release/ (also dist:mac, dist:win)
task check                     # typecheck + lint + test
```

In the app, enable **Pi** under Settings → Providers, then start a thread.

## Notes

This is a very early work in progress. Expect bugs.

Internal identifiers from upstream are unchanged (the `t3code://` app scheme,
`com.t3tools.t3code` app id, and `~/.config/t3code` / `~/.t3` data directories),
so no data migration is needed when moving between builds.

## Documentation

There's no docs site; browse the markdown under [docs](./docs):

- [Getting started](./docs/getting-started/quick-start.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Operations](./docs/operations/ci.md)
- [Reference](./docs/reference/encyclopedia.md)

## Development

SIBS Code uses [Vite+](https://viteplus.dev), so the `vp` CLI is required for
the underlying build/test tooling (the `task` targets and pnpm scripts call it):

```bash
# macOS / Linux
curl -fsSL https://vite.plus | bash
# Windows
irm https://vite.plus/ps1 | iex
```
