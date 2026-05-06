# Client agent runtime image.
#
# Bundles Node + the Claude Code native binary so the agent can drive
# Claude Code locally. Runs as the non-root `node` user (uid 1000) with
# $HOME=/home/node. In deployment, /home/node is mounted from the shared
# `ai-sessions-date` volume so Claude auth state ($HOME/.claude) and
# workspace files persist alongside the rest of the AI sessions stack.

FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code's native binary system-wide so it survives the
# /home/node bind-mount that shadows $HOME at runtime.
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
ENV PORT=4000
EXPOSE 4000

CMD ["node", "dist/index.js"]
