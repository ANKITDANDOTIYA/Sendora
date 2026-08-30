# Sendora

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-black?logo=node.js)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-black?logo=pnpm)](https://pnpm.io/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![Hono](https://img.shields.io/badge/Hono-API-black?logo=hono)](https://hono.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-7-black?logo=prisma)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-BullMQ-black?logo=redis)](https://redis.io/)

**Sendora** is an open-source, full-stack cold email outreach and campaign automation platform designed for high-deliverability sales execution. It combines dynamic multi-stage pitch sequencing, automated follow-ups, real-time open and bounce tracking, timezone-gated sending windows, and an integrated CRM pipeline to streamline cold outreach.

![Sendora Showcase](intro.png)

---

## ✨ Features

### 📧 Email Campaign & Pitch Engine

- **Multi-Stage Sequences**: Build automated email campaigns with customized multi-stage follow-up delays.
- **Spintax Variation Support**: Write dynamic email content with syntax like `{Hello|Hi|Hey}` to generate unique email variations and maximize deliverability.
- **Personalization Engine**: Templating using Hogan.js for recipient custom fields (`{{name}}`, `{{company}}`, `{{role}}`).
- **Timezone-Aware Delivery Windows**: Gate email dispatches to recipient or campaign timeframes (e.g., `MORNING`, `EVENING`, `NIGHT`, `MIDNIGHT`) with automatic timezone calculation.

### 📬 Sending Account & Deliverability Management

- **Multi-SMTP / IMAP Integration**: Connect multiple email accounts (Gmail App Passwords, Custom SMTP/IMAP, SendGrid, Amazon SES).
- **Daily Sending Limits**: Set per-credential daily email caps to protect domain reputation.
- **Credential Rotation**: Automatically rotate active email credentials during campaign dispatches.
- **In-Process IMAP Listener**: Continuous background monitoring of incoming replies and automated bounce parsing via `email-bounce-parser`.

### 📊 Analytics, Tracking & CRM Pipeline

- **Real-Time Email Tracking**: Embedded 1x1 tracking pixel for email open detection and status lifecycle tracking (`PENDING`, `QUEUED`, `SENT`, `REPLIED`, `FAILED`, `BOUNCED`).
- **Visual CRM Kanban Board**: Drag-and-drop lead management pipeline with customizable stage workflows.
- **Lead List Management**: Organize prospects into targeted lists with CSV import and export capabilities.

### 🤖 AI Assistance & Onboarding

- **AI Chat Assistant**: Integrated outreach helper powered by LangGraph AI agent service for drafting pitches and refining sequences.
- **Interactive Onboarding Tour**: Guided product onboarding powered by React Joyride to walk new users through key features step-by-step.

### 🔐 Authentication & Security

- **Authentication**: JWT-based authentication with support for standard email/password credentials and Google OAuth 2.0 single sign-on.

---

## 🖥️ Screenshots / Demo

> [!NOTE]  
> Sendora is currently configured for self-hosted and local deployments. A public cloud demo instance will be coming soon.

![Sendora App Interface](intro.png)

---

## 🏗️ Architecture

Sendora is built as a high-performance monorepo using **pnpm workspaces** and **Turborepo**. The frontend communicates with the backend API service and job processing queues to handle asynchronous email sending reliably.

```mermaid
flowchart TD
    subgraph Client Layer
        A[Next.js 14 Frontend\nApp Router + SWR + Tailwind]
    end

    subgraph API & Microservices Layer
        B[Hono API Server\nApps/sendora-backend]
        C[LangGraph AI Service\nApps/agents - Python]
    end

    subgraph Data & Queue Layer
        D[(PostgreSQL Database\nPrisma ORM 7)]
        E[(Redis Cache & Queue\nBullMQ Engine)]
    end

    subgraph Mail Execution & Delivery
        F[ImapFlow & Email Bounce Listener]
        G[Nodemailer SMTP Transporter]
        H[Target Recipient Inbox]
    end

    A -->|REST API / Auth| B
    A -->|AI Agent Queries| C
    B -->|Query / Store State| D
    B -->|Enqueue Jobs| E
    E -->|Process Batches| G
    G -->|Send Emails| H
    H -->|Replies / Bounces| F
    F -->|Update Status| D
```

---

## 🛠️ Tech Stack

| Layer                       | Technology                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| **Frontend**                | Next.js 14 (App Router), React 18, Tailwind CSS, Framer Motion, SWR, Zustand, React Joyride v3 |
| **Backend API**             | Hono, Node.js (ESM), TypeScript                                                                |
| **Queue & Background Jobs** | BullMQ, ioredis                                                                                |
| **AI Agents**               | Python 3.11+, LangGraph, LangChain, FastAPI, Uvicorn                                           |
| **Database & ORM**          | PostgreSQL (Neon / Supabase / Local), Prisma ORM 7                                             |
| **Email & Transport**       | Nodemailer, ImapFlow, EmailBounceParser, Hogan.js, html-to-text                                |
| **Authentication**          | JWT (jsonwebtoken), Google OAuth 2.0, bcryptjs                                                 |
| **Monorepo & Tooling**      | Turborepo, pnpm Workspaces, Prettier, ESLint                                                   |
| **Infrastructure**          | Docker Compose, Docker, Redis                                                                  |

---

## 📁 Project Structure

```
sendora/
├── apps/
│   ├── sendora-frontend/     # Next.js 14 Web Application (Port 3000)
│   │   ├── app/              # App router pages, auth, and API proxies
│   │   ├── components/       # UI components, CRM board, Joyride tour, sidebar, navbar
│   │   ├── store/            # Zustand state management
│   │   └── lib/              # Prisma client and frontend utilities
│   │
│   ├── sendora-backend/      # High-performance Hono API Server (Port 8100)
│   │   ├── src/services/     # Email dispatch, IMAP listener, campaign worker, Redis
│   │   ├── src/routes/       # Hono API routes for emails, campaigns, credentials
│   │   └── src/__tests__/    # Vitest unit and end-to-end pipeline test suites
│   │
│   └── agents/               # Python AI Agent Service (Port 8000)
│       └── src/              # LangGraph workflows and FastAPI endpoints
│
├── packages/
│   ├── database/             # Prisma schema, migrations, and @sendora/database client
│   ├── eslint-config/        # Shared ESLint configurations
│   ├── typescript-config/    # Shared TypeScript configurations
│   └── ui/                   # Shared UI primitives
│
├── scripts/
│   └── setup.sh              # Automated environment setup and migration script
│
├── docker-compose.yml        # Docker Compose configuration for local/container deployment
├── pnpm-workspace.yaml       # Monorepo workspace configuration
└── turbo.json                # Turborepo pipeline configuration
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: `>= 18.0.0`
- **pnpm**: `>= 9.0.0`
- **PostgreSQL**: Local database instance or cloud database (e.g., [Neon](https://neon.tech), [Supabase](https://supabase.com))
- **Redis**: Local server or Docker container

---

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/ANKITDANDOTIYA/Sendora.git
cd Sendora
pnpm install
```

---

### 2. Configure Environment Files

You can use the provided setup script to automatically copy `.env.example` templates to `.env`:

```bash
bash scripts/setup.sh
```

Alternatively, copy the environment files manually:

```bash
cp apps/sendora-backend/.env.example apps/sendora-backend/.env
cp apps/sendora-frontend/.env.example apps/sendora-frontend/.env
```

---

### 3. Database Setup & Migrations

Generate the Prisma client and run database migrations:

```bash
pnpm --filter @sendora/database db:generate
pnpm --filter @sendora/database db:migrate
```

---

### 4. Start Development Servers

Make sure Redis is running on port `6379`, then start the monorepo:

```bash
pnpm dev
```

This starts:

- **Frontend App**: `http://localhost:3000`
- **Backend API**: `http://localhost:8100`

To run applications individually:

```bash
pnpm --filter sendora-frontend dev   # Frontend only
pnpm --filter sendora-backend dev    # Backend only
```

---

## 🔐 Environment Variables

### Backend Configuration (`apps/sendora-backend/.env`)

```env
# Server Port
PORT=8100

# Redis Configuration (BullMQ queues)
REDIS_HOST=localhost
REDIS_PORT=6379

# PostgreSQL Database Connection
DATABASE_URL="postgresql://user:password@localhost:5432/sendora?sslmode=require"
```

### Frontend Configuration (`apps/sendora-frontend/.env`)

```env
# Authentication & Security
JWT_SECRET=your_jwt_secret_key_here
API_KEY=your_internal_api_key

# Google OAuth 2.0
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# PostgreSQL Database Connection
DATABASE_URL="postgresql://user:password@localhost:5432/sendora?sslmode=require"

# OpenAI API Key (AI features)
OPENAI_API_KEY=your_openai_api_key

# Default System SMTP Credentials
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
SUPPORT_NOTIFY_EMAILS=ankit.dandotiya.05@gmail.com

# Service Endpoints
BACKEND_URL=http://localhost:8100
AGENT_URL=http://localhost:8000
```

---

## 🐳 Docker Deployment

To run Sendora via Docker Compose:

1. Ensure `.env` files exist in both `apps/sendora-backend` and `apps/sendora-frontend`.
2. Launch the services:

```bash
docker compose up --build
```

This containerizes:

- **Redis Container**: Port `6379`
- **Backend API Container**: Port `8100`
- **Frontend Next.js Container**: Port `3000`

---

## 📜 License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
