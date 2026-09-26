import express from 'express';
import { app as firebaseApp } from './firebaseAdmin.js';
import { assertCorrectEnvironment } from './envGuard.js';
import { adminPaymentRequestsRouter } from './routes/adminPaymentRequests.js';
import { webhooksRouter } from './routes/webhooks.js';
import { telegramRouter } from './routes/telegram.js';
import { logAction } from './utils/logger.js';

// Refuse to start if APP_ENV doesn't match the connected Firebase project.
assertCorrectEnvironment(firebaseApp.options.projectId);

const app = express();

// JSON parsing is applied per-route (not globally) — the webhook route
// needs to control exactly how its body is parsed for signature
// verification, so it's kept explicit there rather than assumed here.
app.use('/api/admin', express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', env: process.env.APP_ENV });
});

app.use('/api/admin/payment-requests', adminPaymentRequestsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/telegram', telegramRouter);

// Central error handler — logs without leaking stack traces to the client.
app.use((err, req, res, next) => {
  logAction('unhandled_error', { path: req.path, error: err.message });
  res.status(500).json({ error: 'Internal server error.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logAction('server.started', { port, env: process.env.APP_ENV });
});
