# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本仓库的协作规范、禁止事项、完成标准与 Review 标准写在 `AGENTS.md`，本文件不重复，只补充「命令」与「必须读多个文件才能看懂的架构」。

## 常用命令

```bash
pnpm install          # postinstall 会自动构建 + 类型检查 packages/*，再 nuxt prepare
pnpm dev              # predev 自动跑 build:dependencies
pnpm build            # prebuild 同上
pnpm lint             # = typecheck && lint:ox && format:check
pnpm lint:fix         # oxlint --fix + oxfmt --write（范围与 lint 一致）
pnpm typecheck:dependencies   # 单独检查 packages/*；根 lint 不覆盖子包源码
pnpm test:e2e
```

`pnpm lint` 三步的实际覆盖范围：

- `pnpm typecheck` = `nuxt typecheck`（app/server/shared）+ `vue-tsc -p tests/e2e/tsconfig.json`。**不含 `packages/*`**。
- `lint:ox` / `format:check` 覆盖 `app scripts server shared tests` + 三个根配置文件，排除 `third_party/**` 和 `server/nitro/**`。
- 规则在 `.oxlintrc.json`，开了 `denyWarnings` 与类型感知规则（`no-floating-promises`、`strict-boolean-expressions`、`switch-exhaustiveness-check` 等），所以「能跑」不等于「能过 lint」。

### 跑单个 E2E

`tests/e2e/run-in-containers.sh` 把自身参数原样透传给 `playwright test`（先消费可选的 `--turn` 和一个分隔 `--`）：

```bash
pnpm test:e2e -- tests/e2e/thread-ux.spec.ts            # 单文件（路径相对仓库根）
pnpm test:e2e -- --grep "pinned thread"                 # 按标题
pnpm test:e2e -- tests/e2e/admin-users.spec.ts --grep "budget"
pnpm test:e2e -- --project=chromium                     # 见下方 projects
pnpm test:e2e --turn -- tests/e2e/00-codex-upgrade.spec.ts   # 需要真实模型 turn 的用例
pnpm test:e2e -- tests/e2e/thread-ux.spec.ts --trace on # config 默认 trace: off
```

即使只跑一个文件，脚本仍会完整构建镜像 + 生产构建 + 起容器，没有跳过开关。不要绕过脚本在宿主机直接跑 Playwright（宿主机没有 SSH/Codex 环境和生产产物）。

`playwright.config.ts` 要点：`workers: 1`、`fullyParallel: false`（多个 spec 共用同一个 gateway 容器与数据库状态，用例之间有隐含顺序依赖）；`timeout: 240s`；`trace: "off"`（持续 DOM 快照会把 Chromium 推过 2GiB cgroup 上限），`screenshot: "only-on-failure"`。四个 project：`chromium`（默认，忽略 `*.mobile.spec.ts` 与 `zz-*`）、`mobile-chrome`、`mobile-webkit-core-scroll`、`post-restart`（只有 `zz-gateway-restart.spec.ts`，会重启 gateway 容器，必须最后跑）。

失败排查顺序：`test-results/<slug>-<project>/`（截图 + `error-context.md`）→ 容器日志：

```bash
docker compose -p codex-gateway-e2e -f tests/e2e/docker-compose.yml logs \
  gateway-under-test ssh-target ssh-target-legacy-node ssh-target-legacy-codex ssh-target-mfa
```

四个 SSH target 分别覆盖：干净环境、旧 Node、旧 Codex CLI、MFA。另有 `gateway-fresh`（空库，给 `setup.spec.ts`）、`bark-target`（模拟推送）。

### 其它

```bash
CODEX_GATEWAY_CONFIG_SECRET=... CODEX_GATEWAY_DB_PATH=./data/codex-gateway.db \
  pnpm user:create -- --admin <username> <password>   # 幂等 upsert，也可用来改密码/角色
```

`deploy/scripts/` 下的 `bootstrap.sh`（一键部署 + 建首个 admin）、`codex-login.sh`（写共享 Codex 登录态）、`backup.sh` / `restore.sh` 面向 Docker 部署形态，与 `pnpm dev` 是两条独立路径。

**`pnpm dev` 的限制**：dev preset 不加载自定义 Nitro entry，`/gw/` 之外的同源预览拦截不存在，所以 Browser 预览面板只能在生产构建（`pnpm build` + `node .output/server/index.mjs`）或 E2E 里验证。provisioning、备份等同理只在 Docker 形态可验。

## 架构大图

### 一次交互的完整链路

浏览器**一条 WebSocket**承载几乎所有业务实时交互（HTTP 只做登录、配置、admin、版本等）：

```
app/stores/gateway-realtime/connection.ts   （唯一持有 WebSocket 的地方）
  └─ server/api/realtime.get.ts → realtime/connection.ts:openRealtimePeer
     └─ realtime/message-dispatcher.ts（ts-pattern 穷尽匹配）→ realtime/handlers/*.ts
        └─ runtime/broker.ts:threadBroker（门面）
           └─ runtime/controller-registry.ts:getHostClientForUser  （key: userId:hostId:providerId）
              └─ runtime/host-rpc-session.ts:HostRpcSession
                 └─ infra/rpc/rpc.ts:CodexRpcClient
                    └─ infra/rpc/rpc-transport.ts → sshConnections.execChannel()
                       └─ 远端 `codex app-server proxy`（infra/ssh/remote-command.ts）
```

回程（事件 fan-out）：

```
app-server notification
  → HostRpcSession.routeNotification → runtime/thread-controller.ts
  → runtime/thread-runtime-events.ts:ThreadRuntimeEventBus.recordNotification
     ├─ agent/providers/codex/codex-event-mapper.ts  把 Codex 私有 JSON-RPC 译成中立 AgentEvent
     ├─ state/gateway-events.ts:gatewayEventStore    每 (hostId,threadId) 缓存最近 500 条 + host epoch
     ├─ usage / notifications / tmux-monitor 等副作用
     └─ publish → realtime/handlers/thread-events.ts → WS `thread.event` → 浏览器
```

关键不变量：**Codex app-server 是事实源**，`gatewayEventStore` 只是可失效的重放缓存（带 `epoch`，host 重连时 `rotateHostEpoch`，客户端游标失效由 `hasReplayGap` 检测并触发前端 `recoverThreadEventGap`）。不要在前端或 gateway 再造一条不可失效的 timeline。

### 连接生命周期（改 SSH/RPC 前必读）

- `infra/ssh/ssh-connection.ts:SshConnectionPool` 是「一台 host 一条 SSH 连接」的唯一落点，按 `connectionKeyFor(host)`（含当前 gateway 用户）去重；`keepaliveInterval: 30s`。所有 exec channel / shell / TCP channel / sftp 都复用这条连接。
- 断线只是把 key 从池里删掉（懒重连）。**自动重连在上一层**：`runtime/host-runtime-supervisor.ts` 为每个 `(userId, hostId)` 维护 `HostRuntimeSlot`，监听 `host-session-events.ts` 的关闭事件，退避算法在 `runtime/host-runtime-retry.ts`（1s 起指数退避，封顶 300s），重连动作在 `runtime/host-runtime-connection.ts:connectHostRuntime`（恢复订阅 → `activeMainThreadMonitor.recoverHost` → 刷新 running threads）。由 `server/plugins/host-runtime-supervisor.ts` 在 Nitro 启动时拉起。
- 订阅是**引用计数租约**：`ControllerRegistry.retainSubscription`，owner 分 `bootstrap`/`browser`/`scoped`，归零才向上游 `thread/unsubscribe`。
- 最后一个浏览器订阅释放但 turn 仍在跑时，订阅会「过继」给 `runtime/active-main-thread-monitor.ts`，保证通知/tmux 监控继续工作。删这段逻辑会导致关掉页面后收不到完成通知。

### 后端分层与依赖方向

`server/utils/gateway/` 严格单向依赖，自下而上：

1. `storage/`（`node:sqlite` 单例、幂等 schema、crypto）+ `state/`（进程内运行态，`state/memory.ts` 用 `AsyncLocalStorage` 做多用户隔离，`runWithGatewayUser` / `currentGatewayUserId` 是整个隔离机制的根）
2. `infra/`（SSH、RPC、codex 版本与升级、files/git/background/concurrency；`infra/host-services.ts` 组装并导出单例）+ `agent/`（provider 抽象，`providers/codex/*` 是唯一实现）
3. `runtime/`（thread broker 本体：broker / controller-registry / host-rpc-session / thread-controller / 各 `*-service.ts`）
4. 两个并列出口：`realtime/`（WS）与 `server/api/**`（HTTP）；另有 `server/tasks/gateway/*`（cron，见 `nuxt.config.ts` 的 `nitro.scheduledTasks`）与 `server/plugins/*`（启动钩子）

`protocol/` 是纯函数 DTO 转换，被上层广泛引用但不反向依赖。`settings/`、`audit/`、`usage/`、`notifications/`、`provisioning/`、`terminal/`、`tmux-monitor/`、`browser-preview/`、`host-metrics/`、`host-mfa/` 是横向模块，彼此只通过各自事件总线解耦。

### 前端：单路由 SPA + 事件总线

- **没有 `app/pages/`，没有 middleware**。`app/app.vue` 是唯一入口，用条件渲染在 Setup / Landing / Login / ForcePasswordChange / AdminConsole / NuxtLayout 之间切换；`/gw/admin` 也是对 `route.path` 做字符串判断，不是路由。
- 「路由」状态在 `app/stores/gateway-navigation/`，由 `app/stores/gateway/route-state.ts` 手写 `URLSearchParams` + `history.pushState` 同步 `?hostId=&projectId=&threadId=&new=1`。
- 布局二选一（`app/layouts/default.vue` / `mobile.vue`），由 `useDevice().isMobileOrTablet` 决定。
- **`app/stores/gateway-realtime/` 是唯一实时入口**：`connection.ts`（建连/鉴权/指数退避重连/focus 健康检查）、`thread-subscriptions.ts`（带 `afterId`/`afterEpoch` 游标的订阅与重放）、`request-broker.ts`（同一条 socket 上的 requestId ↔ Promise RPC）、`server-message-handlers.ts`（`ts-pattern` 分流到 `handlers/*.ts`）。
- **跨 store 通信一律走 `app/stores/gateway/domain-events.ts` 的 `gatewayDomainEvents` 事件总线**，订阅在 `domain-subscribers.ts` 由插件一次性注册。领域 store 之间不互相 import（只有 `gateway-bootstrap/refresh.ts` 这类编排函数可以 import 多个 store）。新增跨领域联动时沿用这个模式，不要塞回单个大 store。
- 26 个 store 按领域细分，thread 相关就拆成 `gateway-thread-view`（渲染视图）/`-runtime`（运行状态）/`-turns`（提交中的 turn）/`-activity`（侧栏投影）/`gateway-composer`/`gateway-turn-recovery`。改动前先确认状态属于哪一个。

### thread 时间线：归约器在 shared/，前后端共用

`shared/thread-history/canonical-events.ts:applyCanonicalEventToHistory` 是**唯一的时间线状态机**，初始快照回放和实时增量走同一条路径；`timeline.ts:projectThreadTimelineHistory` 投影成可渲染结构。前端在 `app/stores/gateway-thread-view/actions/live-events.ts` 用 `requestAnimationFrame` 把同帧内的多个 delta 合并成一次投影（逐 token 触发响应式会卡）。渲染侧：`ThreadVirtualTimeline.vue` → `timeline-rows.ts:buildThreadTimelineRows` → 虚拟滚动 → `app/utils/thread-item-registry.ts` 按 `ThreadTimelineItemType` 查表拿组件（`app/components/thread/items/`，20+ 种）。**新增 item 类型必须同时补归约器、投影白名单和注册表**，否则事件会被静默丢弃。

### `/gw/` baseURL 与同源预览代理

`nuxt.config.ts` 把 `app.baseURL` 设成 `/gw/`，`server/nitro/node-entry.mjs`（仅生产构建启用）据此分流：`/gw/` 内交给 Nitro，**其余全部**交给 `browser-preview/browser-preview-proxy.ts`，按 HttpOnly cookie（`__Host-gateway-preview`）反查预览会话，经 SSH TCP channel 打到远端应用。因此前端任何绕过 `$fetch`/`NuxtLink` 的原生 URL（`new WebSocket`、`window.location`、popout 窗口、静态资源）都必须用 `app/utils/gateway-url.ts:gatewayPath()` 拼前缀。

### 协议契约：`shared/` 是唯一来源

`shared/types/realtime.ts` 定义 `RealtimeClientMessage` / `RealtimeServerMessage` 判别联合，`shared/runtime/realtime/*-message-schema.ts` 是对应的 zod 校验。消息类型用命名空间前缀当 topic（`auth.*`、`host.*`、`thread.*`、`turn.*`、`terminal.*`、`browser.*`、`file.*`、`tmux.*`、`mcp.*`、`serverRequest.respond`、`ping`/`pong`）。

**新增一个 WS 消息类型要同时改 5 处**：`shared/types/realtime.ts` → 对应 zod schema → `server/utils/gateway/realtime/message-handlers.ts`（注册表）+ `realtime/handlers/*.ts`（实现）→ 前端 `app/stores/gateway-realtime/server-message-handlers.ts`。服务端和前端都用 `ts-pattern` 的 `.exhaustive()`，漏掉任何一处都是类型错误而不是运行时静默失败——这是有意设计，别用 `default` 分支绕过。

### 存储与凭据

`storage/database.ts` 用 Node 内置 `node:sqlite`（非 ORM），打开即 `migrateGatewaySchema`。**migration 没有版本表，是全量幂等脚本**（`CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 逐列 `ADD COLUMN`），加字段就在 `storage/schema.ts` 里追加幂等语句。该文件被刻意写成零外部依赖，因为 `scripts/create-user.mjs` 直接用 Node 加载它。

凭据三种处理方式（`storage/crypto.ts`）：密码 argon2id；session token 只存 `sha256`，明文仅登录响应下发一次；整份 `GatewayConfig`（含 SSH 密码/私钥）AES-256-GCM 加密进 `user_configs.encrypted_config_json`，密钥由 `CODEX_GATEWAY_CONFIG_SECRET` 派生，生产未设置直接拒绝启动。`audit/audit-log.ts` 写审计前还会按 `password|token|secret|key|credential` 正则过滤 detail。

### packages/ 是预编译产物，不是源码

三个子包（`@codex-gateway/ui`、`@codex-gateway/ai-elements`、`@codex-gateway/browser-runtime`）各自 `vite build` 出 `dist/`，业务代码永远按包名子路径引用（`import { Button } from "@codex-gateway/ui/button"`），不走相对路径。`components.json` 里的 `aliases.components` 只给 shadcn-vue CLI 生成新组件用。

**改了 `packages/*/src` 后 Nuxt watcher 不会感知**，要手动 `pnpm build:dependencies`（或 `pnpm --filter @codex-gateway/ui build`）+ `pnpm typecheck:dependencies`；`pnpm dev` / `pnpm build` 的 pre-hook 会自动跑一次。

### i18n 与错误码

`i18n/locales/{zh,en}.json` 三个顶层命名空间：`landing` / `app` / `errors`。默认中文，`strategy: "no_prefix"`，不探测浏览器语言。**没有 key parity 的自动校验**，中英文同步靠人工。

服务端错误统一用 `server/utils/gateway/http/errors.ts:gatewayApiError(code, ...)` 抛出稳定机器码，前端在 `errors.<code>` 下取文案（`te()` 判断存在性，缺失回退到服务端原始 message）。新增错误码必须补 `zh.json` 和 `en.json` 的 `errors.*`。

**Pinia store 里禁止调用 `useI18n()`**，必须用 `app/composables/i18n/useGatewayTranslator.ts`（走 `useNuxtApp().$i18n`，不依赖组件实例）。`app/stores/gateway-bootstrap/index.ts` 是正确范例。

这条违反了不会被任何检查拦下：`useI18n` 是 Nuxt 全局自动导入，源码里没有 import 语句，`no-restricted-imports` 匹配不到；oxlint 1.80 也不支持 `no-restricted-syntax`。typecheck 同样是绿的。它只在运行时炸，而且表现极具误导性：

- 登录后 `app.vue` 的 `watch([initialized, token])` 回调调用 `resetGatewayClientSession()`，在**非组件 setup 上下文**里首次实例化所有 store
- 任一 store 的 setup 里有 `useI18n()` 就抛 vue-i18n 的 `MUST_BE_CALL_SETUP_TOP`，函数中断，其后的 `refreshGatewayClient()` 永不执行
- 界面表现：**永久「正在加载远端会话」、零网络请求、零 WebSocket**，看起来像后端或网络问题，实际是前端同步异常
- 诊断信号：浏览器 console 出现 `SyntaxError: <数字>`，数字是 vue-i18n 错误码（26 = `MUST_BE_CALL_SETUP_TOP`）。看到"一直加载但没有任何请求在等"，先开 console，不要去查后端
- 它是**必现**而非偶发：Pinia store 只在首次 `useStore()` 时执行 setup，而 `resetGatewayClientSession()` 在任何登录后组件挂载之前运行，对只在登录后界面用到的 store 来说它永远是首个实例化点。所以每次登录都会炸；改动后若没发现，说明没跑 E2E。`tests/e2e/bootstrap-completes.spec.ts` 守着这条路径

### Codex 版本基准

`server/utils/gateway/infra/codex/codex-version.ts:SUPPORTED_CODEX_VERSION` 是远端安装、升级和 RPC client metadata 共用的唯一版本闸门，`third_party/openai-codex/` submodule 对齐该 tag，E2E 脚本也从这个文件读版本。升级 Codex 时这几处要一起动；另外 `deploy/user-container/entrypoint.sh` 依赖 Codex 的**内部**环境变量 `CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED` 关闭 remote control，它不是公开接口，升级时须到新版本源码确认仍然存在，否则 app-server 会重新陷入每秒一次的认证重试。
