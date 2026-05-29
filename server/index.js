import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// .env is loaded by ./config.js (via `import 'dotenv/config'`) before any
// config value is read.
import { PORT, HOST, CORS_ORIGINS } from './config.js';
import { getDb } from './db.js';
import { requireAuth } from './auth.js';
import { startOutboxProcessor, flushOutbox } from './services/gcalOutbox.js';
import { errorHandler } from './util/http.js';
import tasksRouter from './routes/tasks.js';
import listsRouter from './routes/lists.js';
import tokensRouter from './routes/tokens.js';
import syncRouter from './routes/sync.js';
import agentRouter from './routes/agent.js';
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
app.use('/api/agent', agentRouter);
app.use('/api/docs', docsRouter);

// Health check (used by process supervisors / systemd watchdogs). Gated like
// the rest of /api; local supervision on loopback passes via the same-origin
// bypass. Intentionally minimal — exposes no runtime details.
app.get('/api/health', requireAuth, (req, res) => res.json({ status: 'ok' }));

// Unmatched API routes: authenticate first so unknown paths don't reveal route
// existence (unauthenticated callers get 401, not 404), then return JSON 404.
app.use('/api', requireAuth, (req, res) => res.status(404).json({ error: 'Endpoint nebyl nalezen.' }));

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

  // Drain anything left queued by a previous run, then retry periodically.
  flushOutbox();
  startOutboxProcessor();
}

start();
