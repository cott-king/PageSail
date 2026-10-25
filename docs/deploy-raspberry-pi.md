# Deploying PageSail on a Raspberry Pi 5 (Docker + Nginx + ngrok)

**English** · [简体中文](deploy-raspberry-pi.zh-CN.md)

This guide deploys PageSail on a Raspberry Pi 5: Nginx (in Docker) serves the static
site, and ngrok on the host makes it reachable from the internet. All file processing
happens in the visitor's browser; the Pi only serves web files and never receives uploads.

> All paths, user names and domains below are **examples** — replace them with your own:
> SSD mount point `/mnt/ssd`, Linux user `<USER>`, ngrok domain `<your-domain>.ngrok-free.app`.

## 0. Prerequisites

| Item | Requirement |
| --- | --- |
| Hardware | Raspberry Pi 5 (8 GB RAM), external SSD (1 TB in this example) |
| OS | **Raspberry Pi OS 64-bit (ARM64 / aarch64)**, based on Debian 12 Bookworm or newer |
| Network | Access to GitHub, Docker Hub, the npm registry and ngrok |
| Account | An ngrok account and authtoken (the free plan works; see ngrok's current plan limits) |

Check that the OS is 64-bit:

```sh
uname -m          # aarch64
getconf LONG_BIT  # 64
grep -E 'PRETTY_NAME|VERSION_CODENAME' /etc/os-release
```

32-bit Raspberry Pi OS (`armv7l`) is out of scope.

## 1. Prepare the external SSD

1. Identify the disk (double-check the device — **do not format the wrong disk**):

   ```sh
   lsblk -o NAME,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINT
   ```

2. Only if the disk is **new or may be erased** (this deletes everything on it), format it, e.g. `/dev/sda1`:

   ```sh
   sudo mkfs.ext4 -L pagesail-ssd /dev/sda1
   ```

3. Mount it by UUID at boot:

   ```sh
   sudo mkdir -p /mnt/ssd
   sudo blkid /dev/sda1                 # note UUID="..."
   sudoedit /etc/fstab
   # add one line (replace the UUID):
   # UUID=<your-uuid>  /mnt/ssd  ext4  defaults,noatime,nofail,x-systemd.device-timeout=30s  0  2
   sudo systemctl daemon-reload
   sudo mount -a
   findmnt /mnt/ssd
   sudo mkdir -p /mnt/ssd/pagesail /mnt/ssd/docker
   sudo chown "$USER":"$USER" /mnt/ssd/pagesail
   ```

`nofail` keeps the Pi from hanging at boot if the SSD is not connected.

## 2. Install Docker and keep its data on the SSD

Raspberry Pi OS 64-bit uses Docker's official Debian repository:

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
sudo usermod -aG docker "$USER"      # log out and back in afterwards
```

Store images, build cache and containers on the SSD (`data-root`):

```sh
sudo systemctl stop docker docker.socket
# If Docker was used before, copy existing data first (skip on a fresh install):
# sudo rsync -aHAX /var/lib/docker/ /mnt/ssd/docker/
echo '{ "data-root": "/mnt/ssd/docker" }' | sudo tee /etc/docker/daemon.json
# Make Docker wait for the SSD mount:
sudo mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=/mnt/ssd\n' | sudo tee /etc/systemd/system/docker.service.d/ssd.conf
sudo systemctl daemon-reload
sudo systemctl enable --now docker
docker info --format '{{.DockerRootDir}}'   # /mnt/ssd/docker
docker compose version
```

## 3. Get the source code (on the SSD)

```sh
cd /mnt/ssd/pagesail
git clone https://github.com/cott-king/PageSail.git .
cp .env.example .env    # optional: port and resource limits; .env is git-ignored
```

## 4. Build and start on the Pi

```sh
cd /mnt/ssd/pagesail
docker compose up -d --build
docker compose ps        # STATUS should become "healthy"
```

- The first build pulls the arm64 variants of `node:24-bookworm-slim` and
  `nginxinc/nginx-unprivileged:1.30-alpine`, then runs `npm ci`, the type check, the Vite
  build and gzip pre-compression inside the build container. Expect several minutes.
- Build uses Node.js 24 LTS; the runtime image only contains Nginx and the static files.
  It runs as a non-root user with a read-only root filesystem and no Linux capabilities.
- The service is published on `127.0.0.1:8080` only. Other devices on the LAN cannot reach
  it directly; ngrok on the host exposes it.

## 5. Verify the production site locally

```sh
curl -fsS http://127.0.0.1:8080/healthz                                    # ok
curl -sI http://127.0.0.1:8080/ | grep -iE 'HTTP/|content-security-policy|cache-control'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8080/pdf-pages   # 200 text/html (deep link)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8080/                   # 405 (no uploads)
curl -s http://127.0.0.1:8080/licenses/THIRD_PARTY_NOTICES.txt | head -5
```

Open it in a browser on the Pi (`http://127.0.0.1:8080`) or from another computer through
an SSH tunnel:

```sh
ssh -L 8080:127.0.0.1:8080 <USER>@<pi-address>   # then open http://127.0.0.1:8080
```

Optionally run the full browser test suite from a development machine through that tunnel:

```sh
PAGESAIL_BASE_URL=http://127.0.0.1:8080 PAGESAIL_EXPECT_HEADERS=1 npm run test:e2e
```

## 6. Install ngrok for ARM64

ngrok's apt repository ships arm64 packages (it currently uses the suite name `bookworm`;
use the same line on newer Debian 13 based systems):

```sh
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc > /dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update
sudo apt install -y ngrok
ngrok version
command -v ngrok          # usually /usr/local/bin/ngrok
```

Save your authtoken (from the ngrok dashboard) without leaving it in your shell history:

```sh
read -rs NGROK_TOKEN      # paste, then Enter (input is hidden)
ngrok config add-authtoken "$NGROK_TOKEN" && unset NGROK_TOKEN
chmod 600 ~/.config/ngrok/ngrok.yml
```

The token lives only in `~/.config/ngrok/ngrok.yml` on the host. **Never** put it into
this repository, `.env`, front-end code or any example file.

## 7. Point ngrok at the local production service

Quick manual test (Ctrl+C to stop):

```sh
ngrok http 127.0.0.1:8080                                             # random public URL
ngrok http 127.0.0.1:8080 --url https://<your-domain>.ngrok-free.app  # your static domain
```

Open the printed HTTPS address on a phone (mobile data) to confirm PageSail loads.

### Start automatically (systemd)

`deploy/ngrok/pagesail-endpoint.example.yml` defines the endpoint only — **no
credentials** — and is merged with your private `~/.config/ngrok/ngrok.yml` at runtime:

```sh
cd /mnt/ssd/pagesail
sudo mkdir -p /etc/pagesail
sudo cp deploy/ngrok/pagesail-endpoint.example.yml /etc/pagesail/ngrok-endpoint.yml
sudoedit /etc/pagesail/ngrok-endpoint.yml      # set your domain, or delete the url line for a random URL
ngrok config check --config ~/.config/ngrok/ngrok.yml --config /etc/pagesail/ngrok-endpoint.yml

sed "s/<USER>/$USER/g" deploy/systemd/pagesail-ngrok.service | sudo tee /etc/systemd/system/pagesail-ngrok.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now pagesail-ngrok
systemctl status pagesail-ngrok
journalctl -u pagesail-ngrok -f       # the public URL appears in the log
```

Alternatively use ngrok's own `ngrok service install --config <file>` — use one or the other.

Notes on ngrok:

- The free plan may have traffic/connection limits and may show visitors an ngrok notice
  page; check ngrok's current plan description.
- ngrok sees requests passing through the tunnel (resource paths, visitor IPs), but since
  PageSail never uploads files it cannot see anyone's documents.
- To restrict access to specific people, configure access control in ngrok (e.g. basic
  auth or OAuth via its Traffic Policy). PageSail needs no changes for that.

## 8. Operations

| Task | Command |
| --- | --- |
| Status | `docker compose ps`, `systemctl status pagesail-ngrok` |
| Web server logs | `docker compose logs -f --tail=100` (no IPs or user agents are logged) |
| ngrok logs | `journalctl -u pagesail-ngrok -f` |
| Restart web server | `docker compose restart` |
| Restart ngrok | `sudo systemctl restart pagesail-ngrok` |
| Take the site offline | `sudo systemctl stop pagesail-ngrok` |
| Stop the web server | `docker compose down` |
| Update | `git pull --ff-only && docker compose up -d --build && docker image prune -f` |
| Change limits or port | edit `.env`, then `docker compose up -d --build` |

After a reboot everything comes back automatically: Docker is enabled, the container uses
`restart: unless-stopped`, and the ngrok service is enabled. Docker rotates the container
log (10 MB × 3 files).

If port 8080 is taken, set `PAGESAIL_PORT=8090` in `.env` and use the same port in
`upstream.url` in `/etc/pagesail/ngrok-endpoint.yml`.

## 9. Developing on the Pi (optional)

The Docker deployment does not need Node.js on the host. To run the dev server or tests on
the Pi, install Node.js 24 LTS (e.g. via nvm) and keep the npm cache on the SSD:

```sh
npm config set cache /mnt/ssd/npm-cache
cd /mnt/ssd/pagesail && npm ci
npm run dev           # development only — do not expose through ngrok
npm test
```

`npm ci` may try to compile an optional, test-only native module (node-canvas); if that
fails npm skips it and nothing else is affected. Browser tests need
`npx playwright install chromium`.

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `exec format error` | Wrong image architecture. Rebuild on the Pi: `docker compose up -d --build`. |
| `429 Too Many Requests` when pulling | Docker Hub's anonymous rate limit; retry later or `docker login`. |
| `SELF_SIGNED_CERT_IN_CHAIN` during the build | A TLS-inspecting proxy. Pass its CA as a build secret: `docker build --secret id=extra_ca,src=/path/ca.pem -t pagesail:local .`, then `docker compose up -d --no-build`. |
| Container keeps restarting | `docker compose logs` shows the Nginx error. |
| Public URL does not load | Check step 5 locally first, then `journalctl -u pagesail-ngrok` and `ngrok config check …`. |
| Adding Chinese text is slow the first time | The browser downloads the 10.6 MB Noto Sans SC font (about 6.3 MB gzipped) once, then caches it. |

## 11. Not yet verified on real Raspberry Pi hardware

PageSail was built and tested on x86_64 Linux. The following has **not** been verified on
an actual Raspberry Pi 5:

- Running the arm64 image. A `linux/arm64` image was cross-built; its web files and Nginx
  configuration are byte-for-byte identical to the amd64 image that passed the full browser
  test suite, but it was not executed on ARM hardware or under emulation.
- Build time and memory use of `docker compose up -d --build` on the Pi.
- A live ngrok connection with a real authtoken and the systemd unit (the configuration
  files were validated with `ngrok config check` of ngrok 3.39).
- The SSD mount and Docker `data-root` steps.

After deploying, please go through steps 5 and 7; issues and reports are welcome.
