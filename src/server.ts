import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import dotenv from 'dotenv';
import vehiclesRouter from './routes/vehicles';
import diagnosticsRouter from './routes/diagnostics';
import { connectToDatabase } from './db/index';

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

// Start server without database for now
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚗 Ford Vehicle Dashboard running on:`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://0.0.0.0:${PORT}`);
  console.log(`   Share this URL with your business partner!`);
});

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