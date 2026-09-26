# 🎮 Gaming Cafe Management System

A modern, full-stack management platform for gaming cafes and esports lounges. Easily manage gaming stations, track customer play sessions, handle kitchen food & beverage orders, and calculate billing with instant UPI and cash checkout.

---

## ⚡ Features

- 🖥️ **Station Management**: Real-time status of all gaming PCs and consoles (Available, Occupied, Reserved, Maintenance) with a 2D Console Allocation Matrix.
- 📱 **Customer Check-In with Phone & Name**: Front-desk check-in supports customer name and mobile phone number, stored securely in the database (`sessions.customer_phone`) with full indexing.
- 📋 **Customer Logs Directory**: Complete session audit trail and searchable history with real-time filtering by player name, phone number, station, and session status.
- ⏱️ **Live Session Tracking**: Accurate, per-minute billing with grace periods, automatic elapsed time calculation, and quick duration extensions.
- 🍔 **Kitchen & Snack Orders (Kanban)**: Customers can order food and drinks directly from their desk; staff track preparation in real-time with out-of-stock guards.
- 💳 **Seamless Settle & Billing**: Consolidated checkout combining station play time and kitchen orders with itemized breakdown, customer phone metadata, and instant UPI QR code & cash options.
- 🎨 **High-Contrast Cream Design System**: Clean soft cream background (`#FFF7ED`) and crisp `#FFFFFF` panels with high-visibility navy (`#172554`), dark slate (`#0F172A`), and slate-grey (`#64748B`) typography.
- 🔄 **Real-Time Sync**: Instant updates across admin dashboard and customer screens powered by WebSockets.
- 🛡️ **Desk-Scoped Access**: Secure, token-based desk access for customers without exposing administrative controls.
- 🚀 **Cloud & Hosting Ready**: Preconfigured Docker Compose, health check monitors, Nginx caching & security headers, and CORS control.

---

## ⚡ 1-Command Local Development

You can run both the Backend and Frontend concurrently with one command from the project root:

```bash
npm run dev:all
```
*(Alias: `npm run dev`)*

- **Frontend App**: [http://localhost:5173](http://localhost:5173) (Vite Hot-Reload)
- **Backend API**: [http://localhost:8000](http://localhost:8000) (Uvicorn Hot-Reload)
- **Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Check**: [http://localhost:8000/health](http://localhost:8000/health)

> [!TIP]
> `npm run dev:all` automatically detects if PostgreSQL is running. If not, it seamlessly boots a local SQLite dev database so you can start coding and testing with zero setup!

---

## 🚀 Quick Start (Docker Compose)

To launch the full containerized cluster (PostgreSQL 16, Backend, and Nginx Frontend):

### 1. Configure Environment
```bash
cp .env.example .env
```
*(On Windows PowerShell: `Copy-Item .env.example .env`)*

### 2. Launch the Application
```bash
docker compose up --build -d
```

### 3. Open in Browser
- **Frontend App**: [http://localhost](http://localhost) (or port configured in `.env`)
- **Backend API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Check Endpoint**: [http://localhost:8000/health](http://localhost:8000/health)

---

## 🌐 Production Hosting & Deployment

The application is engineered to be deployed anywhere from a single VPS to distributed cloud environments.

### Option A: Single VPS / Dedicated Server (Recommended)
Suitable for DigitalOcean, Hetzner, AWS EC2, Linode, or local in-cafe servers:

1. **Clone the repository on the server**:
   ```bash
   git clone <repo-url> gaming-cafe
   cd gaming-cafe
   ```
2. **Set up `.env` with production credentials**:
   ```bash
   cp .env.example .env
   nano .env
   ```
   > [!IMPORTANT]
   > Ensure you replace `JWT_SECRET`, `ADMIN_PASSWORD`, and `POSTGRES_PASSWORD` with strong, random secrets before running in production.

3. **Deploy using the automated deployment script**:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```
   *This automatically builds optimized Docker images, checks health status, and brings up the full cluster with auto-restart policies and log rotation.*

---

### Option B: Decoupled Cloud Hosting (Vercel / Render / Railway / Supabase)

- **Backend (Render / Railway / Fly.io)**:
  - Connect your repository to the `backend/` directory.
  - Set `DATABASE_URL` pointing to your hosted PostgreSQL instance (e.g. Supabase, Neon, AWS RDS). Note: URLs like `postgres://` are automatically normalized to asyncpg!
  - Provide `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `CORS_ORIGINS`.
- **Frontend (Vercel / Netlify / Cloudflare Pages)**:
  - Root directory: `frontend`
  - Build command: `npm run build`
  - Output directory: `dist`
  - Set environment variables in your hosting dashboard:
    - `VITE_API_BASE_URL`: `https://your-backend-api.onrender.com`
    - `VITE_WS_URL`: `wss://your-backend-api.onrender.com`

---

## 🛠️ Local Development Setup

To run services directly on your host machine for development:

### Prerequisites
- **Node.js** 18+ and **npm**
- **Python** 3.12+
- **PostgreSQL** 16+ running locally (e.g. at `localhost:5432`)

---

### Step 1: Database
Ensure PostgreSQL is running and create the database:
```sql
CREATE DATABASE gaming_cafe_db;
```

---

### Step 2: Backend Setup

1. **Navigate to the backend**:
   ```bash
   cd backend
   ```

2. **Create and activate virtual environment**:
   ```bash
   # Windows
   python -m venv .venv
   .\.venv\Scripts\activate

   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Prepare `.env`**:
   ```bash
   cp .env.example .env
   ```

5. **Run database migrations**:
   ```bash
   alembic upgrade head
   ```

6. **Start the backend server**:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

7. **Run unit tests**:
   ```bash
   pytest tests/ -v
   ```

---

### Step 3: Frontend Setup

1. **Navigate to the frontend**:
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   Frontend will run at `http://localhost:5173`. Requests to `/api` and `/ws` automatically proxy to `http://localhost:8000`.

---

## ⚙️ Environment Variables Reference

All primary configurations are defined in `.env` (derived from `.env.example`):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Public HTTP port for frontend Nginx | `80` |
| `BACKEND_PORT` | Port for FastAPI backend | `8000` |
| `DB_PORT` | Port for PostgreSQL database | `5432` |
| `POSTGRES_USER` | Database username | `cafe_admin` |
| `POSTGRES_PASSWORD` | Database password | `cyber_secret_2026` |
| `POSTGRES_DB` | Database name | `gaming_cafe_db` |
| `DATABASE_URL` | Async connection string (auto-normalized) | `postgresql+asyncpg://...` |
| `JWT_SECRET` | Secret key for signing session tokens | `enterprise_gaming_cafe_...` |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD` | Admin login password | `admin123` |
| `CORS_ORIGINS` | Permitted origins (`*` or comma-delimited) | `*` |
| `UPI_MERCHANT_VPA` | Cafe UPI ID for customer QR payments | `gamingcafe@upi` |
| `UPI_MERCHANT_NAME` | Display name for UPI payment requests | `ApexCyberLounge` |

---

## 📁 Project Structure

```text
gaming-cafe/
├── backend/
│   ├── app/
│   │   ├── api/          # REST API endpoints (admin & customer routes)
│   │   ├── core/         # Config, database connection, JWT security
│   │   ├── models/       # SQLAlchemy database models
│   │   ├── schemas/      # Pydantic request/response schemas
│   │   ├── services/     # Billing engine, session logic & WebSockets
│   │   └── main.py       # FastAPI application entrypoint
│   ├── migrations/       # Alembic database schema migrations
│   ├── tests/            # Automated test suites
│   ├── requirements.txt  # Python package dependencies
│   └── Dockerfile        # Backend production image
├── frontend/
│   ├── src/
│   │   ├── components/   # StationGrid, CustomerHUD, KitchenKanban
│   │   ├── hooks/        # WebSocket and state management hooks
│   │   ├── App.tsx       # Main dashboard layout & navigation
│   │   ├── api.ts        # API client helpers
│   │   └── vite-env.d.ts # TypeScript environment typings
│   ├── package.json      # Frontend npm dependencies & scripts
│   ├── nginx.conf        # Production Nginx reverse proxy & caching config
│   └── Dockerfile        # Multi-stage frontend container
├── docker-compose.yml    # Full cluster orchestration with healthchecks
├── deploy.sh             # One-command Linux / VPS deployment script
├── .env.example          # Environment template with production defaults
├── .gitignore            # Git exclusion rules
├── pytest.ini            # Pytest configuration
└── README.md             # Project documentation
```

---

## 🧰 Tech Stack

- **Backend**: FastAPI, Python 3.12+, SQLAlchemy 2.0 (Async), PostgreSQL, Alembic, WebSockets.
- **Frontend**: React 19, TypeScript 5.5+, Vite, Tailwind CSS v4, Lucide Icons, TanStack Query, Zustand.
- **DevOps & Production**: Docker, Docker Compose, Nginx, Healthchecks, Uvloop.

---

## 📱 Customer Check-In & Logs Workflow

### 1. Front-Desk Check-In
When an administrator checks in a customer at the console matrix or session drawer:
- **Customer Name**: Full name or alias (defaults to "Walk-in Gamer").
- **Phone Number**: Optional 10-digit mobile number, validated and sanitized on entry.
- **Persistence**: Stored directly in the `sessions` database table under `customer_phone` (`VARCHAR(20)`), indexed with `ix_sessions_customer_phone` for high-performance querying.

### 2. Multi-Point Visibility
The customer's phone number is consistently reflected throughout the operations lifecycle:
- **Console Matrix**: Displayed alongside player names on occupied console cards and column allocation pills.
- **Customer Logs**: Highlighted in dedicated phone pill badges with quick search and filter by phone number or name.
- **Settle Invoice Modal**: Rendered in the final bill header before payment settlement and thermal receipt printing.
- **Customer Directory**: Groups historical play time, total spend, and visited stations by customer phone.

---

## 🎨 Design System & Contrast Standards

The application uses an accessible, modern, high-contrast light theme engineered for busy gaming lounge ambient lighting:
- **Background**: Soft warm cream (`#FFF7ED`).
- **Surface Cards**: Pure clean white (`#FFFFFF`) with subtle slate borders (`#E2E8F0`).
- **Primary Typography**: Deep navy (`#172554`) for main headings and titles, ensuring 100% legibility against cream and white surfaces.
- **Body & Player Text**: High-contrast dark slate (`#0F172A`) for names, item descriptions, and table rows.
- **Secondary & Meta**: Slate grey (`#64748B`) for timestamps, badges, and field hints.
- **Brand Accents**: Vibrant gaming amber (`#EA580C`) and forest emerald (`#15803D`) for live statuses and CTAs.

