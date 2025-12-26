# Quick Start Guide

## 🚀 Get Running in 3 Steps

### 1. Navigate to Project
```bash
cd MapperLab.co
```

### 2. Install Dependencies (if not already done)
```bash
npm install
```

### 3. Start the Server
```bash
npm start
```

The server will:
- Start on http://localhost:3000
- Automatically fetch data from all sources
- Analyze sectors using AI (first run takes 5-10 minutes)
- Display the heatmap once ready

## 📝 First Time Setup

If you haven't set up your `.env` file yet:

1. Copy the example:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your OpenAI API key:
   ```env
   OPENAI_API_KEY=sk-proj-your-key-here
   ```

3. Restart the server:
   ```bash
   npm start
   ```

## 🎯 What to Expect

**First Run:**
- Server starts immediately on port 3000
- Data ingestion begins (fetches RSS feeds, APIs)
- AI analysis starts (this takes time - be patient!)
- Check console logs for progress

**After First Run:**
- Updates happen automatically every 2-4 hours
- Manual update: `POST /api/update` or click refresh in UI

## 🔍 Verify It's Working

1. **Check Server Status:**
   ```bash
   curl http://localhost:3000/api/status
   ```

2. **Open in Browser:**
   ```
   http://localhost:3000
   ```

3. **Check Logs:**
   ```bash
   tail -f /tmp/mapperlab-server.log
   ```

## ⚠️ Troubleshooting

**"Cannot find module" errors:**
- Run `npm install` again

**"OPENAI_API_KEY not found":**
- Make sure `.env` file exists in `MapperLab.co/` directory
- Check the key is set correctly (no quotes)

**Port 3000 already in use:**
- Kill existing process: `lsof -ti:3000 | xargs kill -9`
- Or change PORT in `.env`

**No data showing:**
- Wait for initial analysis to complete (5-10 minutes)
- Check console for errors
- Manually trigger: `curl -X POST http://localhost:3000/api/update`

## 📊 Using the Application

1. **View Heatmap**: Blue = tailwind, Red = headwind
2. **Click Tiles**: See detailed sources and timeline
3. **Time Windows**: Toggle 24h/7d/30d/90d views
4. **Search**: Find specific sectors/industries
5. **Watchlist**: Pin items to track

Enjoy! 🎉

- Make sure `.env` file exists in `MapperLab.co/` directory
- Check the key is set correctly (no quotes)

**Port 3000 already in use:**
- Kill existing process: `lsof -ti:3000 | xargs kill -9`
- Or change PORT in `.env`

**No data showing:**
- Wait for initial analysis to complete (5-10 minutes)
- Check console for errors
- Manually trigger: `curl -X POST http://localhost:3000/api/update`

## 📊 Using the Application

1. **View Heatmap**: Blue = tailwind, Red = headwind
2. **Click Tiles**: See detailed sources and timeline
3. **Time Windows**: Toggle 24h/7d/30d/90d views
4. **Search**: Find specific sectors/industries
5. **Watchlist**: Pin items to track

Enjoy! 🎉
