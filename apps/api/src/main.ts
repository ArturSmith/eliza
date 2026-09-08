import { createApp } from './app.js';
const app = await createApp();
await app.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1');
