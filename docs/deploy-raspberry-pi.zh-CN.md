# 在树莓派 5 上部署 PageSail（Docker + Nginx + ngrok）

[English](deploy-raspberry-pi.md) · **简体中文**

本指南把 PageSail 部署到一台树莓派 5，用 Docker 中的 Nginx 提供静态网页，并通过宿主机上的 ngrok 把服务开放到公网。PageSail 的所有文件处理都在访客的浏览器中完成，树莓派只负责提供网页文件，不接收任何上传。

> 文中所有路径、用户名、域名都是**示例**，请替换成你自己的值：SSD 挂载点写作 `/mnt/ssd`，Linux 用户写作 `<USER>`，ngrok 域名写作 `<your-domain>.ngrok-free.app`。

## 0. 前提

| 项目 | 要求 |
| --- | --- |
| 硬件 | Raspberry Pi 5（8GB 内存），外接 SSD（本文以 1TB 为例） |
| 系统 | **Raspberry Pi OS 64 位（ARM64 / aarch64）**，基于 Debian 12 Bookworm 或更新版本 |
| 网络 | 能访问 GitHub、Docker Hub、npm 镜像源和 ngrok |
| 账号 | 一个 ngrok 账号和 authtoken（免费套餐即可；限制以 ngrok 官网当前说明为准） |

确认系统是 64 位：

```sh
uname -m          # 应输出 aarch64
getconf LONG_BIT  # 应输出 64
cat /etc/os-release | grep -E 'PRETTY_NAME|VERSION_CODENAME'
```

> 32 位系统（`armv7l`）不在本指南的支持范围内。

## 1. 准备外接 SSD

1. 查看磁盘（请确认设备名，**不要格式化错盘**）：

   ```sh
   lsblk -o NAME,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINT
   ```

2. 仅当这是一块**新的或可以清空的**磁盘时才格式化（会删除盘上所有数据），以 `/dev/sda1` 为例：

   ```sh
   sudo mkfs.ext4 -L pagesail-ssd /dev/sda1
   ```

3. 用 UUID 开机自动挂载：

   ```sh
   sudo mkdir -p /mnt/ssd
   sudo blkid /dev/sda1                 # 记下 UUID="..."
   sudoedit /etc/fstab
   # 添加一行（替换 UUID）：
   # UUID=<你的UUID>  /mnt/ssd  ext4  defaults,noatime,nofail,x-systemd.device-timeout=30s  0  2
   sudo systemctl daemon-reload
   sudo mount -a
   findmnt /mnt/ssd                     # 能看到挂载信息即成功
   sudo mkdir -p /mnt/ssd/pagesail /mnt/ssd/docker
   sudo chown "$USER":"$USER" /mnt/ssd/pagesail
   ```

`nofail` 能避免 SSD 未接入时系统卡在启动阶段。

## 2. 安装 Docker，并把 Docker 数据放到 SSD

树莓派 OS 64 位使用 Docker 官方的 Debian 软件源：

```sh
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"      # 之后重新登录一次，免 sudo 使用 docker
```

把镜像、构建缓存和容器数据放到 SSD（`data-root`）：

```sh
sudo systemctl stop docker docker.socket
# 如果之前已经用过 Docker，先迁移旧数据（全新安装可跳过）：
# sudo rsync -aHAX /var/lib/docker/ /mnt/ssd/docker/
echo '{ "data-root": "/mnt/ssd/docker" }' | sudo tee /etc/docker/daemon.json
# 让 Docker 等待 SSD 挂载完成再启动：
sudo mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=/mnt/ssd\n' | sudo tee /etc/systemd/system/docker.service.d/ssd.conf
sudo systemctl daemon-reload
sudo systemctl enable --now docker
docker info --format '{{.DockerRootDir}}'   # 应输出 /mnt/ssd/docker
docker compose version
```

## 3. 获取源代码（放在 SSD 上）

```sh
cd /mnt/ssd/pagesail
git clone https://github.com/cott-king/PageSail.git .
```

（可选）在 `.env` 中调整端口或资源上限，见 `.env.example`：

```sh
cp .env.example .env    # .env 不会进入 Git
```

## 4. 在树莓派上构建并启动

```sh
cd /mnt/ssd/pagesail
docker compose up -d --build
```

- 第一次构建会下载 `node:24-bookworm-slim` 和 `nginxinc/nginx-unprivileged:1.30-alpine` 的 arm64 镜像，并在容器内执行 `npm ci`、类型检查、Vite 构建和 gzip 预压缩，需要几分钟（耗时视网络和 SSD 而定）。
- 构建阶段使用 Node.js 24 LTS；运行镜像只包含 Nginx 和构建好的静态文件。
- 服务只映射到 `127.0.0.1:8080`，局域网中的其他设备无法直接访问，由宿主机上的 ngrok 负责对外开放。

查看状态：

```sh
docker compose ps        # STATUS 最终应为 healthy
```

## 5. 在本机验证生产页面

```sh
curl -fsS http://127.0.0.1:8080/healthz                                   # ok
curl -sI http://127.0.0.1:8080/ | grep -iE 'HTTP/|content-security-policy|cache-control'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8080/pdf-pages   # 200 text/html（刷新深层链接）
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8080/                  # 405（不接受上传）
curl -s http://127.0.0.1:8080/licenses/THIRD_PARTY_NOTICES.txt | head -5
```

在浏览器中查看：在树莓派桌面直接打开 `http://127.0.0.1:8080`；或在另一台电脑上建立 SSH 隧道后打开 `http://127.0.0.1:8080`：

```sh
ssh -L 8080:127.0.0.1:8080 <USER>@<树莓派地址>
```

（可选）在另一台装有本项目开发环境的电脑上，通过上面的 SSH 隧道对树莓派上的服务运行完整的浏览器测试：

```sh
PAGESAIL_BASE_URL=http://127.0.0.1:8080 PAGESAIL_EXPECT_HEADERS=1 npm run test:e2e
```

## 6. 安装 ARM64 版 ngrok

ngrok 官方 apt 软件源提供 arm64 软件包（软件源目前使用 `bookworm` 这一套件名；基于 Debian 13 的较新系统也使用同一行）：

```sh
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc > /dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update
sudo apt install -y ngrok
ngrok version
command -v ngrok          # 通常是 /usr/local/bin/ngrok
```

保存 authtoken（从 ngrok 控制台复制）。下面的写法不会把 token 留在 shell 历史里：

```sh
read -rs NGROK_TOKEN      # 粘贴 token 后回车（不会显示）
ngrok config add-authtoken "$NGROK_TOKEN" && unset NGROK_TOKEN
chmod 600 ~/.config/ngrok/ngrok.yml
```

token 只保存在宿主机的 `~/.config/ngrok/ngrok.yml` 中。**不要**把它写进本仓库、`.env`、前端代码或任何示例文件。

## 7. 把 ngrok 指向本地生产服务

先手动测试（Ctrl+C 结束）：

```sh
ngrok http 127.0.0.1:8080                                         # 随机公网地址
ngrok http 127.0.0.1:8080 --url https://<your-domain>.ngrok-free.app   # 使用你在 ngrok 控制台中的固定域名
```

终端会显示公网 HTTPS 地址，用手机流量打开它，确认能看到 PageSail。

### 开机自动运行（systemd）

仓库中的 `deploy/ngrok/pagesail-endpoint.example.yml` 只定义端点，**不含任何凭据**；运行时与你私有的 `~/.config/ngrok/ngrok.yml` 合并：

```sh
cd /mnt/ssd/pagesail
sudo mkdir -p /etc/pagesail
sudo cp deploy/ngrok/pagesail-endpoint.example.yml /etc/pagesail/ngrok-endpoint.yml
sudoedit /etc/pagesail/ngrok-endpoint.yml      # 填入你的域名，或删除 url 这一行以使用随机地址
ngrok config check --config ~/.config/ngrok/ngrok.yml --config /etc/pagesail/ngrok-endpoint.yml

sed "s/<USER>/$USER/g" deploy/systemd/pagesail-ngrok.service | sudo tee /etc/systemd/system/pagesail-ngrok.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now pagesail-ngrok
systemctl status pagesail-ngrok
journalctl -u pagesail-ngrok -f       # 日志中会出现公网地址
```

也可以改用 ngrok 自带的 `ngrok service install --config <配置文件>`，二选一即可。

关于 ngrok 的说明：

- ngrok 免费套餐可能有流量、连接数等限制，也可能对浏览器访客显示 ngrok 的提示页面；具体以 ngrok 当前套餐说明为准。
- ngrok 能看到经过隧道的请求（页面资源的路径、访客 IP 等），但 PageSail 不上传文件，所以看不到用户的文档内容。
- 如果只想让特定的人使用，可以在 ngrok 中配置访问控制（例如基本认证或 OAuth，见 ngrok 文档中的 Traffic Policy），PageSail 本身无需修改。

## 8. 日常运维

| 操作 | 命令 |
| --- | --- |
| 查看状态 | `docker compose ps`，`systemctl status pagesail-ngrok` |
| 查看网页服务日志 | `docker compose logs -f --tail=100`（日志不含 IP 和浏览器标识） |
| 查看 ngrok 日志 | `journalctl -u pagesail-ngrok -f` |
| 重启网页服务 | `docker compose restart` |
| 重启 ngrok | `sudo systemctl restart pagesail-ngrok` |
| 暂停对外访问 | `sudo systemctl stop pagesail-ngrok` |
| 停止网页服务 | `docker compose down` |
| 更新到最新版本 | `git pull --ff-only && docker compose up -d --build && docker image prune -f` |
| 修改资源上限或端口 | 编辑 `.env` 后执行 `docker compose up -d --build` |

开机后会自动恢复：Docker 服务已 `enable`，容器使用 `restart: unless-stopped`，ngrok 服务已 `enable`。容器日志由 Docker 轮转（单文件 10 MB，保留 3 个）。

如果端口 8080 已被占用，在 `.env` 中设置 `PAGESAIL_PORT=8090`，并把 `/etc/pagesail/ngrok-endpoint.yml` 中的 `upstream.url` 改成相同端口。

## 9. 在树莓派上直接开发（可选）

Docker 部署不需要在宿主机安装 Node.js。如果想在树莓派上运行开发服务器或测试，请安装 Node.js 24 LTS（例如通过 nvm），并把 npm 缓存放到 SSD：

```sh
npm config set cache /mnt/ssd/npm-cache
cd /mnt/ssd/pagesail && npm ci
npm run dev           # 仅用于开发，不要通过 ngrok 公开
npm test
```

`npm ci` 可能尝试编译一个仅供测试使用的可选原生模块（node-canvas），失败时 npm 会跳过它，不影响构建。浏览器测试需要 `npx playwright install chromium`（会下载 ARM64 版 Chromium）。

## 10. 故障排查

| 现象 | 处理 |
| --- | --- |
| `exec format error` | 镜像架构不对。在树莓派上重新执行 `docker compose up -d --build`。 |
| 拉取镜像时报 `429 Too Many Requests` | Docker Hub 匿名拉取频率受限，稍后重试或先 `docker login`。 |
| 构建时 `SELF_SIGNED_CERT_IN_CHAIN` | 网络中有做 TLS 检查的代理。把代理的 CA 证书以 secret 方式传入：`docker build --secret id=extra_ca,src=/path/ca.pem -t pagesail:local .`，再 `docker compose up -d --no-build`。 |
| 容器反复重启 | `docker compose logs` 查看 Nginx 报错。 |
| 公网地址打不开 | 先用第 5 步确认本机可访问，再看 `journalctl -u pagesail-ngrok`，并运行 `ngrok config check ...`。 |
| 首次添加中文文字较慢 | 浏览器需要下载约 10.6 MB 的中文字体（已 gzip 压缩到约 6.3 MB），之后会被缓存。 |

## 11. 尚未在真实树莓派上验证的部分

本仓库在 x86_64 Linux 上完成了构建和测试，以下内容**尚未**在真实树莓派 5 上验证：

- arm64 镜像的实际运行：已在 x86_64 上交叉构建出 `linux/arm64` 镜像，其中的网页文件和 Nginx 配置与通过全部浏览器测试的 amd64 镜像逐字节一致，但没有在 ARM 硬件或模拟器上运行过。
- 在树莓派上执行 `docker compose up -d --build` 的实际耗时和内存占用。
- 使用真实 authtoken 的 ngrok 连接和 systemd 服务（配置文件已用 ngrok 3.39 的 `ngrok config check` 校验通过）。
- SSD 挂载、Docker `data-root` 迁移等系统操作。

完成部署后，建议按第 5、7 步逐项检查，有问题欢迎提交 Issue。
