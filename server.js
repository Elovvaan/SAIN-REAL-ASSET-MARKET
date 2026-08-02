import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const { app } = await createApp();

app.listen(port, '0.0.0.0', () => {
  console.log(`SRA EDX Stabilization Priority 1 is running on port ${port}`);
});
