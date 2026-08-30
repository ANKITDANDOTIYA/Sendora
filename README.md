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
- **Timezone-Aware Delivery Windows**: Gate email dispatches to recipient or campaign timeframes (`MORNING`, `EVENING`, `NIGHT`, `MIDNIGHT`) with automatic timezone calculation.

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
> Sendora is designed for cloud (Vercel + Render + Neon) and self-hosted deployments.

![Sendora App Interface](intro.png)

---

## 🏗️ Architecture

Sendora is built as a high-performance monorepo using **pnpm workspaces** and **Turborepo**. The frontend communicates with the backend API service and job processing queues to handle asynchronous email sending reliably.

```mermaid
flowchart TD
    subgraph Client Layer
        A[Next.js 14 Frontend\nApp Router + SWR + Tailwind\nDeployed on Vercel]
    end

    subgraph API & Microservices Layer
        B[Hono API Server\nApps/sendora-backend\nDeployed on Render]
        C[LangGraph AI Service\nApps/agents - Python]
    end

    subgraph Data & Queue Layer
        D[(PostgreSQL Database\nNeon Serverless / Prisma ORM 7)]
        E[(Redis Cache & Queue\nRender Redis / Upstash / BullMQ)]
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

## 🚀 Production Deployment Guide

Sendora is designed for seamless production deployment using the following architecture:

- **Frontend**: Vercel (Next.js 14 App Router)
- **Backend API**: Render (Node.js Hono Web Service)
- **Database**: Neon (PostgreSQL Database)
- **Job Queue**: Render Redis or Upstash Redis (BullMQ Engine)
- **Email Delivery**: SMTP (Gmail App Passwords, Custom SMTP, SES, etc.)

---

### 1. Database Setup — Neon PostgreSQL

1. Create a new database project on [Neon.tech](https://neon.tech).
2. Copy your PostgreSQL connection string (`DATABASE_URL`) from the Neon dashboard. Ensure `?sslmode=require` is appended to the connection string.
3. Run schema migrations from your local workspace to initialize the production database tables:
   ```bash
   pnpm --filter @sendora/database exec prisma migrate deploy
   ```

---

### 2. Backend Deployment — Render

1. Create a **New Web Service** on [Render](https://render.com) connected to your GitHub repository.
2. Configure the Render Web Service settings:
   - **Root Directory**: `apps/sendora-backend`
   - **Environment**: `Node`
   - **Build Command**: `pnpm --filter @sendora/database build && pnpm --filter sendora-backend build`
   - **Start Command**: `node dist/index.js`
3. Add the required Environment Variables in Render:
   - `DATABASE_URL`: Your Neon PostgreSQL connection string.
   - `PORT`: Automatically assigned by Render (or default `8100`).
   - `REDIS_URL`: Connection URL of your Render Redis or Upstash Redis instance (e.g. `rediss://default:password@host:6379`).
   - `FRONTEND_URL`: Your Vercel frontend URL (e.g. `https://your-app.vercel.app`).
   - `BACKEND_URL`: Your Render backend Web Service URL (e.g. `https://your-backend.onrender.com`).

---

### 3. Frontend Deployment — Vercel

1. Create a **New Project** on [Vercel](https://vercel.com) connected to your GitHub repository.
2. Select `apps/sendora-frontend` as the **Root Directory**.
3. Vercel automatically detects Next.js. Use default settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/sendora-frontend`
   - **Build Command**: `pnpm --filter @sendora/database build && next build`
4. Add the required Environment Variables in Vercel:
   - `DATABASE_URL`: Your Neon PostgreSQL connection string.
   - `BACKEND_URL`: Your Render backend URL (`https://your-backend.onrender.com`).
   - `JWT_SECRET`: Secret key for JWT verification.
   - `API_KEY`: Internal API key.
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID.
   - `GOOGLE_CLIENT_ID`: Same Google OAuth 2.0 Client ID.
   - `SMTP_USER`: Default system SMTP sender address.
   - `SMTP_PASS`: Default system SMTP password.
   - `SUPPORT_NOTIFY_EMAILS`: Email address to receive support notifications (`ankit.dandotiya.05@gmail.com`).

---

### 4. Campaign Scheduler & Worker Compatibility

- Campaign email dispatches and follow-up sequences are managed by **BullMQ queues** running inside the Render backend process.
- The `campaignQueue` schedules hourly campaign checks (`0 * * * *`). It calculates timezone delivery windows (`MORNING`, `EVENING`, `NIGHT`, `MIDNIGHT`), active days, stage delays (`delayDays`), and enqueues lead email batches.
- **24/7 Cloud Execution**: Because the worker runs as part of the Render Web Service process connected to Redis, campaigns process automatically 24/7 in the cloud without requiring local machine execution.

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

## 🚀 Local Development Setup

### Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: `>= 18.0.0`
- **pnpm**: `>= 9.0.0`
- **PostgreSQL**: Local database instance or cloud database (e.g., [Neon](https://neon.tech))
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

Run the setup script to copy `.env.example` templates to `.env`:

```bash
bash scripts/setup.sh
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

---

## 🔐 Environment Variables

### Backend Configuration (`apps/sendora-backend/.env`)

```env
PORT=8100
BACKEND_URL=http://localhost:8100
FRONTEND_URL=http://localhost:3000
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_URL="postgresql://user:password@localhost:5432/sendora?sslmode=require"
```

### Frontend Configuration (`apps/sendora-frontend/.env`)

```env
JWT_SECRET=your_jwt_secret_key_here
API_KEY=your_internal_api_key
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
DATABASE_URL="postgresql://user:password@localhost:5432/sendora?sslmode=require"
OPENAI_API_KEY=your_openai_api_key
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
SUPPORT_NOTIFY_EMAILS=ankit.dandotiya.05@gmail.com
BACKEND_URL=http://localhost:8100
AGENT_URL=http://localhost:8000
```

---

## 🐳 Docker Deployment

To run Sendora via Docker Compose:

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
