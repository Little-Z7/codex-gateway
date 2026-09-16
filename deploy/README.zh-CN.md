# codex-gateway 部署手册

本 fork 把每个成员的 Codex 工作区跑在 Gateway 自动创建的 Docker 容器里：管理员在"设置 → 用户管理"建用户并一键创建工作区，成员登录后看到一个只读的托管 host，浏览器预览与 Gateway 同源。

## 前置条件

- Docker Engine + Compose v2；Gateway 容器需要挂 `/var/run/docker.sock` 来创建用户容器。
- Gateway 所在机器能访问 OpenAI（Codex 登录与模型调用）。
- 安全提示：挂载 docker.sock 等于给 Gateway 宿主机 root 权限，**必须部署在内网或可信反向代理之后**，不要对公网裸露。

## 目录规划

```
./data/codex-gateway.db     # SQLite：用户、会话、加密后的连接配置
./data/shared-auth/         # 共享 Codex 登录（auth.json），uid 1000 可写
./data/shared/              # 可选：所有用户容器都能看到 /data/shared
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
CODEX_CLI_VERSION=$(node --experimental-strip-types --input-type=module -e \
  "import('./server/utils/gateway/infra/codex/codex-version.ts').then(m => process.stdout.write(m.SUPPORTED_CODEX_VERSION))")
docker compose --profile build-only build codex-gateway-user
docker compose build codex-gateway
docker compose run --rm codex-gateway node scripts/create-user.mjs --admin admin '<密码>'
docker compose up -d codex-gateway
```

## 一次性共享登录

所有用户容器共享同一份 Codex 账号凭证：

```bash
./deploy/scripts/codex-login.sh
```

脚本在用户镜像里执行 `codex login --device-auth`（旧版自动退回 `codex login`），按提示打开设备码 URL 登录；成功后 `auth.json` 落在 `CODEX_GATEWAY_SHARED_AUTH_DIR` 里。用户容器通过软链 `/home/dev/.codex/auth.json → /srv/codex-auth/auth.json` 共享它；Codex 在 401 时会先 reload 磁盘再 refresh，所以多容器共用一份登录态是安全的。

## 管理员操作

浏览器打开 `http://<host>:3000` → 管理员登录 → 设置 → 用户管理：

- 新建用户时勾选"自动创建工作区容器"，或事后点"创建容器"。
- 容器状态徽标（运行中 / 已停止 / provisioning 转圈 / error 悬停看原因）；支持启动、停止、重建、删除（可选保留数据卷）。
- 删除用户可选择保留其 home 数据卷。
- provisioning 关闭时，"配置托管 host"仍可手动指向任意 SSH 主机。

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
