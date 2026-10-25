# syntax=docker/dockerfile:1
#
# PageSail production image: build the static site with Node.js, serve it with an
# unprivileged Nginx. Both base images are multi-arch and include linux/arm64
# (Raspberry Pi OS 64-bit). The build stage runs on the build machine's own platform,
# because its output (HTML/JS/CSS/fonts) is platform-independent.

ARG NODE_IMAGE=node:24-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30-alpine

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
ENV CI=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false

COPY package.json package-lock.json ./
# --ignore-scripts: skips native add-ons that only the test suite would use
# (e.g. node-canvas pulled in optionally by Fabric). The browser build needs none.
# Optional: behind a TLS-inspecting proxy, pass its CA bundle as a build secret:
#   docker build --secret id=extra_ca,src=/path/to/ca.pem .
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --ignore-scripts

COPY . .

# Optional build-time settings (see README → "Resource limits").
ARG VITE_REPO_URL
ARG VITE_MAX_PDF_MB
ARG VITE_MAX_IMAGE_MB
ARG VITE_MAX_IMAGE_MEGAPIXELS
ARG VITE_MAX_RENDER_MEGAPIXELS
ARG VITE_MAX_FILES
ARG VITE_HISTORY_STEPS
ENV VITE_REPO_URL=${VITE_REPO_URL} \
    VITE_MAX_PDF_MB=${VITE_MAX_PDF_MB} \
    VITE_MAX_IMAGE_MB=${VITE_MAX_IMAGE_MB} \
    VITE_MAX_IMAGE_MEGAPIXELS=${VITE_MAX_IMAGE_MEGAPIXELS} \
    VITE_MAX_RENDER_MEGAPIXELS=${VITE_MAX_RENDER_MEGAPIXELS} \
    VITE_MAX_FILES=${VITE_MAX_FILES} \
    VITE_HISTORY_STEPS=${VITE_HISTORY_STEPS}

RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
LABEL org.opencontainers.image.title="PageSail" \
      org.opencontainers.image.description="Open-source PDF and image tools that run in the browser" \
      org.opencontainers.image.licenses="MIT"

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
