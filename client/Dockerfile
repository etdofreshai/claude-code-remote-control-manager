# Client agent runtime image.
#
# Outbound only — connects to SERVER_URL, polls for commands, and runs
# Claude Code sessions locally with remote control enabled. No exposed
# ports. Runs as the non-root `node` user (uid 1000); /home/node is
# mounted from the shared `ai-sessions-date` volume so Claude auth state
# (~/.claude) and our session-tracking JSON (~/.claude-remote) persist.

FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        # base + auth
        ca-certificates curl git sudo gnupg \
        # tier 1 — small universal CLI tools
        jq ripgrep file patch unzip zip tar xz-utils tree bc procps less dnsutils \
        # tier 2 — build toolchain (so pip/cargo native compiles work)
        build-essential cmake ninja-build pkg-config libssl-dev zlib1g-dev \
        # clang/llvm
        clang lld \
        # tier 3 — python
        python3 python3-pip python3-venv pipx \
        # media
        ffmpeg imagemagick \
        # SDL3 build deps (audio, x11, wayland, drm/gl, dbus, udev)
        libasound2-dev libpulse-dev \
        libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxi-dev libxss-dev libxfixes-dev libxkbcommon-dev \
        libwayland-dev wayland-protocols \
        libdrm-dev libgbm-dev libgl1-mesa-dev libegl1-mesa-dev \
        libdbus-1-dev libudev-dev \
    # gh (GitHub CLI) via official apt repo
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* \
    # OpenAI Codex CLI + Google Gemini CLI (npm globals)
    && npm install -g @openai/codex @google/gemini-cli \
    # passwordless sudo for the `node` user so agent commands can apt/install
    && echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

# SDL3 from source. Debian bookworm only ships SDL2; SDL3 is tagged
# upstream. Bumping the version: change SDL_VERSION below.
ARG SDL_VERSION=3.2.20
RUN set -eux \
    && cd /tmp \
    && curl -fsSL "https://github.com/libsdl-org/SDL/releases/download/release-${SDL_VERSION}/SDL3-${SDL_VERSION}.tar.gz" \
        -o sdl3.tar.gz \
    && tar xzf sdl3.tar.gz \
    && cmake -S "SDL3-${SDL_VERSION}" -B SDL3-build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DSDL_SHARED=ON -DSDL_STATIC=ON \
        -DSDL_TESTS=OFF -DSDL_EXAMPLES=OFF \
    && cmake --build SDL3-build --parallel \
    && cmake --install SDL3-build \
    && ldconfig \
    && rm -rf /tmp/sdl3.tar.gz /tmp/SDL3-${SDL_VERSION} /tmp/SDL3-build \
    && pkg-config --modversion sdl3

RUN set -eux \
    && CC_VERSION=$(curl -fsSL https://downloads.claude.ai/claude-code-releases/latest) \
    && curl -fsSL "https://downloads.claude.ai/claude-code-releases/$CC_VERSION/linux-x64/claude" \
        -o /usr/local/bin/claude \
    && chmod +x /usr/local/bin/claude \
    && /usr/local/bin/claude --version

WORKDIR /app
RUN chown node:node /app

USER node

COPY --chown=node:node client/package.json client/package-lock.json* ./
RUN npm install

COPY --chown=node:node client/tsconfig.json ./
COPY --chown=node:node client/src ./src
RUN npm run build

ENV CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude

CMD ["node", "dist/index.js"]
