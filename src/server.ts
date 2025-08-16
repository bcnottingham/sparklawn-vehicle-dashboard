import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import dotenv from 'dotenv';
import vehiclesRouter from './routes/vehicles';
import diagnosticsRouter from './routes/diagnostics';
import { connectToDatabase } from './db/index';
import { tokenManager } from './services/tokenManager';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// Middleware
app.use(bodyParser.json());
app.use(express.static('src/public'));

// Serve the main dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/index.html'));
});

// Routes
app.use('/vehicles', vehiclesRouter);
app.use('/diagnostics', diagnosticsRouter);

// Start server with automatic token management
async function startServer() {
  try {
    // Initialize automatic token management with MongoDB
    await tokenManager.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🌱 SparkLawn Vehicle Dashboard running on:`);
      console.log(`   Local:    http://localhost:${PORT}`);
      console.log(`   Network:  http://0.0.0.0:${PORT}`);
      console.log(`   ✅ Automatic token refresh: ENABLED`);
      console.log(`   🔄 Refreshes every 90 minutes automatically`);
      console.log(`   Share this URL with your business partner!`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await tokenManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await tokenManager.close();
  process.exit(0);
});

startServer();

// Database connection (disabled for testing)
// connectToDatabase()
//   .then(() => {
//     app.listen(PORT, () => {
//       console.log(`Server is running on http://localhost:${PORT}`);
//     });
//   })
//   .catch(err => {
//     console.error('Database connection failed:', err);
//   });