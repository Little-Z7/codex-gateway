# codex-gateway 部署手册

本 fork 把每个成员的 Codex 工作区跑在 Gateway 自动创建的 Docker 容器里：管理员在"设置 → 用户管理"建用户并一键创建工作区，成员登录后看到一个只读的托管 host，浏览器预览与 Gateway 同源。

## 前置条件

- Docker Engine + Compose v2；Gateway 容器需要挂 `/var/run/docker.sock` 来创建用户容器。
- `bash`、`openssl`；bootstrap 在非 root 下运行时需要 `sudo`（用于把共享目录 chown 到 uid 1000）。
- Gateway 所在机器能访问 OpenAI（Codex 登录与模型调用）。
- 安全提示：挂载 docker.sock 等于给 Gateway 宿主机 root 权限，**必须部署在内网或可信反向代理之后**，不要对公网裸露。

## 目录规划

```
./data/codex-gateway.db     # SQLite：用户、会话、加密后的连接配置
./data/shared-auth/         # 共享 Codex 登录（auth.json），uid 1000 可写
./data/shared/              # 所有用户容器都能读写 /data/shared（统一 uid 1000）
deploy/user-container/      # 用户工作区镜像（openssh + Node 22 + codex）
deploy/scripts/             # bootstrap.sh / codex-login.sh
```

## 一键部署

```bash
./deploy/scripts/bootstrap.sh <管理员用户名> '<密码>'
```

bootstrap 幂等：生成 `.env`（含随机 `CODEX_GATEWAY_CONFIG_SECRET`）、把 `CODEX_CLI_VERSION` 写成代码里 `SUPPORTED_CODEX_VERSION` 的值、准备数据目录、构建两个镜像、创建 `codex-gateway` Docker 网络、创建管理员并 `up -d`。服务监听 `${CODEX_GATEWAY_PORT:-3000}`。

也可以分开执行：

```bash
cp .env.example .env          # 按需修改
docker network create codex-gateway
CODEX_CLI_VERSION=$(grep -oE 'SUPPORTED_CODEX_VERSION = "[^"]+"' \
  server/utils/gateway/infra/codex/codex-version.ts | cut -d'"' -f2)
docker compose --profile build-only build codex-gateway-user
docker compose build codex-gateway
docker compose up -d codex-gateway
```

### 创建管理员

二选一：

- **页面初始化（推荐）**：数据库为空时首次打开 `http://<host>:<port>/gw/` 会显示「初始化 Codex
  Gateway」页面，填写用户名和密码即可创建首个管理员并自动登录。初始化完成后该入口自动关闭。
- **CLI**：容器启动后执行

  ```bash
  docker compose exec codex-gateway node scripts/create-user.mjs --admin admin '<密码>'
  ```

  （容器未运行时可用 `docker compose run --rm codex-gateway ...`，同上一条命令格式。）

## 模型接入：共享登录 或 共享 API-key provider

两条路径二选一，由 `.env` 的 `CODEX_GATEWAY_MODEL_PROVIDER` 决定：

- **`openai`（默认）**：所有容器共享 `codex-login.sh` 写入的 ChatGPT 登录态（`auth.json` 软链）。
- **`custom`**：所有容器共用一个 API-key 模型 provider，不需要共享登录。配置示例：

  ```dotenv
  CODEX_GATEWAY_MODEL_PROVIDER=custom
  CODEX_GATEWAY_MODEL_PROVIDER_ID=ollama-cloud        # [a-z0-9_-]+
  CODEX_GATEWAY_MODEL_PROVIDER_NAME=Ollama Cloud
  CODEX_GATEWAY_MODEL_PROVIDER_BASE_URL=https://ollama.com/v1
  CODEX_GATEWAY_MODEL_PROVIDER_API_KEY=<key>
  CODEX_GATEWAY_MODEL_PROVIDER_WIRE_API=responses     # Codex 0.154 起必须 responses
  CODEX_GATEWAY_MODEL=gpt-oss:120b
  CODEX_GATEWAY_WEB_SEARCH=disabled                   # custom 默认 disabled
  ```

  容器 `config.toml` 顶/底的 `codex-gateway managed` 块每次启动都会重写（用户在块外的自定义保留）；API key 由 entrypoint 落到 `/etc/profile.d/` 供 SSH 会话读取，不写进 config.toml。注意：key 同时存在于容器 Env，`docker inspect` 可见——仅限内部可信环境。

切换方式：改 `.env` → `docker compose up -d` 重启 Gateway → 对已有容器执行 `docker restart <容器>`（或管理面板的"停止/启动"）让 entrypoint 重写受管块；新建容器自动生效。

## 一次性共享登录

所有用户容器共享同一份 Codex 账号凭证：

```bash
./deploy/scripts/codex-login.sh
```

脚本在用户镜像里执行 `codex login --device-auth`（旧版自动退回 `codex login`），按提示打开设备码 URL 登录；成功后 `auth.json` 落在 `CODEX_GATEWAY_SHARED_AUTH_DIR` 里。用户容器通过软链 `/home/dev/.codex/auth.json → /srv/codex-auth/auth.json` 共享它；Codex 在 401 时会先 reload 磁盘再 refresh，所以多容器共用一份登录态是安全的。

## 管理员操作

管理员登录后打开 `http://<host>:3000/gw/admin`（或工作区侧栏入口）。后台分六个 tab：

- **总览**：用户/在线会话/容器状态/用户卷容量，以及"今日 turn 数""今日 token"两张用量卡；磁盘超过阈值（`CODEX_GATEWAY_VOLUME_WARN_BYTES`，默认 20 GiB）的工作区在此汇总。
- **用户**：列表支持角色/状态/容器筛选、按用户名/最后登录/额度用量排序、多选批量启用/禁用/删除（可选保留数据卷）、导出 CSV。创建用户时可生成并复制初始密码、填写显示名与备注，并可勾选「要求首次登录修改密码」。点用户名进入详情页：基本信息（可编辑显示名/备注）、在线会话（可逐个或批量撤销）、用量额度、托管 host、容器资源、对话统计（来自运行时缓存，重启后为空）、该用户最近 50 条审计。
- **容器**：每行显示容器状态、镜像 digest（短 12 位）、容器内 Codex 版本（与 `SUPPORTED_CODEX_VERSION` 不一致时黄色徽标）、CPU/内存（无内存限制显示"不限"）；支持多选批量启动/停止/重建（保留卷）、日志弹窗（可开"跟随"每 2s 追加）。
- **用量**：按用户/天/模型的 turn 与 token 聚合图表 + 明细表 + CSV 导出；顶部显示本期超额用户数，表格标记是否超额。
- **会话**：全部在线会话（可撤销）与审计日志（筛选 + CSV 导出，显示保留天数）。
- **系统**：运行态指标（WS/SSH/RPC/事件缓存/内存）、模型 provider 编辑、共享登录、额度默认值、安全设置与锁定列表、通知默认值、备份、审计保留天数。

### 用户管理

- **初始密码**：创建对话框可「生成密码」并「复制」，避免管理员手输后无法告知成员。
- **强制改密**：勾选「要求首次登录修改密码」后，该用户登录会进入改密页（复用 `POST /api/auth/password`）。即使系统关闭了成员自助改密，此流程仍允许，改完即清除标记。
- **显示名与备注**：`users.display_name` / `users.note` 可在列表搜索、详情编辑；侧栏用户行优先显示显示名。

### 用户配额

`managed_hosts` 支持每用户 `memory_limit`/`cpu_limit` 覆盖（详情页「配额」卡），优先于全局 `CODEX_GATEWAY_USER_CONTAINER_MEMORY/CPUS`；保存后需「立即重建（保留数据卷）」生效。这是容器 CPU/内存配额，不是 token 额度。

### 用量额度

额度按 Gateway 用户（`currentGatewayUserId()`）计算，管理员同样受约束，除非其额度设为不限。日/月口径与 `usage_daily.day` 一致（UTC 日期）。

- **全局默认**：系统页「额度默认值」卡，写入 `gateway_settings` 的 `budget.defaults`（`dailyTokens` / `monthlyTokens` / `dailyTurns` / `monthlyTurns` + `warnPercent`，默认 80）。字段留空 = 该维度不限。
- **按用户覆盖**：`user_budgets` 一行覆盖该用户四维度；「使用全局默认」删除该行。任一字段 NULL = 该维度不限。
- **拦截**：在 `startTurnFromRealtime`（`turn.start`）校验。命中任一超额维度即拒绝，**不下发到 app-server**，返回 `budget.exceeded`（`dimension` / `used` / `limit` / `resetAt`）。已在运行的 turn 不打断，只拦新发起。前端 composer 显示阻断提示并禁用发送，Sonner 提示一次；达到 `warnPercent` 时仅低干扰提示。
- **重置**：详情页「重置本期用量」把该用户当月（含今日）`usage_daily` 的 turns/token 清零，并写审计 `budget.reset`。UI 会显示最近重置时间。
- **成员自查**：设置 → 账户 显示自己的额度进度条；`GET /api/usage/me` 返回用量与上限。

### 镜像与滚动重建

容器页顶部「镜像」卡：显示用户镜像 tag/digest/镜像内 Codex 版本（来自 image label）；"检查 Codex 新版本"对比 npm latest；"重建镜像"用 Docker API 直接构建 `deploy/user-container`（实时日志弹窗，同时只允许一个构建）；"滚动重建全部容器"逐个 deprovision+provision（保留卷），可配置间隔、可取消。

### 系统设置

`gateway_settings` 表持久化设置，优先级 **DB > env > 默认**：

- **模型 provider**：系统页可编辑（mode/id/name/baseUrl/wireApi/model/webSearch），API key 只写不读（界面只显示末 4 位）。保存后需重启 Gateway 容器并重启/重建用户容器才生效——页面提供"重启全部用户容器"按钮。
- **安全**：登录失败上限、锁定时长、会话有效期、是否允许成员自助改密码。
- **通知**：全局默认 Bark 服务器地址（用户未填时用它）。
- **审计**：审计日志保留天数（默认 180），每天 03:00 自动清理并写 `audit.prune` 审计。
- **额度默认值**：见上文「用量额度」。

### 用量统计口径

`usage_daily` 按（用户 × 天 × 模型）UPSERT 聚合：`thread/started` 计对话数、`turn/completed` 计 turn 数，input/output token 取 app-server 事件里的 `tokenUsage.last`（`thread/tokenUsage/updated`，Codex 0.153.x）。统计只反映 Gateway 运行时事件，容器内绕过 Gateway 的直接调用不计入。

### 备份（后台按钮）

系统页「备份」卡可点"立即备份"：与 `deploy/scripts/backup.sh` 等价的 Node 实现（SQLite `VACUUM INTO` 快照 + 共享 auth 目录 + 每个用户卷 alpine tar），输出到 `data/backups/<timestamp>/`，支持列表/下载（tar）/删除。要求 Gateway 容器挂载 `./data:/data`（compose 已带）。

## 成员体验

成员登录后只看到自己的托管 host（"托管"徽标，只读），含默认 project `workspace`（`/home/dev/workspace`）。成员不能新建/编辑/删除 host，也不能导入配置；浏览器预览与 Gateway 同源——同一浏览器同时只有一个活跃预览，在新面板打开会替换旧会话，旧面板可点"重新激活"。

## 权限与 sandbox

- 用户容器内工作用户为 `dev`（uid 1000），有免密 sudo；容器即隔离边界。
- 共享目录（`shared-auth`、`shared-data`）统一 chown 到 1000:1000。
- 容器内 `~/.codex/config.toml` 默认写入 `cli_auth_credentials_store = "file"` 与 `sandbox_mode = "danger-full-access"`（可用 `CODEX_GATEWAY_SANDBOX_MODE` 覆盖）；entrypoint 只在键缺失时写入，不覆盖用户修改。

## 升级 Codex 版本

`SUPPORTED_CODEX_VERSION` 变化后重建用户镜像即可：

```bash
./deploy/scripts/bootstrap.sh    # 会重新写入 CODEX_CLI_VERSION 并重建镜像
```

已有容器内 Codex 版本偏低时，Gateway 走既有的运行时升级路径；或重建容器换新镜像。

## 常见故障

- **docker.sock 权限**：Gateway 容器内必须能访问 `/var/run/docker.sock`（compose 已挂载）；用户管理页顶部的诊断卡会显示 Docker 不可达。
- **镜像不存在**：诊断卡显示"镜像缺失"→ 先 `docker compose --profile build-only build codex-gateway-user`。
- **auth.json 不存在**：诊断卡"共享登录缺失"→ 跑 `deploy/scripts/codex-login.sh`。
- **共享登录被踢 / refresh 冲突**：多个容器同时 refresh 后旧 token 失效属正常，Codex 会 reload 磁盘上的最新 auth.json；若 auth.json 损坏，重新登录即可。
- **容器创建失败**：行的 error 徽标 tooltip 里有 `last_error`；已创建的容器会保留供 `docker logs <name>` 排查。

## 备份与恢复

`deploy/scripts/backup.sh` 把 Gateway 全部持久化状态快照到 `data/backups/<timestamp>/`：

- **SQLite**：优先用 `sqlite3 .backup` 在线一致性快照；本机没有 sqlite3 时借用 `codex-gateway` 容器里的 sqlite3，再退回 WAL checkpoint + 文件拷贝。
- **共享 auth 目录**：`CODEX_GATEWAY_SHARED_AUTH_DIR`（`auth.json` 等）整体复制。
- **用户 home 卷**：每个 `codex-user-*-home` 卷用 `docker run --rm -v vol:/src alpine tar` 打成 `volumes/<卷名>.tar.gz`。

```bash
./deploy/scripts/backup.sh                     # 输出目录 data/backups/<timestamp>/
./deploy/scripts/restore.sh data/backups/<ts>  # 恢复：先停 gateway，再回写 db/auth/卷
```

restore 会停掉 `codex-gateway` 服务、回写 SQLite（清掉 wal/shm）、共享 auth 目录，并为每个备份卷重建 `docker volume` 后解包。恢复完成后 `docker compose up -d codex-gateway` 重启即可。数据库快照是离线的但备份过程不要求停机；恢复必须先停 Gateway 避免 WAL 覆盖。后台系统页的「备份」卡与脚本产出相同格式，二选一。

## 已知限制

- **同源预览单活跃**：浏览器预览由 HttpOnly cookie 路由，同一浏览器同时只有一个活跃预览；在新面板打开会替换旧会话。
- **仅 HTTP/WebSocket**：预览代理只转发 HTTP 请求与 WS upgrade，非 HTTP 端口（数据库直连、grpc 等）不能通过预览暴露。
- **docker.sock 风险**：Gateway 挂载 `/var/run/docker.sock`，能控制宿主机所有容器；仅限受信管理员账号访问后台。
- **API key 在容器内可见**：custom provider 的 key 以环境变量注入用户容器，`docker inspect` 可读——只用于内部受信拓扑。
