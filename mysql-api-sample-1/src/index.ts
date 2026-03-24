import express from 'express';
import { connect } from './db/connection';
import { setRoutes } from './routes/todoRoutes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

connect()
  .then(() => {
    console.log('Connected to the database');
    setRoutes(app);
    
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Database connection failed:', err);
  });