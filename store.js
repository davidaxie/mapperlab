// Shared data store to avoid circular dependencies

const sectors = [
  { name: 'Technology', industries: ['Software', 'Hardware', 'Semiconductors', 'Cloud Services'] },
  { name: 'Financials', industries: ['Banks', 'Insurance', 'Investment Services', 'Real Estate'] },
  { name: 'Healthcare', industries: ['Pharmaceuticals', 'Biotech', 'Medical Devices', 'Healthcare Services'] },
  { name: 'Energy', industries: ['Oil & Gas', 'Renewable Energy', 'Utilities', 'Mining'] },
  { name: 'Consumer', industries: ['Retail', 'Consumer Goods', 'Automotive', 'Entertainment'] },
  { name: 'Industrial', industries: ['Manufacturing', 'Aerospace', 'Construction', 'Transportation'] },
  { name: 'Materials', industries: ['Chemicals', 'Metals', 'Paper', 'Packaging'] },
  { name: 'Communication', industries: ['Telecom', 'Media', 'Social Media', 'Streaming'] }
];

function generateInitialData() {
  const data = [];
  sectors.forEach(sector => {
    sector.industries.forEach(industry => {
      // Generate rating 0-100, with 50 as neutral
      // Start around 40-60 range for initial demo data
      const rating = 40 + Math.random() * 20;
      data.push({
        sector: sector.name,
        industry: industry,
        rating: Math.round(rating), // 0-100 scale, 50 = neutral
        lastUpdate: new Date().toISOString()
      });
    });
  });
  return data;
}

let heatmapData = generateInitialData();
let lastFedUpdate = new Date().toISOString();
let lastTreasuryUpdate = new Date().toISOString();

export function getHeatmapData() {
  return {
    data: heatmapData,
    timestamp: new Date().toISOString(),
    lastFedUpdate,
    lastTreasuryUpdate
  };
}

export function updateHeatmapData(newData) {
  heatmapData = newData;
}

export function updateFedTimestamp() {
  lastFedUpdate = new Date().toISOString();
}

export function updateTreasuryTimestamp() {
  lastTreasuryUpdate = new Date().toISOString();
}

export { sectors };

