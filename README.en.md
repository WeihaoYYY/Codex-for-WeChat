<h1 align="center">CodeX From WeChat</h1>

<p align="center">
  <img src="src/web/favicon.svg" alt="CodeX From WeChat logo" width="128" height="128" />
</p>

<p align="center">
  <a href="./README.md">中文</a> | <strong>English</strong>
</p>

<p align="center">
  <strong>Send file, command, and controlled browser tasks from personal WeChat to local Codex.</strong>
</p>

**CodeX From WeChat** is an enhanced distribution based on [`XavierJiezou/codex-weixin`](https://github.com/XavierJiezou/codex-weixin) `v0.3.8`. It keeps the upstream WeChat, file-transfer, and session-management features while adding sender-bound approvals, immediate long-task interruption, and controlled browser tasks in an isolated profile.

```text
Personal WeChat <-> CodeX From WeChat <-> Codex App Server <-> allowed workspaces / isolated browser
```

It is not a general messaging gateway. The management page listens on `127.0.0.1` and is not exposed to the LAN or public Internet.

> [!IMPORTANT]
> This is a third-party open-source project, not an official OpenAI or WeChat integration. Authorize only your own sender and explicit workspace roots. Never publish the service state directory, WeChat tokens, Codex credentials, or browser profile.

> [!NOTE]
> The internal npm package and executable remain named `codex-weixin` for upstream compatibility; the repository and product name are **CodeX From WeChat**.

## Feature status

Screenshots live under `docs/images/screenshots/`. The Web management screenshot is included; rows that require a phone view reserve stable filenames for later WeChat captures.

| Status | Feature | Details | Screenshot |
| --- | --- | --- | --- |
| ✅ | Local Web management | A `127.0.0.1`-only page manages WeChat accounts, sessions, workspaces, and Codex settings. | [Web sessions](docs/images/screenshots/web-session-management.png) |
| ✅ | Multiple WeChat accounts | One service runs multiple accounts with local remarks and isolated authorization, attachments, and sessions; account removal can retain history. | [Web sessions](docs/images/screenshots/web-session-management.png) |
| ✅ | Browser QR connection | Shows waiting, scanned, connected, and expired QR states. | Pending: `docs/images/screenshots/wechat-qr-login.png` |
| ✅ | Session management | Grouped account tabs, Markdown history, continued Codex threads, and create, rename, activate, reset, and delete actions. | [Web sessions](docs/images/screenshots/web-session-management.png) |
| ✅ | Web text and attachments | Send text with up to 10 files (100 MiB total), with media playback, preview, and download in history. | Pending: `docs/images/screenshots/web-attachments.png` |
| ✅ | WeChat private-chat control | Supports regular messages plus `/status`, `/new`, `/resume`, `/bind`, `/model`, `/effort`, `/prompt start`, `/prompt done`, and `/stop`. | Pending: `docs/images/screenshots/wechat-chat.png` |
| ✅ | WeChat media input | Accepts transcribed voice, images, audio, video, and files up to 100 MiB each, with a direct notice when the limit is exceeded. | Pending: `docs/images/screenshots/wechat-media-input.png` |
| ✅ | File delivery to WeChat | Codex can return local images, videos, and files as native WeChat messages. | Pending: `docs/images/screenshots/wechat-media-output.png` |
| ✅ | Models and reasoning effort | Model-aware dropdowns loaded from app-server, including GPT-5.6 Sol, Terra, and Luna for IkunCoding. | Pending: `docs/images/screenshots/web-model-settings.png` |
| ✅ | Process progress | Enabled by default; Codex progress reaches WeChat immediately and appears in a collapsible Web timeline with elapsed time, while final answers stay intact. | Pending: `docs/images/screenshots/web-process-progress.png` |
| ✅ | Typing state and deduplication | Web typing state plus persistent sync cursors and message IDs prevent duplicate replies. | Pending: `docs/images/screenshots/wechat-typing.png` |
| ✅ | App-server first | New and resumed sessions prefer Codex app-server V2 and fall back to `codex exec` when unavailable. | Pending: `docs/images/screenshots/wechat-status.png` |
| ✅ | WeChat approvals | Sender-bound, one-time `/approve`, `/approve-session`, and `/deny` codes answer command and file-change approval requests. | Pending: `docs/images/screenshots/wechat-approval.png` |
| ✅ | Controlled browser | An isolated Chrome/Edge profile supports navigation, snapshots, filling, screenshots, and uploads with domain and consequential-action approval. | Pending: `docs/images/screenshots/wechat-browser.png` |
| ✅ | Web auto-update | Selects npm or npmmirror, updates the active npm runtime, verifies it, then restarts and reconnects. | Pending: `docs/images/screenshots/web-auto-update.png` |

## Web management preview

<p align="center">
  <img src="docs/images/screenshots/web-session-management.png" alt="codex-weixin Web session management" width="100%" />
</p>

## Requirements

- Node.js `>=22`
- Git
- An installed and authenticated Codex CLI

```bash
npm install -g @openai/codex
codex --version
codex
```

## Install and start

This enhanced distribution is not published to npm. Install from this repository; `npm install -g codex-weixin` installs the upstream package without WeChat approvals or browser tools.

```powershell
git clone https://github.com/WeihaoYYY/codex-from-wechat.git
Set-Location "codex-from-wechat"
npm ci
npm run typecheck
npm run build
npm start
```

The service opens [http://127.0.0.1:8787](http://127.0.0.1:8787). To use a fixed port and private state directory:

```powershell
$env:CODEX_WEIXIN_PORT="18787"
$env:CODEX_WEIXIN_STATE_DIR="C:\Codex\codex-from-wechat-state"
$env:CODEX_WEIXIN_OPEN="0"
npm start
```

To install the compatible global executable after building:

```powershell
npm install -g .
codex-weixin
```

To update a source installation later:

```powershell
Set-Location "codex-from-wechat"
git pull --ff-only
npm ci
npm run build
npm start
```

## First connection

1. Open Settings and confirm the default and allowed Codex workspaces.
2. Select Add WeChat, scan the QR code, and confirm in WeChat.
3. Send any message to the connected account.
4. Return to WeChat Accounts and allow the pending sender.
5. Send the message again to start a Codex turn.

To run controlled browser tasks from WeChat:

1. Enable **Browser tools** under **Settings → WeChat browser control**.
2. Leave the browser executable empty for automatic Chrome/Edge discovery; the default isolated profile and output directories are suitable for most users.
3. Initially leave the pre-approved domain list empty so every new domain requires a WeChat confirmation.
4. Save, then send `/new` so the new Codex thread receives the browser tools.
5. Ask Codex to open a site. Inspect the `A1` approval summary and reply with `/approve A1` or `/deny A1`.

Sign in manually in the isolated Chrome/Edge window the first time a site requires an account. Its cookies remain in the private service state and are not read from the everyday browser profile.

### Quick usage example

```text
/status
/bind C:\\path\\to\\an-allowed-project
/new
Open example.com, read the page title, and take a screenshot
/approve A1
Edit README.md in the current project, but first tell me what you plan to change
/stop
```

File changes, commands, new domains, uploads, and consequential browser actions may pause for approval. Read the operation summary before choosing `/approve A1` or `/deny A1`.

Repeat the QR flow to add more accounts. Every account has its own monitor, sender authorization, inbound directory, and managed-session state. A failed account does not stop the others. Scanning the same WeChat account again after an expired login refreshes the existing credentials while preserving its local remark, authorization, and sessions instead of creating an empty duplicate. Account removal can retain history: credentials are deleted immediately, while a later scan by the same WeChat user restores the previous remark, authorization, and managed sessions.

## Session management

The Sessions page manages conversations created and used by this server. It does not scan or take ownership of every Codex conversation created in other terminals.

Selecting a session reads its user messages and final replies from Codex's own persisted thread. The controls below the chat title select a model, reasoning effort, and process-progress behavior for the current session or keep inheriting global settings; they share the same session configuration used by the WeChat `/model`, `/effort`, and `/stream` commands. Process progress is enabled by default, appears in a collapsible Web timeline with elapsed time, and leaves the final answer as one stable response. The Web composer can submit text and multiple files as one turn and continues that same thread, so context remains shared with later WeChat messages. Uploads are isolated by account and session under `~/.codex-weixin/inbound/`, with at most 10 files and 100 MiB total per turn.

The UI uses local remarks instead of treating internal IDs as account names. Expand “Account IDs” on an account card to inspect its iLink Bot ID and User ID; Codex thread IDs remain hidden from the regular UI. Each account can have a local remark edited from the WeChat Accounts page; the remark is reused by session tabs, with `WeChat Account 1` used only as a fallback. The current QR and messaging APIs do not expose WeChat nicknames, avatars, or a profile lookup endpoint, so the page uses a default icon.

- Each authorized WeChat account has one active session and may own multiple named sessions.
- Activate chooses which Codex thread receives the sender's next message.
- Reset clears the recorded thread so the next message starts fresh context.
- Delete removes only the bridge record, not Codex's own history files.
- `/new` creates a new managed session for the current sender.
- `/resume` lists this sender's sessions with recent prompt summaries, timestamps, and distinct `R1`, `R2` selection codes; `/resume R1` switches back to the selected Codex thread without confusing the code with a title such as `Session 6`.

## WeChat commands

```text
/help                         Show commands
/status                       Show session, workspace, thread, backend, effective model, and reasoning effort
/bind <absolute-path>          Bind to an allowed workspace
/new                          Create a new managed Codex session
/resume                       List historical sessions with recent prompt summaries
/resume R<number>             Continue a session by its distinct R selection code
/model                        Show the current and available models
/model <number|model|default>  Switch this session's model or restore inheritance
/effort                       Show reasoning efforts supported by the current model
/effort <number|level|default> Switch this session's effort or restore inheritance
/stream                       Show this session's process-progress setting
/stream <on|off|default>       Enable, disable, or restore global process progress
/prompt start                 Buffer multiple WeChat messages
/prompt done                  Submit the buffer as one Codex turn
/approve A<number>            Approve one pending operation
/approve-session A<number>    Reuse an upstream-supported approval for this Codex session
/deny A<number>               Deny one pending operation
/stop                         Interrupt the current Codex task
```

Regular messages enter the active session. Images, files, videos, and voice/audio without transcription are saved under the account's inbound directory and added to the prompt by local path. WeChat voice transcription is preferred when available.

## Sending local files

Codex can request local-file delivery in its final response:

````text
```codex-weixin-actions
{
  "send": [
    { "type": "image", "path": "/absolute/path/chart.png" },
    { "type": "video", "path": "/absolute/path/demo.mp4" },
    { "type": "file", "path": "/absolute/path/report.pdf" }
  ]
}
```
````

Only absolute local paths are accepted. Native outbound types are `image`, `video`, and `file`; audio is sent as a regular file. Remote URLs are not uploaded as local files.

## Codex backend

The default `codexBackend` is `auto`. On the first Codex message, the service starts one persistent `codex app-server --stdio` process and uses the current `initialize`, `thread/*`, and `turn/*` protocol. New and resumed conversations prefer app-server; startup, handshake, or request failures automatically fall back to `codex exec` or `codex exec resume`.

WeChat turns use `approvalPolicy: "on-request"`. Commands, file changes, new browser domains, uploads, and consequential browser clicks pause and send a sender-bound one-time approval code to WeChat. Reply with `/approve A1`, `/approve-session A1`, or `/deny A1`; codes expire after 10 minutes and `/stop` cancels all approvals for that sender. Browser submissions and uploads cannot be upgraded to session-wide approval.

The optional browser tools use an isolated persistent Chrome/Edge profile. Enable them in Settings, then send `/new` because dynamic tools are attached only when a new Codex thread starts. The first visit to a domain requires approval, and the isolated profile must be signed in separately from the user's everyday browser.

## Models and reasoning effort

The Settings page loads available models and model-specific reasoning efforts from Codex app-server. Leaving a field on "Use Codex settings" preserves the Codex configuration; choosing and saving an explicit value applies it to later Web and WeChat turns.

Send `/model` or `/effort` in WeChat to get a numbered list, then switch by number or exact ID. A WeChat-side selection applies only to the active managed session, without affecting other accounts, senders, or sessions. `/model default` and `/effort default` restore inheritance from Web/Codex settings. Continuing that session from the Web page uses the same session overrides.

The IkunCoding provider also exposes `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. These options remain available after switching to another model in both the Web dropdown and WeChat `/model` list. Send `/status` in WeChat to inspect the effective model and reasoning effort.

## Local data

Service state and the default Codex workspace share this directory:

```text
~/.codex-weixin/
  accounts/                 One credential file per WeChat account
  retained-accounts.json    Recovery index for removed accounts; never stores tokens
  runtime/<account-id>/     Sender authorization and managed sessions
  inbound/<account-id>/     Inbound WeChat attachments
  browser-profile/          Isolated persistent browser sign-in state
  browser-output/           Browser screenshots and other local output
  config.json               Codex and workspace configuration
  logs/
```

Do not commit or share this directory. The management API never returns WeChat tokens to the browser.

## Startup settings

The server always binds to `127.0.0.1`. Environment variables can change its port and state directory or disable automatic browser opening:

```text
CODEX_WEIXIN_PORT=8787
CODEX_WEIXIN_STATE_DIR=/absolute/private/path
CODEX_WEIXIN_OPEN=0
```

## Security model

- Non-local Host and Origin values are rejected.
- Every mutating API call requires an in-memory page token.
- WeChat credentials never reach the management page.
- Unknown senders are denied until explicitly allowed.
- `/bind` accepts only absolute paths under the workspace allowlist.
- Browser tools allow public HTTP(S) only, block private/local network targets for pages and subresources, and require approval for new domains.
- Uploads are limited to allowed workspaces; submissions and uploads always require one-time approval.
- Browser cookies stay in the local isolated profile. Never commit or share the state directory.
- `danger-full-access` bypasses the Codex filesystem sandbox and must be enabled only when full-machine access is acceptable.
- Concurrent accounts share local compute resources and Codex quotas.

## Development

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

The project is a clean-room independent implementation under the MIT License. Its iLink integration shape references `Tencent/openclaw-weixin`, along with public Codex/WeChat projects for app-server, media-transfer, and security-boundary practices. No AGPL source code was copied.

When started from a source checkout with `npm run dev` or `npm start`, the Web page checks for updates but does not install them; update the Git checkout and rebuild instead. Global installations and isolated `node_modules/codex-weixin` runtimes update the npm prefix that owns the active package and verify the target version and service entry before restarting. On Windows, the updater first releases any process working-directory lock inside the package tree so npm can replace it without `EBUSY`.

## References and license

- Enhanced source: [WeihaoYYY/codex-from-wechat](https://github.com/WeihaoYYY/codex-from-wechat)
- Upstream project: [XavierJiezou/codex-weixin](https://github.com/XavierJiezou/codex-weixin)
- Codex CLI: [OpenAI Codex CLI](https://learn.chatgpt.com/zh-Hans/docs/codex/cli)
- Authentication: [OpenAI Authentication](https://learn.chatgpt.com/zh-Hans/docs/auth)
- App Server: [OpenAI Codex App Server](https://learn.chatgpt.com/zh-Hans/docs/app-server)

See [CHANGELOG.md](./CHANGELOG.md) for release history. The upstream MIT license and copyright notice are retained in [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
