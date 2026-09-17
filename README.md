# 🎮 Gaming Cafe Management System

A modern, full-stack management platform for gaming cafes and esports lounges. Easily manage gaming stations, track customer play sessions, handle kitchen food & beverage orders, and calculate billing with instant UPI and cash checkout.

---

## ⚡ Features

- 🖥️ **Station Management**: Real-time status of all gaming PCs and consoles (Available, Occupied, Reserved, Maintenance).
- ⏱️ **Live Session Tracking**: Accurate, per-minute billing with grace periods and automatic elapsed time calculation.
- 🍔 **Kitchen & Snack Orders (Kanban)**: Customers can order food and drinks directly from their desk; staff track preparation in real-time.
- 💳 **Seamless Billing**: Consolidated checkout combining station play time and kitchen orders with instant UPI QR code & cash options.
- 🔄 **Real-Time Sync**: Instant updates across admin dashboard and customer screens powered by WebSockets.
- 🛡️ **Desk-Scoped Access**: Secure, token-based desk access for customers without exposing administrative controls.

---

## 🚀 Quick Start (Docker Compose)

The easiest way to run the entire system (Database, Backend, and Frontend) is using Docker:

### 1. Configure Environment
Copy the sample environment file:
```bash
cp .env.example .env
```
*(On Windows PowerShell: `Copy-Item .env.example .env`)*

### 2. Launch the Application
```bash
docker-compose up --build
```

### 3. Open in Browser
- **Frontend App**: [http://localhost](http://localhost)
- **Backend API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **API Base URL**: [http://localhost:8000/api/v1](http://localhost:8000/api/v1)

---

## 🛠️ Local Development Setup

If you prefer to run the backend and frontend locally on your machine without Docker containers:

### Prerequisites
- **Node.js** 18+ and **npm**
- **Python** 3.12+
- **PostgreSQL** 16+ running locally (e.g. at `localhost:5432`)

---

### Step 1: Database Setup
Ensure PostgreSQL is running and create the database:
```sql
CREATE DATABASE gaming_cafe_db;
```

---

### Step 2: Backend Setup

1. **Navigate to the backend directory**:
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment**:
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

4. **Set up the `.env` file**:
   ```bash
   # Copy sample config if not already present
   cp .env.example .env
   ```
   *Make sure `DATABASE_URL` matches your local PostgreSQL credentials.*

5. **Run database migrations**:
   ```bash
   alembic upgrade head
   ```

6. **Start the backend server**:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   API will be live at `http://localhost:8000`.

7. *(Optional)* **Run automated tests**:
   ```bash
   pytest tests/ -v
   ```

---

### Step 3: Frontend Setup

1. **Navigate to the frontend directory** (in a new terminal):
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
   Frontend will be live at `http://localhost:5173`. Requests to `/api` and `/ws` are automatically proxied to `http://localhost:8000`.

---

## ⚙️ Environment Variables

All primary configuration is managed in `.env` (or `.env.example`):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `POSTGRES_USER` | Database username | `cafe_admin` |
| `POSTGRES_PASSWORD` | Database password | `cyber_secret_2026` |
| `POSTGRES_DB` | Database name | `gaming_cafe_db` |
| `DATABASE_URL` | SQLAlchemy async connection string | `postgresql+asyncpg://...` |
| `JWT_SECRET` | Secret key for signing session tokens | `enterprise_gaming_cafe_...` |
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
│   ├── tests/            # Pytest test suites
│   ├── requirements.txt  # Python package dependencies
│   └── Dockerfile        # Backend container image
├── frontend/
│   ├── src/
│   │   ├── components/   # StationGrid, CustomerHUD, KitchenKanban
│   │   ├── hooks/        # WebSocket and state management hooks
│   │   ├── App.tsx       # Main dashboard layout & navigation
│   │   └── api.ts        # API client helpers
│   ├── package.json      # Frontend npm dependencies & scripts
│   └── Dockerfile        # Nginx + Vite frontend container
├── docker-compose.yml    # Full cluster orchestration
├── .env.example          # Template for environment settings
├── .gitignore            # Git exclusion rules
└── README.md             # Project documentation
```

---

## 🧰 Tech Stack

- **Backend**: FastAPI, Python 3.12+, SQLAlchemy 2.0 (Async), PostgreSQL, Alembic, WebSockets.
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, TanStack Query, Zustand.
- **DevOps**: Docker, Docker Compose, Nginx.
