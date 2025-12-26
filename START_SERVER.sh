#!/bin/bash
# Quick start script for MapperLab.co

echo "🚀 Starting MapperLab.co Server..."
echo ""
echo "📋 Prerequisites:"
echo "  ✅ Node.js installed"
echo "  ✅ Dependencies installed (npm install)"
echo "  ✅ API keys configured (see API_KEYS_SETUP.md)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules not found. Installing dependencies..."
    npm install
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Please create it with your API keys."
    echo "   See API_KEYS_SETUP.md for instructions."
    exit 1
fi

echo "✅ Starting server..."
echo "📍 Server will be available at: http://localhost:3000"
echo "📊 The system will automatically fetch and analyze data"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm start
