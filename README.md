<h1 align="center">Codex for WeChat</h1>

<p align="center">
  <img src="src/web/favicon.svg" alt="Codex for WeChat logo" width="128" height="128" />
</p>

<p align="center">
  <strong>中文</strong> | <a href="./README.en.md">English</a>
</p>

<p align="center">
  <strong>从个人微信向本机 Codex 下达文件、命令和受控网页任务。</strong>
</p>

**Codex for WeChat** 是基于 [`XavierJiezou/codex-weixin`](https://github.com/XavierJiezou/codex-weixin) `v0.3.8` 的增强分支。它在原有微信聊天、文件传输和会话管理基础上，加入微信内审批、长任务即时停止、主动任务通知，以及使用独立浏览器 profile 的受控网页操作。

```text
个人微信 <-> Codex for WeChat <-> Codex App Server <-> 允许的工作目录 / 独立浏览器
```

项目只在本机监听 `127.0.0.1`，不是通用消息网关，也不会把管理页面开放到局域网或公网。

> [!IMPORTANT]
> 这是第三方开源项目，不是 OpenAI 或微信官方集成。请只授权自己的微信联系人和明确的工作目录；不要提交或分享状态目录、微信 token、Codex 登录凭据或浏览器 profile。

> [!NOTE]
> 内部 npm 包名和可执行命令暂时仍是 `codex-weixin`，以保持与上游兼容；仓库和产品名称为 **Codex for WeChat**。

## 核心功能

### 1. 微信多媒体输入与文件回传

微信端可以发送文本、图片、音频、视频和文档给 Codex，单个附件最大 100 MiB。Codex 也可以把本机图片、视频和文件作为微信原生消息发回。

<p align="center">
  <img src="docs/images/screenshots/wechat-media-input-output.png" alt="通过微信向 Codex 发送文件并接收回传" width="420" />
</p>

### 2. 微信原生语音指令

支持微信语音转写，可以直接用语音向 Codex 下达任务；没有转写文本的语音会作为本机附件交给 Codex 处理。

<p align="center">
  <img src="docs/images/screenshots/wechat-voice-command.png" alt="通过微信语音向 Codex 下达指令" width="420" />
</p>

### 3. Codex CLI 原生命令

微信端支持 `/status`、`/new`、`/resume`、`/bind`、`/model`、`/effort`、`/stream`、`/prompt start`、`/prompt done`、`/approve`、`/deny`、`/controller` 和 `/stop`，可以管理会话、工作目录、模型、推理强度、过程进度与高风险操作确认。

<p align="center">
  <img src="docs/images/screenshots/wechat-cli-commands.png" alt="在微信中使用 Codex CLI 原生命令" width="420" />
</p>

### 4. 过程进度反馈

过程进度默认开启。Codex 处理长任务时会持续向微信发送中间进度，Web 端则折叠显示处理过程和用时，最终答案保持完整。

<p align="center">
  <img src="docs/images/screenshots/wechat-process-progress.png" alt="Codex 长任务的微信过程进度反馈" width="420" />
</p>

### 5. 多微信账号接入与管理

一个服务可以并行运行多个微信账号。每个账号拥有独立的联系人授权、附件、会话和运行状态；移除账号时还可以选择保留历史，重新扫码后继续使用。

<p align="center">
  <img src="docs/images/screenshots/web-multi-account.png" alt="codex-weixin 多微信账号管理" width="100%" />
</p>

### 6. Web 会话管理

Web 端可以按微信账号查看 Markdown 历史、继续同一个 Codex thread，并支持新建、重命名、切换、重置和删除会话。页面也支持直接发送文本和附件，每次最多 10 个文件、合计 100 MiB。

<p align="center">
  <img src="docs/images/screenshots/web-session-management.png" alt="codex-weixin Web 会话管理" width="100%" />
</p>

### 7. Web 全局设置与自动更新

Web 端可以配置工作目录、Codex 后端、模型、推理强度和过程进度，也可以检查并安装新版本。全局 npm 安装会更新当前实际运行的 runtime，完成校验后自动重启并恢复连接。

<p align="center">
  <img src="docs/images/screenshots/web-global-settings.png" alt="codex-weixin Web 全局设置" width="100%" />
</p>

### 8. 微信浏览器任务与审批

启用“微信浏览器控制”后，Codex 可以在一个独立的 Chrome / Edge 配置中打开公共网站、读取页面、填写表单、截图以及选择允许工作目录内的上传文件。首次访问新域名、上传文件、提交/发送/保存/购买/删除等可能改变外部状态的点击都会暂停，并把一次性确认编号发到微信。

浏览器工具只会挂载到启用功能后新建的 Codex thread。保存设置或升级后，请先在微信发送 `/new`，再发送浏览器任务。独立浏览器不会读取日常 Chrome 配置；第一次使用需要在弹出的浏览器中自行登录目标网站。

### 9. ChatGPT / Codex 主动任务与微信通知

设置唯一接收人后，本机的 ChatGPT 计划任务、脚本或 Codex `notify` 可以主动向微信发消息，也可以创建一个独立 Codex 会话执行任务并把进度和结果发回微信。主动任务不会切换微信当前会话，避免和桌面端同一个 thread 发生写入冲突。

## 环境要求

- Node.js `>=22`
- Git
- 已安装并登录 Codex CLI

```bash
npm install -g @openai/codex
codex --version
codex
```

## 安装

这个增强分支尚未发布到 npm。请从本仓库源码安装；运行 `npm install -g codex-weixin` 得到的是上游官方版，不包含微信审批和浏览器工具。

```powershell
git clone https://github.com/WeihaoYYY/Codex-for-WeChat.git
Set-Location "Codex-for-WeChat"
npm ci
npm run typecheck
npm run build
npm link
npm start
```

服务默认打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。如果需要固定端口和私有状态目录：

```powershell
$env:CODEX_WEIXIN_PORT="18787"
$env:CODEX_WEIXIN_STATE_DIR="C:\Codex\codex-for-wechat-state"
$env:CODEX_WEIXIN_OPEN="0"
npm start
```

此时打开 [http://127.0.0.1:18787](http://127.0.0.1:18787)。如果希望安装全局命令，可在构建后运行：

```powershell
npm install -g .
codex-weixin
```

完整 Windows 安装、登录、扫码、审批和排错步骤见下方各节。

以后更新源码版：

```powershell
Set-Location "Codex-for-WeChat"
git pull --ff-only
npm ci
npm run build
npm start
```

## 第一次接入微信

1. 打开管理页，在“设置”中确认 Codex 默认工作目录和允许的工作目录。
2. 点击“添加微信”，使用微信扫描页面二维码并确认登录。
3. 在微信中给新接入的账号发送任意消息。
4. 回到“微信账号”，允许页面中出现的待授权联系人。
5. 再次从微信发送消息，Codex 会在默认工作目录中开始处理。

如果需要让 Codex 从微信执行受控网页任务：

1. 在“设置 → 微信浏览器控制”中开启“启用浏览器工具”。
2. 浏览器程序路径可以留空；独立登录配置目录和截图输出目录使用页面默认值即可。
3. 建议第一次把“无需逐次确认的域名”留空，让每个新域名都由微信确认。
4. 保存后在微信发送 `/new` 创建一个带浏览器工具的新 thread。
5. 让 Codex 打开网页；首次访问新域名会收到 `A1` 这类确认编号。核对操作后发送 `/approve A1` 或 `/deny A1`。

独立浏览器第一次打开某个需要账号的网站时，请在电脑上出现的 Chrome / Edge 窗口中手动登录。之后 Cookie 只保存在该项目的私有状态目录，不会读取日常浏览器 profile。

### 快速使用示例

```text
/status
/bind E:\\允许的项目目录
/new
请打开 example.com，读取页面标题并截图
/approve A1
请修改当前项目里的 README.md，先告诉我你准备改什么
/stop
```

文件修改、命令执行、新域名、上传和提交类网页操作可能暂停等待审批。请先阅读微信里的操作摘要，再决定 `/approve A1` 或 `/deny A1`；不要盲目批准。

继续添加账号时重复扫码即可。每个账号都有独立的轮询任务、联系人授权、入站文件和会话状态；单个账号发生错误不会停止其他账号。同一个微信账号因登录过期等原因重新扫码时，会刷新原账号凭据并保留本机备注、授权和会话，不会创建新的空账号。移除账号时可以保留会话历史；登录凭据会立即删除，同一微信用户以后重新扫码时会恢复原备注、授权和受管会话。

## 会话管理

“会话”页面只管理由本服务创建和使用的 Codex 会话，不扫描或接管其他终端产生的全部 Codex 历史记录。

选择一个会话后，右侧会从 Codex 自身保存的 thread 中读取历史用户消息和最终回复。聊天标题下方可以为当前会话选择模型、推理强度和过程进度，或继续继承全局设置；这与微信 `/model`、`/effort`、`/stream` 共用同一份会话配置。过程进度默认开启，在 Web 中折叠展示并记录处理用时，最终答案仍作为一个完整回复显示。可以直接在页面底部继续聊天，并通过回形针按钮将文本提示词和多个文件作为同一个 turn 发送；Web 和微信共用同一个 thread，上下文会保持连续。上传文件按微信账号和会话隔离保存在 `~/.codex-weixin/inbound/`，每次最多 10 个、合计不超过 100 MiB。

页面默认使用账号备注，不把内部 ID 当作账号名称。展开账号卡片中的“账号 ID”可以查看 iLink Bot ID 和 User ID；Codex thread id 仍不在普通页面显示。可以在“微信账号”页面给账号设置只保存在本机的备注；备注会同步用于会话标签。未设置备注时才使用“微信账号 1”这类默认名称。当前扫码和消息接口没有提供微信昵称、头像或个人资料查询能力，因此页面使用默认图标。

- 每个已授权微信账号有一个当前活动会话，也可以拥有多个命名会话。
- “切换”决定该联系人下一条微信消息继续哪个 Codex thread。
- “重置”清空本服务记录的 thread，下一条消息创建新上下文。
- “删除”只删除本服务中的会话记录，不删除 Codex 自身保存的历史文件。
- 微信中的 `/new` 会立即为当前联系人创建新的受管会话。
- 微信中的 `/resume` 会按最近更新时间列出当前联系人的历史会话、最近内容摘要和时间，并为每项生成 `R1`、`R2` 这类独立切换编号；发送 `/resume R1` 可切换并继续原来的 Codex thread，不会与“会话 6”这类名称混淆。

## 微信内命令

```text
/help                         查看命令
/status                       查看当前会话、工作目录、thread、backend、实际模型和推理强度
/bind <absolute-path>          绑定到允许列表内的工作目录
/new                          创建新的受管 Codex 会话
/resume                       查看历史会话、最近内容摘要和序号
/resume R<编号>               按 R 切换编号继续指定的历史会话
/model                        查看当前模型和可用模型
/model <序号|模型 ID|default>  切换当前会话模型，或恢复继承设置
/effort                       查看当前模型支持的推理强度
/effort <序号|强度|default>    切换当前会话推理强度，或恢复继承设置
/stream                       查看当前会话的过程进度设置
/stream <on|off|default>       开启、关闭过程进度，或恢复继承全局设置
/prompt start                 开始缓冲多条微信消息
/prompt done                  将缓冲内容作为一次 Codex turn 提交
/approve A<编号>              批准一次等待中的操作
/approve-session A<编号>      在当前 Codex 会话中沿用上游支持的授权
/deny A<编号>                 拒绝等待中的操作
/controller status            查看绑定到本微信联系人的 ChatGPT Controller 暂停
/controller continue C-<编号> 一次性允许 Chrome 核验并恢复 ChatGPT 路线判断
/controller reject C-<编号>   拒绝恢复并让 ChatGPT 自动化保持停止
/stop                         中断当前 Codex 任务
```

普通消息直接进入当前活动会话。图片、文件、视频和无转写语音会先保存到账号独立的入站目录，再以本地路径加入 prompt；有微信转写文本的语音优先使用转写文本。

## 文件回传

Codex 可以在最终回复中声明需要发送的本机文件：

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

只接受本机绝对路径。原生出站类型为 `image`、`video` 和 `file`；音频按普通文件发送。远程 URL 不会被当作本机文件上传。

## Codex 后端

默认的 `codexBackend` 是 `auto`。第一次收到 Codex 消息时，服务会启动一个持久的 `codex app-server --stdio` 进程，并使用新版 `initialize`、`thread/*` 和 `turn/*` 协议。新会话和已有会话都优先通过 app-server 运行；如果 app-server 无法启动、握手或处理请求，会自动回退到 `codex exec` 或 `codex exec resume`。

微信 turn 使用 `approvalPolicy: "on-request"`。Codex 请求执行本机命令、修改文件或使用需要确认的浏览器操作时，服务会向同一微信联系人发送 `A1` 这类一次性编号；只有该联系人可以用 `/approve A1`、`/approve-session A1` 或 `/deny A1` 回答。编号默认 10 分钟过期且只能使用一次；`/stop` 也会取消该联系人的所有待确认操作。浏览器提交和文件上传只接受单次 `/approve`，不能升级为会话级授权。

启用浏览器控制时，后端固定使用 app-server，避免回退到不支持动态浏览器工具的 `codex exec`。已有 thread 不会被事后注入工具；请发送 `/new` 创建新会话。

## 主动任务与 ChatGPT / Codex 自动化

先在管理页打开“设置 → 主动任务与通知”，开启本机主动调用，并选择**唯一一个**已授权微信联系人。服务会在私有状态目录生成 `automation-token`；密钥不会显示在网页、日志或 API 返回值中。

主动发一条通知：

```powershell
codex-weixin push --text "数据更新完成" --idempotency-key "daily-data-2026-09-02"
```

创建独立 Codex 任务，并在微信接收过程和结果：

```powershell
codex-weixin task `
  --prompt "检查 E:\Project 的测试结果并给出摘要" `
  --cwd "E:\Project" `
  --title "每日测试" `
  --idempotency-key "daily-tests-2026-09-02"
```

加上 `--wait` 时，调用方会等待任务完成；不加时会立即返回任务编号，服务在后台继续执行。工作目录必须位于“允许的工作目录”内。相同类型和相同 `idempotency-key` 只执行一次；服务同时限制为每分钟 30 次调用和最多 20 个活动任务。

如果没有通过 `npm link` 安装命令，也可以直接调用构建入口：

```powershell
node "E:\Codex\Codex-for-WeChat\dist\server\index.js" push --text "测试通知"
```

端口和状态目录必须和正在运行的服务一致：

```powershell
$env:CODEX_WEIXIN_PORT="8787"
$env:CODEX_WEIXIN_STATE_DIR="C:\Codex\codex-for-wechat-state"
```

要把普通 Codex turn 完成结果主动转发到微信，可在 `~/.codex/config.toml` 配置官方 `notify` 钩子：

```toml
notify = ["node", "E:\\Codex\\Codex-for-WeChat\\dist\\server\\index.js", "notify"]
```

Codex 会把 `agent-turn-complete` JSON 作为最后一个参数传入；本项目只转发最终回复，并用 thread/turn ID 去重。这个配置是可选的，不会由安装程序自动修改。

ChatGPT 桌面端计划任务也可以运行上面的 `task` 命令。执行本地项目时，电脑必须开机、Codex/ChatGPT 桌面应用与 Codex for WeChat 服务必须运行；网页版计划任务不能直接访问电脑本地目录。参见 [OpenAI 计划任务文档](https://learn.chatgpt.com/zh-Hans/docs/automations) 和 [Codex `notify` 配置](https://learn.chatgpt.com/zh-Hans/docs/config-file/config-advanced)。

当微信上下文凭证过期时，文本结果不会丢失，而是保存在本机待发送队列。你下一次从该微信联系人发来消息后，服务会先刷新凭证并补送积压内容。主动任务的高风险命令和浏览器提交仍会在微信生成 `A1` 形式的一次性审批。

### ChatGPT Controller 暂停审批

`ChatGPT-Codex Turn Relay` 可以把 fail-closed 暂停登记到本服务，并主动通知“主动任务与通知”中选定的唯一微信联系人。ChatGPT 负责路线决策，Turn Relay 只负责验证并提交下一回合。服务会另外生成 `controller-token`，与 `automation-token` 分离；Chrome 扩展只通过 `127.0.0.1` 使用该密钥。

收到 `C-...` 编号后，可以发送：

```text
状况（也可以说“状态”或“报告”）
允许（也可以说“继续”）
拒绝
```

只有一个等待项时无需输入编号。存在多个等待项时，使用 `允许 C-0123456789AB`、`拒绝 C-0123456789AB`，或继续使用完整的 `/controller` 命令。只有当前联系人确实存在 Controller 暂停时，这些完全匹配的中文短句才会被解释为审批；其他时候仍作为普通消息交给 Codex。

编号绑定微信联系人、ChatGPT 会话路径和任务指纹，默认 24 小时过期且只能消费一次。`continue` 不会直接向 Codex 下发或重发任务：Chrome 会先重新核验原会话和原消息哈希，再开启一个仅用于路线判断的 ChatGPT 回合；只有该回合产生合法的新 marker，下一回合才会向 Codex 派发。浏览器扩展配置时使用：

```text
Service URL: http://127.0.0.1:18787
Token file:  E:\Codex\codex-weixin-state\controller-token
```

不要把 `controller-token` 上传到 GitHub、Notion、聊天记录或截图中。

## 模型和推理强度

“设置”页面会从 Codex app-server 读取可用模型和各模型支持的推理强度。选择“沿用 Codex 设置”时使用 Codex 自身配置；选择具体模型或推理强度并保存后，后续 Web 和微信消息都会使用该配置。

微信中发送 `/model` 或 `/effort` 可以查看带序号的选项，再用序号或英文 ID 切换。微信端设置只覆盖当前受管会话，不影响其他微信账号、联系人或会话；发送 `/model default`、`/effort default` 可恢复继承 Web/Codex 设置。Web 继续该会话时也会沿用这份会话设置。

IkunCoding 提供方会额外显示 `gpt-5.6-sol`、`gpt-5.6-terra` 和 `gpt-5.6-luna`。切换到其他模型后，这三项仍会保留在下拉列表和微信 `/model` 列表中。微信发送 `/status` 可以查看当前生效的模型和推理强度。

## 本地数据

服务状态和默认 Codex 工作目录统一放在：

```text
~/.codex-weixin/
  accounts/                 微信账号凭据，每个账号一个文件
  retained-accounts.json    已移除账号的恢复索引，不包含 token
  runtime/<account-id>/     联系人授权和受管会话状态
  inbound/<account-id>/     微信入站附件
  browser-profile/          与日常浏览器隔离的持久登录配置
  browser-output/           浏览器截图等本机输出
  config.json               Codex 和工作区配置
  automation-token          本机主动调用密钥（不要分享）
  automation-jobs.json      主动任务状态、去重键和简短提示预览
  controller-token          ChatGPT-Codex Turn Relay 专用本机密钥（不要分享）
  controller-approvals.json ChatGPT 暂停、一次性决定和消费状态
  logs/
```

不要提交或分享该目录。管理 API 不会把微信 token 返回给浏览器。

## 启动设置

服务始终只绑定 `127.0.0.1`。可以通过环境变量改变端口、状态目录或关闭自动打开浏览器：

```text
CODEX_WEIXIN_PORT=8787
CODEX_WEIXIN_STATE_DIR=/absolute/private/path
CODEX_WEIXIN_OPEN=0
```

Windows PowerShell 示例：

```powershell
$env:CODEX_WEIXIN_OPEN="0"
codex-weixin
```

## 安全边界

- Web 服务只监听本机，拒绝非本机 Host 和 Origin。
- 所有修改 API 都需要页面运行时临时令牌。
- 主动任务 API 使用单独的持久本机密钥，只接受 `127.0.0.1` 请求，并且只允许配置中的唯一接收人。
- 微信凭据永远不返回管理页面。
- 未知联系人默认拒绝，必须在管理页明确允许。
- `/bind` 只能选择允许列表内的绝对工作目录。
- 浏览器仅允许公共 `http(s)` 地址；阻止 localhost、局域网和私有 IP，页面子资源也执行同一检查。
- 新域名必须确认；上传文件只能来自允许工作目录；提交类点击和上传始终需要单次确认。
- 浏览器使用独立 profile，登录 Cookie 保存在本机状态目录。不要分享或提交该目录。
- `danger-full-access` 会绕过 Codex 文件系统 sandbox；只有接受整机访问风险时才启用。
- 多账号可以并行触发 Codex，会共同占用本机 CPU、内存和 Codex 配额。

## 开发

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

开发入口同样只启动本机 Web 服务。浏览器页面、JSON API、多账号运行时、扫码状态机和受管会话都有自动化测试。

源码目录通过 `npm run dev` 或 `npm start` 启动时，Web 只检查新版本，不会自动安装；请通过 Git 更新源码后重新构建。全局安装和独立 `node_modules/codex-weixin` runtime 会更新当前实际运行的 npm prefix，并在重启前验证目标版本和服务入口。Windows 更新前会自动释放服务进程对包目录的工作目录占用，避免 npm 因 `EBUSY` 无法替换文件。

## 参考与许可

项目是独立实现，微信 iLink 接入形态参考 `Tencent/openclaw-weixin`，并参考了公开的 Codex/微信桥接项目在 Codex app-server、媒体传输和安全边界方面的实践。项目未复制 AGPL 项目源码，使用 MIT License。

- 本增强版源码：[WeihaoYYY/Codex-for-WeChat](https://github.com/WeihaoYYY/Codex-for-WeChat)
- 上游项目：[XavierJiezou/codex-weixin](https://github.com/XavierJiezou/codex-weixin)
- Codex CLI 文档：[OpenAI Codex CLI](https://learn.chatgpt.com/zh-Hans/docs/codex/cli)
- Codex 登录说明：[OpenAI Authentication](https://learn.chatgpt.com/zh-Hans/docs/auth)
- Codex App Server：[OpenAI Codex App Server](https://learn.chatgpt.com/zh-Hans/docs/app-server)

版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 社区

感谢 [LINUX DO](https://linux.do/t/topic/2599273) 社区佬友的支持与反馈。
