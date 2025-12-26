# MapperLab.co - Political Tailwind / Headwind Mapper

A TradingView-style heatmap web application that continuously ingests live global policy and macro news from central banks, treasuries, finance ministries, and regulators, converting it into a tailwind vs. headwind heatmap across sectors, industries, and instruments.

## Features

- **Live Data Ingestion**: Automatically fetches data from:
  - Federal Reserve (FOMC statements, press releases)
  - European Central Bank (ECB)
  - Bank of England (BoE)
  - US Treasury / OFAC
  - Reuters, Financial Times
  - Economic indicators (FRED API)
  - News APIs

- **AI-Powered Analysis**: Uses OpenAI GPT-4 to analyze events and assign tailwind/headwind scores

- **Interactive Heatmap**: 
  - Blue = Tailwind (positive)
  - Red = Headwind (negative)
  - Gray = Neutral
  - Click tiles to see detailed sources and timeline

- **Time Windows**: View scores for 24h, 7d, 30d, 90d periods

- **Source Transparency**: Every score shows the underlying sources used (no model reasoning, just facts)

## Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. **Clone/Navigate to the project:**
   ```bash
   cd MapperLab.co
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your API keys:
   ```env
   OPENAI_API_KEY=sk-proj-your-key-here
   FRED_API_KEY=your-fred-key-here  # Optional
   NEWSAPI_KEY=your-newsapi-key-here  # Optional
   ```

   **Required:**
   - `OPENAI_API_KEY`: Get from https://platform.openai.com/api-keys
   
   **Optional (for enhanced data):**
   - `FRED_API_KEY`: Get from https://fred.stlouisfed.org/docs/api/api_key.html
   - `NEWSAPI_KEY`: Get from https://newsapi.org/register

4. **Start the server:**
   ```bash
   npm start
   ```

   The server will start on http://localhost:3000

   On first run, it will:
   - Fetch data from all configured sources
   - Analyze sectors using AI (this may take a few minutes)
   - Display the heatmap with live scores

## Usage

1. **View the Heatmap**: Open http://localhost:3000 in your browser

2. **Navigate**: 
   - Click a sector tile to drill down to industries
   - Click an industry to see instruments
   - Double-click to navigate back up

3. **View Details**: Click any tile to open the drawer with:
   - Overview: Score, delta, confidence, trend
   - Sources: All evidence used for the score
   - Timeline: Chronological event stream
   - Related: Correlated tiles

4. **Filter & Search**:
   - Use time window buttons (24h, 7d, 30d, 90d)
   - Search by sector/industry name
   - Toggle color-blind safe view
   - Filter sources by type (Primary/Secondary)

5. **Watchlist**: Pin industries/instruments to track

## API Endpoints

- `GET /api/heatmap` - Get all scores
- `GET /api/score/:id` - Get score for specific sector/industry
- `GET /api/sources/:id` - Get sources for a sector/industry
- `GET /api/timeline/:id` - Get timeline events
- `GET /api/taxonomy` - Get taxonomy configuration
- `GET /api/status` - Get system status
- `POST /api/update` - Manually trigger data update

## Automatic Updates

The system automatically updates:
- Every 2 hours: Light refresh (data ingestion)
- Every 4 hours: Full analysis (data + AI analysis)

## Architecture

- **Backend**: Node.js + Express
- **Data Ingestion**: RSS feeds, APIs (FRED, NewsAPI)
- **AI Analysis**: OpenAI GPT-4o-mini
- **Frontend**: Vanilla JavaScript (no framework)
- **Storage**: In-memory (can be extended to database)

## Troubleshooting

### "OPENAI_API_KEY not found"
- Make sure `.env` file exists in the project root
- Check that the key is correctly set (no quotes, no spaces)

### "API quota exceeded" (429 errors)
- Check your OpenAI billing/usage
- Wait for quota reset
- The system will return neutral scores with low confidence as fallback

### No data showing
- Wait for initial update to complete (check console logs)
- Manually trigger update: `POST /api/update`
- Check that RSS feeds are accessible

### Slow initial load
- First analysis of all sectors takes 5-10 minutes
- Subsequent updates are faster (only new data)
- Consider reducing batch size in `aiAnalysis.js` if hitting rate limits

## Development

### Project Structure

```
MapperLab.co/
├── server.js              # Express server
├── services/
│   ├── dataIngestion.js   # Fetch from RSS/APIs
│   ├── aiAnalysis.js      # OpenAI integration
│   ├── dataStore.js       # In-memory data store
│   └── updateService.js   # Orchestration
├── public/
│   ├── index.html         # Frontend
│   ├── app.js             # Frontend logic
│   └── styles.css         # Styling
├── config/
│   └── taxonomy.json      # Sector/industry structure
└── .env                   # Environment variables (not in git)
```

### Adding New Data Sources

Edit `services/dataIngestion.js` and add to `DATA_SOURCES`:

```javascript
newSource: {
  name: 'Source Name',
  region: 'US',
  type: 'primary',
  feeds: ['https://example.com/rss']
}
```

### Adding New Sectors/Industries

Edit `config/taxonomy.json` and add to the sectors array.

## License

MIT

- Check your OpenAI billing/usage
- Wait for quota reset
- The system will return neutral scores with low confidence as fallback

### No data showing
- Wait for initial update to complete (check console logs)
- Manually trigger update: `POST /api/update`
- Check that RSS feeds are accessible

### Slow initial load
- First analysis of all sectors takes 5-10 minutes
- Subsequent updates are faster (only new data)
- Consider reducing batch size in `aiAnalysis.js` if hitting rate limits

## Development

### Project Structure

```
MapperLab.co/
├── server.js              # Express server
├── services/
│   ├── dataIngestion.js   # Fetch from RSS/APIs
│   ├── aiAnalysis.js      # OpenAI integration
│   ├── dataStore.js       # In-memory data store
│   └── updateService.js   # Orchestration
├── public/
│   ├── index.html         # Frontend
│   ├── app.js             # Frontend logic
│   └── styles.css         # Styling
├── config/
│   └── taxonomy.json      # Sector/industry structure
└── .env                   # Environment variables (not in git)
```

### Adding New Data Sources

Edit `services/dataIngestion.js` and add to `DATA_SOURCES`:

```javascript
newSource: {
  name: 'Source Name',
  region: 'US',
  type: 'primary',
  feeds: ['https://example.com/rss']
}
```

### Adding New Sectors/Industries

Edit `config/taxonomy.json` and add to the sectors array.

## License

MIT
