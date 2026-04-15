import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { dataStore } from './services/dataStore.js';
import { performUpdate, initialize } from './services/updateService.js';
import { readFileSync } from 'fs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Load taxonomy
function loadTaxonomy() {
  try {
    const taxonomyPath = join(__dirname, 'config/taxonomy.json');
    return JSON.parse(readFileSync(taxonomyPath, 'utf-8'));
  } catch (error) {
    console.error('Error loading taxonomy:', error);
    return { sectors: [] };
  }
}

// API Routes

// Health check / status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    lastUpdate: dataStore.lastUpdate,
    updating: dataStore.isUpdating(),
    scoresCount: Object.keys(dataStore.getScores()).length,
    eventsCount: dataStore.getEvents().length
  });
});

// Get all heatmap scores
app.get('/api/heatmap', (req, res) => {
  try {
    const scores = dataStore.getFormattedScores();
    res.json(scores);
  } catch (error) {
    console.error('Error getting heatmap:', error);
    res.status(500).json({ error: 'Failed to get heatmap data' });
  }
});

// Get score for specific sector/industry
app.get('/api/score/:id', (req, res) => {
  try {
    const score = dataStore.getScore(req.params.id);
    if (!score) {
      return res.status(404).json({ error: 'Score not found' });
    }
    const formatted = dataStore.getFormattedScores();
    res.json(formatted[req.params.id] || score);
  } catch (error) {
    console.error('Error getting score:', error);
    res.status(500).json({ error: 'Failed to get score' });
  }
});

app.get('/api/events', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const events = dataStore.getEvents().slice(0, limit);
    res.json(events);
  } catch (error) {
    console.error('Error getting events:', error);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

// Get sources for a sector/industry
app.get('/api/sources/:id', (req, res) => {
  try {
    const sources = dataStore.getSources(req.params.id);
    res.json(sources);
  } catch (error) {
    console.error('Error getting sources:', error);
    res.status(500).json({ error: 'Failed to get sources' });
  }
});

// Get timeline for a sector/industry
app.get('/api/timeline/:id', (req, res) => {
  try {
    const timeline = dataStore.getTimeline(req.params.id);
    res.json(timeline);
  } catch (error) {
    console.error('Error getting timeline:', error);
    res.status(500).json({ error: 'Failed to get timeline' });
  }
});

// Get taxonomy configuration
app.get('/api/taxonomy', (req, res) => {
  try {
    const taxonomy = loadTaxonomy();
    res.json(taxonomy);
  } catch (error) {
    console.error('Error getting taxonomy:', error);
    res.status(500).json({ error: 'Failed to get taxonomy' });
  }
});

// Manual update trigger
app.post('/api/update', async (req, res) => {
  try {
    if (dataStore.isUpdating()) {
      return res.status(429).json({ 
        error: 'Update already in progress',
        status: 'updating'
      });
    }

    // Start update asynchronously
    performUpdate().catch(err => {
      console.error('Background update error:', err);
    });

    res.json({ 
      status: 'update_started',
      message: 'Update initiated. Check /api/status for progress.',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering update:', error);
    res.status(500).json({ error: 'Failed to trigger update' });
  }
});

// Start server immediately (don't wait for initial update)
app.listen(PORT, () => {
  console.log(`🚀 MapperLab.co server running on http://localhost:${PORT}`);
  console.log(`📊 API available at http://localhost:${PORT}/api`);
  console.log(`🌐 Frontend available at http://localhost:${PORT}`);
  console.log('');
  console.log('Starting initial data update in background...');
  
  // Initialize data in background (non-blocking)
  initialize().catch(err => {
    console.error('Initial update error:', err);
    console.log('Server is running, but initial data may be incomplete.');
    console.log('You can manually trigger an update via POST /api/update');
  });

  // Schedule automatic updates
  // Light refresh every 2 hours (data ingestion only)
  cron.schedule('0 */2 * * *', async () => {
    console.log('⏰ Scheduled light refresh (2h)...');
    await performUpdate();
  });

  // Full analysis every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    console.log('⏰ Scheduled full analysis (4h)...');
    await performUpdate();
  });

  console.log('✅ Automatic updates scheduled:');
  console.log('   - Light refresh: Every 2 hours');
  console.log('   - Full analysis: Every 4 hours');
});

