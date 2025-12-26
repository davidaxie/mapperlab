import cron from 'node-cron';
import axios from 'axios';
import { updateHeatmapData, updateFedTimestamp, updateTreasuryTimestamp, sectors, getHeatmapData } from './store.js';

// Industry impact mappings based on policy actions
// Values are in 0-100 scale where 50 is neutral
// Positive values = tailwinds (blue), negative = headwinds (red)
const POLICY_IMPACTS = {
  'rate_increase': {
    'Technology': -15,      // 50 - 15 = 35 (headwind)
    'Financials': 10,       // 50 + 10 = 60 (tailwind)
    'Healthcare': -5,       // 50 - 5 = 45 (slight headwind)
    'Energy': -10,          // 50 - 10 = 40 (headwind)
    'Consumer': -20,        // 50 - 20 = 30 (strong headwind)
    'Industrial': -15,      // 50 - 15 = 35 (headwind)
    'Materials': -10,       // 50 - 10 = 40 (headwind)
    'Communication': -10   // 50 - 10 = 40 (headwind)
  },
  'rate_decrease': {
    'Technology': 20,       // 50 + 20 = 70 (tailwind)
    'Financials': -5,       // 50 - 5 = 45 (slight headwind)
    'Healthcare': 10,       // 50 + 10 = 60 (tailwind)
    'Energy': 15,           // 50 + 15 = 65 (tailwind)
    'Consumer': 25,         // 50 + 25 = 75 (strong tailwind)
    'Industrial': 20,       // 50 + 20 = 70 (tailwind)
    'Materials': 15,        // 50 + 15 = 65 (tailwind)
    'Communication': 15    // 50 + 15 = 65 (tailwind)
  },
  'quantitative_easing': {
    'Technology': 25,       // 50 + 25 = 75 (strong tailwind)
    'Financials': 15,       // 50 + 15 = 65 (tailwind)
    'Healthcare': 10,       // 50 + 10 = 60 (tailwind)
    'Energy': 20,           // 50 + 20 = 70 (tailwind)
    'Consumer': 30,         // 50 + 30 = 80 (very strong tailwind)
    'Industrial': 25,       // 50 + 25 = 75 (strong tailwind)
    'Materials': 20,        // 50 + 20 = 70 (tailwind)
    'Communication': 20    // 50 + 20 = 70 (tailwind)
  },
  'quantitative_tightening': {
    'Technology': -25,      // 50 - 25 = 25 (strong headwind)
    'Financials': -10,      // 50 - 10 = 40 (headwind)
    'Healthcare': -10,      // 50 - 10 = 40 (headwind)
    'Energy': -20,          // 50 - 20 = 30 (strong headwind)
    'Consumer': -30,        // 50 - 30 = 20 (very strong headwind)
    'Industrial': -25,      // 50 - 25 = 25 (strong headwind)
    'Materials': -20,       // 50 - 20 = 30 (strong headwind)
    'Communication': -20   // 50 - 20 = 30 (strong headwind)
  },
  'fiscal_stimulus': {
    'Technology': 15,       // 50 + 15 = 65 (tailwind)
    'Financials': 10,       // 50 + 10 = 60 (tailwind)
    'Healthcare': 20,       // 50 + 20 = 70 (tailwind)
    'Energy': 15,           // 50 + 15 = 65 (tailwind)
    'Consumer': 25,         // 50 + 25 = 75 (strong tailwind)
    'Industrial': 30,       // 50 + 30 = 80 (very strong tailwind)
    'Materials': 25,        // 50 + 25 = 75 (strong tailwind)
    'Communication': 10    // 50 + 10 = 60 (tailwind)
  }
};

// Get initial data from store
let currentHeatmapData = getHeatmapData().data;

// Fetch Fed data (placeholder - replace with actual API)
async function fetchFedData() {
  try {
    // In production, this would fetch from:
    // - Federal Reserve API
    // - FRED (Federal Reserve Economic Data)
    // - Fed meeting minutes and announcements
    
    // For now, simulate data updates
    const actions = ['rate_increase', 'rate_decrease', 'quantitative_easing', 'quantitative_tightening'];
    const randomAction = actions[Math.floor(Math.random() * actions.length)];
    
    return {
      type: randomAction,
      timestamp: new Date().toISOString(),
      source: 'Federal Reserve'
    };
  } catch (error) {
    console.error('Error fetching Fed data:', error.message);
    return null;
  }
}

// Fetch Treasury data (placeholder)
async function fetchTreasuryData() {
  try {
    // In production, this would fetch from:
    // - Treasury.gov API
    // - Treasury auction results
    // - Fiscal policy announcements
    
    return {
      type: 'fiscal_stimulus',
      timestamp: new Date().toISOString(),
      source: 'U.S. Treasury'
    };
  } catch (error) {
    console.error('Error fetching Treasury data:', error.message);
    return null;
  }
}

// Process policy action and update heatmap
function processPolicyAction(action) {
  if (!action || !POLICY_IMPACTS[action.type]) return;

  const impacts = POLICY_IMPACTS[action.type];
  
  currentHeatmapData = currentHeatmapData.map(item => {
    const sectorImpact = impacts[item.sector] || 0;
    
    // Add some randomness for industry-level variation (-5 to +5)
    const industryVariation = (Math.random() - 0.5) * 10;
    const newRating = Math.max(0, Math.min(100, item.rating + sectorImpact + industryVariation));
    
    return {
      ...item,
      rating: Math.round(newRating),
      lastUpdate: new Date().toISOString()
    };
  });

  updateHeatmapData(currentHeatmapData);
}

// Main aggregation function
async function aggregateData() {
  console.log('Aggregating data...');
  
  const fedData = await fetchFedData();
  if (fedData) {
    updateFedTimestamp();
    processPolicyAction(fedData);
  }

  const treasuryData = await fetchTreasuryData();
  if (treasuryData) {
    updateTreasuryTimestamp();
    processPolicyAction(treasuryData);
  }

  // Add some natural decay over time (move ratings toward 50/neutral)
  currentHeatmapData = currentHeatmapData.map(item => {
    const decay = 0.02; // Small decay factor
    const currentRating = item.rating;
    const neutral = 50;
    // Move rating 2% closer to neutral
    const newRating = currentRating + (neutral - currentRating) * decay;
    return {
      ...item,
      rating: Math.round(newRating)
    };
  });

  updateHeatmapData(currentHeatmapData);
}

// Start data aggregation
export function startDataAggregation() {
  // Run immediately
  aggregateData();
  
  // Then run every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    aggregateData();
  });

  console.log('Data aggregation started');
}

