FROM node:lts-alpine

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./

# Copy package.json files for all workspace packages
COPY apps/sendora-frontend/package.json apps/sendora-frontend/
COPY packages/database/package.json packages/database/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/database/ packages/database/
COPY apps/sendora-frontend/ apps/sendora-frontend/

# Generate Prisma client
RUN pnpm --filter @sendora/database db:generate

# Build Next.js app
WORKDIR /app/apps/sendora-frontend
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]
