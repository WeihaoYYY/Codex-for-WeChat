# Codex for WeChat：远程控制能力

更新日期：2026-09-03

本机已部署 Codex for WeChat 与 ChatGPT-Codex Turn Relay。微信可以作为 Codex 的远程任务、审批、文件与自动化控制入口。ChatGPT 负责项目路线决策；Turn Relay 是独立 Chrome 扩展，只负责验证并提交下一次 ChatGPT 用户回合。

## 可以做什么

1. 直接用中文向 Codex 下达任务，包括分析和修改项目文件、运行命令与测试、排查错误、生成报告。
2. 向 Codex 发送图片、文件、视频与语音，并接收 Codex 返回的本地图片、视频和文件。
3. 管理受管 Codex 会话：查看状态、新建、恢复、切换工作目录、模型、推理强度和进度显示。
4. 通过一次性 `A...` 编号批准或拒绝命令执行、文件修改、网页上传和提交等高风险操作。
5. 使用独立浏览器 profile 执行受控网页读取、填写、截图和文件上传；新域名与提交类动作继续要求审批。
6. 接收本机脚本、计划任务和独立 Codex 后台任务的主动通知、进度与最终结果。
7. 当 ChatGPT 自动化 fail-closed 暂停时，接收 `C-...` 通知，并从微信查看状态、允许恢复或拒绝。

## 常用 Codex 命令

```text
/help
/status
/new
/resume
/resume R1
/bind <绝对路径>
/model
/effort
/stream
/prompt start
/prompt done
/approve A1
/approve-session A1
/deny A1
/stop
```

## ChatGPT Controller 中文审批

只有当前微信联系人存在 Controller 暂停时，下列完全匹配的中文短句才作为审批命令；没有暂停时仍作为普通消息交给 Codex。

```text
状况 / 状态 / 报告
允许 / 继续
拒绝
```

只有一个等待项时不需要编号。存在多个等待项时：

```text
允许 C-0123456789AB
拒绝 C-0123456789AB
```

“允许”不会由微信直接向 Codex 下发或重发任务。ChatGPT-Codex Turn Relay 会先验证微信联系人、审批编号、ChatGPT 会话路径、暂停任务指纹和页面消息哈希，然后消费一次性批准，启动一个只负责路线判断的 ChatGPT 回合。只有该回合产生合法的新 marker，后续独立回合才会向 Codex 派发任务。

## 安全和运行边界

- Codex-WeChat 只监听本机 `127.0.0.1:18787`；Controller 和主动任务使用相互独立的本机密钥。
- 密钥、微信凭据、浏览器 profile 和状态目录不得上传到项目 Source、GitHub、Notion、截图或聊天记录。
- `A...` 和 `C-...` 审批都绑定原联系人和原上下文，只能使用一次，并会过期。
- 电脑、Codex-WeChat 服务和需要自动续轮的 Chrome 会话必须保持运行。
- 浏览器工具只会出现在启用功能后新建的受管 Codex 会话中；必要时先发送 `/new`。
- 不要让微信/Web 与 Codex 桌面端同时写入同一个 Codex thread；并行工作应使用独立会话。
- 自动化暂停、Controller review、自验证和最终接受是不同阶段；微信批准不能替代项目权限、证据审查或实施授权。
- Codex 的普通进度、审查、完成和交付信息必须留在产生它们的目标任务中，不得通过 `send_message_to_thread` 主动发送到其他 Codex 对话。`Stop for Controller review` 只表示在当前目标任务中返回并停止。跨任务消息仅允许用于阻断监督或恢复的自定义插件/MCP 错误报警。

## 本机组件

```text
Codex for WeChat source: E:\Codex\codex-weixin
Private state:            E:\Codex\codex-weixin-state
Default workspace:        E:\Codex\codex-weixin-workspace
Local service:            http://127.0.0.1:18787
ChatGPT-Codex Turn Relay source: E:\GPT-Codex\.worktrees\controller-v2-20260903
```
