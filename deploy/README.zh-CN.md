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

## 出站代理

部署机只能经代理（例如 Clash/mihomo）访问外网时，设置一个配置项即可：

```dotenv
CODEX_GATEWAY_OUTBOUND_PROXY=http://172.17.0.1:7890
#CODEX_GATEWAY_OUTBOUND_NO_PROXY=internal.example.com,10.0.0.5
```

不设置时行为完全不变。设置后覆盖两条路径：

- **Gateway 进程自身**的出站 `fetch()`：Codex standalone 发行包下载（`releases.openai.com`/GitHub，见
  `server/utils/gateway/infra/codex/codex-artifacts.ts`）、管理台"检查 npm 最新版本"、Bark 推送。Codex 发行包**由 Gateway
  自己下载后经 SSH 上传给远端主机/用户容器**（`CodexRpcClient.connect()` 触发的 standalone 迁移），不是主机自己下载，所以这一项就覆盖了升级链路。
- **用户容器内的 Codex**：调模型 API、以及容器内可能发生的下载。provisioning 把它写进容器 Env，`deploy/user-container/entrypoint.sh`
  再落到 `/etc/profile.d/`（sshd 不会把容器 Env 带进 SSH 会话，与共享 API-key provider 用同一套机制）。改配置后对已有容器要
  `docker restart <容器>`（或管理面板"停止/启动"）触发 entrypoint 重写，新建容器自动生效。

机制细节（`deploy/gateway-entrypoint.sh`）：Node 原生 `fetch()` 默认不读 `http_proxy`/`https_proxy`；`NODE_USE_ENV_PROXY=1`
让 Node 用 undici 的 `EnvHttpProxyAgent` 读取它们，但这个开关**必须在进程启动时就存在于环境变量里**，进程起来后再用 JS 设置
`process.env` 无效——已用 `node:24-bookworm-slim` 实测验证。Gateway 镜像的 ENTRYPOINT 因此是一层 shell 包装脚本，只在
`CODEX_GATEWAY_OUTBOUND_PROXY` 非空时补上这几个变量再 `exec` 真正的 `node`。同样经过实测：只有小写的
`http_proxy`/`https_proxy`/`no_proxy` 生效，大写的 `HTTP_PROXY`/`HTTPS_PROXY` 不生效。

`CODEX_GATEWAY_OUTBOUND_NO_PROXY` 只是逗号分隔的**额外**直连主机名/IP；`localhost`/`127.0.0.1`/`::1` 始终直连，不受它影响。
**不支持 CIDR 网段写法**（同样已实测：Node 的代理匹配只认精确主机名/IP 和域名后缀，`10.0.0.0/8` 这类写法不会被当成直连）——
需要整段私网直连时，要么逐个列出主机名，要么依赖上游代理自身的规则（mihomo/Clash 默认规则集通常已经把私网段直连）。

构建 `codex-gateway-user` 镜像本身（`npm install -g @openai/codex`）走的是 `docker compose build`，这一步的代理与
`CODEX_GATEWAY_OUTBOUND_PROXY` 无关（那是运行时配置，构建时容器还不存在）。`docker build`/`docker compose build` 不会
读取执行 shell 里的 `http_proxy` 环境变量（已实测：只认 Docker CLI 自己的 `~/.docker/config.json` 的 `proxies` 配置，或显式
`--build-arg`），需要代理时用：

```bash
docker compose --profile build-only build --build-arg http_proxy=<proxy> --build-arg https_proxy=<proxy> codex-gateway-user
```

或者一次性在部署机的 `~/.docker/config.json` 里配置 `proxies.default`，让 Docker CLI 对所有构建/容器都生效。

## 安全加固

默认配置（`shared` 网络、无 PID/cgroup 上限）保持了升级前的行为，兼容本机 `pnpm dev`/E2E 环境。**同一台机器上还跑着其它生产服务**时（例如线上部署机），建议按下文把用户容器的资源和网络都收紧。所有改动只在**重建容器**后生效——已经在跑的容器不会自动应用新的 `HostConfig`/网络配置，需要 admin 后台的"重建"或 `docker compose up -d --build codex-gateway` 后走一遍 provision/recreate 流程。

### 资源限制

- `CODEX_GATEWAY_USER_CONTAINER_PIDS`（默认 `512`，`0` 表示不限）写入 `HostConfig.PidsLimit`，防止容器内 fork 炸弹耗尽宿主机 PID。已实测：设置为较小值时 Docker 会直接拒绝超额的新进程（`OCI runtime exec failed`），容器本身不受影响。
- `CODEX_GATEWAY_USER_CONTAINER_CGROUP_PARENT` 把所有用户容器的 cgroup 挂到同一个 systemd slice 下（**仅 systemd cgroup 驱动**，`docker info` 里 `Cgroup Driver: systemd`；`cgroupfs` 驱动不支持这个用法），这样宿主机可以对这个 slice 整体设一个上限，即使单个容器的 `CODEX_GATEWAY_USER_CONTAINER_MEMORY/CPUS` 留空或设得较宽松，也不会拖垮同机的其它服务。

  部署机一次性建立 slice（名字不要含 `-`，否则 systemd 会把它解析成多级父 slice；下面示例用 `codexgatewayusers.slice`）：

  ```bash
  cat > /etc/systemd/system/codexgatewayusers.slice <<'EOF'
  [Unit]
  Description=codex-gateway user containers (aggregate resource cap)

  [Slice]
  MemoryMax=8G
  CPUQuota=400%
  TasksMax=4096
  EOF
  systemctl daemon-reload
  systemctl start codexgatewayusers.slice
  ```

  再在 `.env` 里设置 `CODEX_GATEWAY_USER_CONTAINER_CGROUP_PARENT=codexgatewayusers.slice`，重建用户容器后生效。之后调整上限不需要重建容器，直接：

  ```bash
  systemctl set-property codexgatewayusers.slice MemoryMax=12G CPUQuota=600% TasksMax=8192
  ```

  该机制已实测验证：`docker run --cgroup-parent=<slice> ...` 创建的容器会出现在 `/sys/fs/cgroup/<slice>/docker-<id>.scope` 下；在 slice 上设置 `MemoryMax` 后，容器内单个进程超出 slice 总量会被 cgroup OOM killer 杀死（`dmesg` 显示 `oom_memcg=/<slice>`），但容器本身（其它进程）不受影响；`TasksMax` 同理是 slice 内所有容器进程数之和的上限，`systemctl set-property` 对运行中的 slice 立即生效。

### 网络隔离

`CODEX_GATEWAY_USER_NETWORK_ISOLATION=per-user`（默认 `shared`，即历史行为不变）让每个用户拿到一个独立的 `Internal: true` Docker bridge 网络，只有 Gateway 自身容器和 `CODEX_GATEWAY_OUTBOUND_PROXY_CONTAINER` 指定的出站代理容器会被接入。目标：用户容器只能 (1) 接受 Gateway 发起的 SSH，(2) 经代理容器的数据端口出网；不能访问其它用户容器、宿主机、局域网、Gateway 的 HTTP 端口、代理容器的控制端口。

实测矩阵（Ubuntu 24.04 / Docker CE / cgroup v2 / systemd 驱动，与线上机型一致；容器均为 `alpine` + `nc`，用 `nc -z -w2 <ip> <port>` 探测）：

| 从用户容器 A 出发 | 目标 | 仅靠 Docker `Internal: true`（无 iptables） | 加两条 `DOCKER-USER` + 一条 `INPUT` 规则后 |
| --- | --- | --- | --- |
| A → B（另一个用户，不同的每用户网络） | B:22 | **已阻断**（不在同一网络，无路由） | 已阻断 |
| A → 宿主机默认 bridge 网关 IP（如 `docker0` 172.18.0.1） | 任意端口 | **已阻断**（Internal 网络无出网路由） | 已阻断 |
| A → 局域网/公网（如 1.1.1.1:443） | 443 | **已阻断**（同上） | 已阻断 |
| A → **自己所在网络自己的 bridge 网关 IP**（如 172.30.11.1，宿主机在该网段的地址） | 宿主机上监听 `0.0.0.0` 的服务（如 sshd） | **未阻断**——这条流量对内核而言是"目的地是本机"的 `INPUT` 流量，不受 `Internal` 网络语义约束，也不经过 `DOCKER-USER`（那是 `FORWARD` 链） | 已阻断（`INPUT` 规则） |
| A → Gateway 容器:3000（Gateway 与代理容器都被接入了 A 的网络） | Gateway 的 HTTP/管理端口 | **未阻断**——Docker 网桥内同网段容器之间没有端口级 ACL，`Internal` 只挡外部路由 | 已阻断（`DOCKER-USER` 规则，**需要 `br_netfilter` 内核模块**，见下） |
| A → 代理容器:7890（数据端口） | 出站代理 | 可达（符合预期，用户需要经代理出网） | 仍可达 |
| A → 代理容器:9090（Clash 控制端口，若使用 Clash） | 代理的管理 API | **未阻断**，原因同 Gateway:3000 | 已阻断（`DOCKER-USER` 规则） |
| Gateway → A:22 | SSH（Gateway 管理用户容器的路径） | 可达（预期，Gateway 与 A 同网络） | 仍可达 |
| Gateway 容器被 `docker rm && docker run` 重建后 → A:22 | SSH | 重建后立刻不可达（网络成员丢失） | Gateway 启动时会自动 `docker network connect` 回所有用户网络（见下），重连后立刻恢复可达 |

结论：**Docker 原生的 `Internal: true` 网络已经覆盖了绝大部分隔离面**（跨用户、局域网、公网、宿主机默认网桥），代码只需要创建/挂接/回收这些网络（见下方生命周期），不需要额外的 iptables 才能达到"用户之间互相隔离、也隔离出局域网/公网"的效果。但还剩两类**同一网段内**的可达性，Docker 没有端口级 ACL 能拦，需要宿主机加两类 iptables 规则：

1. **`DOCKER-USER` 链**（Docker 保留给管理员自定义规则的链，dockerd 重启不会清空它，但**不会**跨机器重启持久化，需要配合 `iptables-persistent`）按来源子网 + 目的端口丢弃，覆盖"Gateway HTTP 端口"和"代理控制端口"两个网关：

   ```bash
   iptables -I DOCKER-USER -s 172.30.0.0/16 -p tcp --dport 3000 -j DROP \
     -m comment --comment "codex-gateway: block user containers -> gateway HTTP"
   iptables -I DOCKER-USER -s 172.30.0.0/16 -p tcp --dport 9090 -j DROP \
     -m comment --comment "codex-gateway: block user containers -> proxy control port"
   ```

   `172.30.0.0/16` 必须和 `CODEX_GATEWAY_USER_NETWORK_SUBNET_BASE` 一致（默认就是这个值）；按**来源子网**而不是按目的 IP 匹配是关键——Gateway/代理容器的 IP 会在每次被重建、重新接入网络时改变，子网匹配不需要跟着更新，一条静态规则永久覆盖所有当前和未来的每用户网络。端口按你实际用的端口改（Gateway 固定 3000；代理控制端口看你用的实现，Clash 默认 9090）。

   **前置条件**：这条规则要生效，宿主机必须加载 `br_netfilter` 内核模块并打开 `net.bridge.bridge-nf-call-iptables`——否则同一个 Linux 网桥内的容器间流量根本不经过 `iptables FORWARD`/`DOCKER-USER`（纯二层转发，对 netfilter 不可见），规则形同虚设。已实测确认：不加载 `br_netfilter` 时上表第 5、7 行会显示"可达"，加载后立即变为"已阻断"，且不影响 SSH（第 8 行）和代理数据端口（第 6 行）。持久化：

   ```bash
   cat > /etc/modules-load.d/codex-gateway-br-netfilter.conf <<'EOF'
   br_netfilter
   EOF
   cat > /etc/sysctl.d/99-codex-gateway-bridge-nf.conf <<'EOF'
   net.bridge.bridge-nf-call-iptables=1
   EOF
   modprobe br_netfilter
   sysctl --system
   ```

2. **`INPUT` 链**：用户容器不应该有任何理由直接访问宿主机本身（哪怕是端口 22），所以直接整段丢弃来自保留子网、目的地是宿主机自己的流量——这条不需要 `br_netfilter`（目的地是本机地址的流量走标准 `INPUT` 处理，与网桥转发无关），能同时挡住"经由自己所在网络的 bridge 网关 IP 访问宿主机上监听 `0.0.0.0` 的服务"这个向量（已实测：起一个绑定 `0.0.0.0` 的监听器，加规则前可达，加规则后阻断）：

   ```bash
   iptables -I INPUT -s 172.30.0.0/16 -j DROP \
     -m comment --comment "codex-gateway: block user containers -> host itself"
   ```

   持久化（Ubuntu/Debian）：

   ```bash
   apt-get install -y iptables-persistent
   netfilter-persistent save
   ```

   （或者写一个在 `network-online.target` 之后运行的 systemd oneshot 服务，在里面重新执行上面几条 `iptables -I` 命令，效果等价。）

**代理控制端口的另一个保护层**：如果你的宿主机/CI 环境不方便碰 `br_netfilter`/`iptables-persistent`，退而求其次，务必给代理（如 Clash）配置的管理 API 设置 `secret`，这样即使控制端口在网络层可达，没有 secret 也调不动它。

生命周期覆盖：

- **provision**：按用户名 + userId 派生的确定性名字/子网创建（或复用已存在的）每用户网络，创建成功后立刻把 Gateway 自身容器和 `CODEX_GATEWAY_OUTBOUND_PROXY_CONTAINER` 接进去，再创建用户容器并把它的 `NetworkMode` 设成这个网络。
- **deprovision（彻底删除）**：先把 Gateway/代理容器从该网络断开，再删除网络。**deprovision 且保留数据卷**（管理台"重建"用的路径）不删网络——网络原地留着（这时只有 Gateway/代理两个成员，没有安全含义），下次 provision 按名字复用，子网不变，不会产生新的子网探测开销。
- **滚动重建全部容器 / 配额变更重建**：逐个走 deprovision（保留卷）→ provision，网络处理同上，不会中断其它用户的网络。
- **定时 reconcile（每 5 分钟）**：除了原有的容器状态漂移检查，还会对每一个仍记录着 `networkName` 的用户重新执行一次 Gateway/代理容器接入（`docker network connect` 是幂等的，已接入会被忽略）——这是**代理容器被外部重建**后的自愈路径，最多 5 分钟内自动恢复。
- **Gateway 自身重启/重建**：Nitro 启动插件（`server/plugins/provisioning-repair.ts`）会在处理完中断的 provisioning 行之后，立刻对所有已知的每用户网络重新执行一次接入。Gateway 容器的自身标识默认用 `os.hostname()`（Docker 默认把容器主机名设成它自己的容器 ID，本仓库的 compose 文件都没有覆盖 `hostname:`，所以零配置就能工作）；`CODEX_GATEWAY_SELF_CONTAINER` 可以显式覆盖（compose 里默认设成固定的 `codex-gateway`，即 `container_name` 的值，更直观也更稳）。

### 共享挂载

- `/srv/codex-auth`（共享 ChatGPT 登录）现在**只在 `CODEX_GATEWAY_MODEL_PROVIDER=openai`（默认，共享登录路径）时才挂载**；用 `custom`（共享 API-key provider）的部署完全不会挂这个目录，容器内也就没有共享登录态可读。判定逻辑读的是"设置层"（DB 优先于 env）解析出来的最终 provider 模式，不是看这个环境变量本身是否配置。
- `/data/shared` 默认改成**只读**挂载；需要历史上那种"所有用户互相可写"的行为时，显式设置 `CODEX_GATEWAY_SHARED_DATA_WRITABLE=true`。

### 233 类"同机跑生产服务"机器的推荐配置

```dotenv
CODEX_GATEWAY_USER_CONTAINER_PIDS=512
CODEX_GATEWAY_USER_CONTAINER_CGROUP_PARENT=codexgatewayusers.slice
CODEX_GATEWAY_USER_NETWORK_ISOLATION=per-user
CODEX_GATEWAY_USER_NETWORK_SUBNET_BASE=172.30.0.0/16
CODEX_GATEWAY_SELF_CONTAINER=codex-gateway
CODEX_GATEWAY_OUTBOUND_PROXY_CONTAINER=clash
#CODEX_GATEWAY_SHARED_DATA_WRITABLE=  # 留空/不设，保持只读
```

宿主机一次性命令：

```bash
# 1) 资源上限 slice
cat > /etc/systemd/system/codexgatewayusers.slice <<'EOF'
[Slice]
MemoryMax=8G
CPUQuota=400%
TasksMax=4096
EOF
systemctl daemon-reload && systemctl start codexgatewayusers.slice

# 2) br_netfilter（DOCKER-USER 规则的前置条件），持久化
echo br_netfilter > /etc/modules-load.d/codex-gateway-br-netfilter.conf
echo 'net.bridge.bridge-nf-call-iptables=1' > /etc/sysctl.d/99-codex-gateway-bridge-nf.conf
modprobe br_netfilter && sysctl --system

# 3) 两条 DOCKER-USER + 一条 INPUT 规则，端口按实际的 Gateway/代理端口改
iptables -I DOCKER-USER -s 172.30.0.0/16 -p tcp --dport 3000 -j DROP
iptables -I DOCKER-USER -s 172.30.0.0/16 -p tcp --dport 9090 -j DROP
iptables -I INPUT -s 172.30.0.0/16 -j DROP
apt-get install -y iptables-persistent && netfilter-persistent save
```

之后 `docker compose up -d --build codex-gateway`，并对**已存在**的用户容器逐个走"重建（保留卷）"（或"滚动重建全部容器"）让新的 `HostConfig`/网络生效。

### 未覆盖的风险（需要产品侧决策）

加固到这一步之后仍然存在、代码没有（也无法仅靠这些配置项）解决的风险，供决策是否需要更重的隔离方案（gVisor/Kata、rootless Docker、userns-remap 等）：

- **容器逃逸 = 宿主机 root**：用户容器内 `dev` 用户拥有免密 sudo，宿主机没有开启 Docker `userns-remap`。一旦发生内核或 runc 层面的逃逸漏洞，攻击者在容器内已经是 root（sudo 免密），逃逸后直接是宿主机 root，本次改动的资源/网络限制都无法阻止这一步。
- **模型 API key 对容器内用户可读**：`custom` provider 的 key 通过环境变量注入（`docker inspect` 可见）并落到容器内 `/etc/profile.d/`；容器内的 `dev` 用户（有 sudo）始终能读到自己的 key。
- **Gateway 持有 `docker.sock`**：Gateway 容器可以控制宿主机上的任意容器，等同于宿主机 root 能力；只应部署在受信管理员才能访问的后台之后。
- **代理控制端口的兜底**：如果宿主机不便应用 `br_netfilter`/iptables（例如某些高度锁定的容器化 CI），Gateway HTTP 端口和代理控制端口在同网段内仍然可达；此时至少要给代理的管理 API 配置 secret/token 认证。

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
