# Next Steps - Getting Started with MapperLab.co

## ✅ What's Already Done

- ✅ Application code is complete and fixed
- ✅ UI is working with card-based layout
- ✅ OpenAI API key is configured in `.env`
- ✅ All critical CSS classes are fixed

## 🚀 Quick Start

### Option 1: Use the Start Script
```bash
cd MapperLab.co
./START_SERVER.sh
```

### Option 2: Manual Start
```bash
cd MapperLab.co
npm start
```

Then open your browser to: **http://localhost:3000**

## 📋 What Happens When You Start

1. **Server starts** on port 3000
2. **Initial data fetch** begins automatically:
   - Fetches from central banks (Fed, ECB, BOE, etc.)
   - Fetches from news sources (if NewsAPI key configured)
   - Fetches economic indicators (if FRED key configured)
3. **AI Analysis** processes events:
   - Analyzes each sector/industry
   - Generates tailwind/headwind scores
   - Calculates confidence levels
4. **Heatmap displays** with:
   - Color-coded cards (blue=tailwind, red=headwind, gray=neutral)
   - Score percentages
   - Change indicators
   - Confidence bars
   - Tags

**Note**: Initial analysis takes 2-5 minutes. You'll see progress in the server console.

## 🔑 Optional: Get Additional API Keys

For better data coverage, consider adding:

1. **NewsAPI** (Free tier: 100 requests/day)
   - See `API_KEYS_SETUP.md` for instructions
   - Adds news articles from Reuters, FT, etc.

2. **FRED API** (Free, unlimited requests)
   - See `API_KEYS_SETUP.md` for instructions
   - Adds economic indicators (CPI, employment, etc.)

The app works without these, but with limited data sources.

## 🎯 Using the Application

### Navigation
- **Single-click** a card → Opens detail drawer with sources, timeline, related items
- **Double-click** a card → Drill down (sector → industry → instrument)
- **Click breadcrumb** → Navigate back up the hierarchy

### Filters
- **Time Window**: Toggle between 24h, 7d, 30d, 90d
- **Category Filters**: Show/hide Rates/FX, Crypto, Commodities
- **Search**: Filter by sector/industry name

### Watchlist
- Click a card to open drawer
- Add items to watchlist
- Set alert thresholds

## 🔄 Automatic Updates

The system automatically:
- Refreshes data every 2 hours (frequent sources)
- Performs full AI analysis every 4 hours
- Updates scores in real-time as new data arrives

## 🐛 Troubleshooting

### Page shows "No data available"
- Wait 2-5 minutes for initial analysis
- Check server console for errors
- Verify OpenAI API key is valid

### API errors in console
- Check `API_KEYS_SETUP.md` for key setup
- Verify keys in `.env` file
- Check API quotas/billing

### Cards not displaying
- Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)
- Check browser console for JavaScript errors
- Verify all files are present in `public/` directory

## 📚 Documentation

- `README.md` - Full project documentation
- `API_KEYS_SETUP.md` - Detailed API key setup guide
- `QUICKSTART.md` - Quick reference guide
- `IMPLEMENTATION_SUMMARY.md` - Technical implementation details

## 🎉 You're Ready!

Everything is set up and ready to go. Just run `npm start` and open http://localhost:3000!

