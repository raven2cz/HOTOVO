import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { getDb } from './db.js';
import tasksRouter from './routes/tasks.js';
import listsRouter from './routes/lists.js';
import tokensRouter from './routes/tokens.js';
import syncRouter from './routes/sync.js';
import docsRouter from './routes/api-docs.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Database Schema on start
getDb().then(() => {
  console.log('Databáze SQLite byla úspěšně načtena a inicializována.');
}).catch((err) => {
  console.error('Chyba při inicializaci SQLite databáze:', err);
});

// API Routes
app.use('/api/tasks', tasksRouter);
app.use('/api/lists', listsRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/sync', syncRouter);
app.use('/api/docs', docsRouter);

// Serve Frontend Static Assets (Production build)
const frontendDistPath = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));

// Fallback to React index.html for Single Page Application routing
app.get('*', (req, res, next) => {
  // If it's an API route that didn't match, return 404
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint nebyl nalezen' });
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server běží na adrese http://localhost:${PORT}`);
  console.log(`API dokumentace pro agenty: http://localhost:${PORT}/api/docs`);
});
