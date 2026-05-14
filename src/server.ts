import 'dotenv/config';
import { createApp } from '@/app';

if (process.env.NODE_ENV === 'production') {
  const required = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

app.listen(port, host, () => {
  console.log(`🥊 Ranking API listening on http://${host}:${port}`);
  console.log(`   Health check: http://localhost:${port}/health`);
});
