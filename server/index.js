import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

import { PORT, HOST, CORS_ORIGINS, APP_ENV } from './config.js';
import { getDb } from './db.js';
import { errorHandler } from './util/http.js';
import tasksRouter from './routes/tasks.js';
import listsRouter from './routes/lists.js';
import tokensRouter from './routes/tokens.js';
import syncRouter from './routes/sync.js';
import docsRouter from './routes/api-docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Restrict CORS to an explicit allow-list. Empty list = same-origin only,
// which is correct for the SPA served by this same server. (No wildcard.)
app.use(
  cors({
    origin: CORS_ORIGINS.length ? CORS_ORIGINS : false,
    optionsSuccessStatus: 204
  })
);
app.use(express.json());

// API routes
app.use('/api/tasks', tasksRouter);
app.use('/api/lists', listsRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/sync', syncRouter);
app.use('/api/docs', docsRouter);

// Health check (used by process supervisors / systemd watchdogs).
app.get('/api/health', (req, res) => res.json({ status: 'ok', env: APP_ENV }));

// Unmatched API routes return JSON 404 rather than the SPA shell.
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint nebyl nalezen.' }));

// Serve the built frontend (production) and fall back to index.html for SPA routing.
const frontendDistPath = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));
app.get('*', (req, res) => res.sendFile(path.join(frontendDistPath, 'index.html')));

// Central error handler (keeps internal details out of responses).
app.use(errorHandler);

// Initialise the database BEFORE accepting traffic. A failure here is fatal —
// running with a broken DB would silently appear healthy otherwise.
async function start() {
  try {
    await getDb();
    console.log('Databáze SQLite byla úspěšně načtena a inicializována.');
  } catch (err) {
    console.error('Chyba při inicializaci databáze, ukončuji proces:', err);
    process.exit(1);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server běží na http://${HOST}:${PORT}`);
    console.log(`API dokumentace: http://${HOST}:${PORT}/api/docs`);
  });
}

start();
