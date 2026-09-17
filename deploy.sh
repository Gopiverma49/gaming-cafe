#!/usr/bin/env bash
set -e

echo "============================================="
echo "  Gaming Cafe Management - Deployment Script"
echo "============================================="

# 1. Verify .env file existence
if [ ! -f .env ]; then
  echo "⚠️  .env file not found. Creating from .env.example..."
  cp .env.example .env
  echo "👉 Please edit .env with your production secrets, then re-run deploy.sh."
  exit 1
fi

# 2. Build and start containers
echo "🚀 Building container images..."
docker compose build --pull

echo "🟢 Launching cluster in background..."
docker compose up -d

# 3. Status check
echo "🔍 Checking cluster status..."
docker compose ps

echo "============================================="
echo "✅ Deployment Successful!"
echo "   Frontend:  http://localhost:${PORT:-80}"
echo "   API Docs:  http://localhost:${BACKEND_PORT:-8000}/docs"
echo "   Health:    http://localhost:${BACKEND_PORT:-8000}/health"
echo "============================================="
