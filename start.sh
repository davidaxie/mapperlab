#!/bin/bash
# MapperLab.co Startup Script
# This script ensures you're in the correct directory and starts the server

cd "$(dirname "$0")"

echo "🚀 Starting MapperLab.co..."
echo "📁 Working directory: $(pwd)"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo "   Please create .env file with OPENAI_API_KEY"
fi

# Start the server
echo "✅ Starting server..."
npm start


