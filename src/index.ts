import { errorHandler } from './middlewares/errorHandler';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import router from './routes/crawl';
import connectDB from './lib/db';
import dotenv from "dotenv";



dotenv.config();
const app = express();
const port = process.env.PORT || 5235;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(cors({ origin: '*' })); // Adjust the origin as needed
app.use(bodyParser.json());
app.use(cookieParser());
app.use(errorHandler);
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ message: 'Backend server is running!' });
});
app.use('/api/crawl', router);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
app.get('/', (req, res) => {
  res.send('Server Working...!!!');
});

// Connect to DB when running in development
if (process.env.NODE_ENV !== 'production') {
  connectDB()
    .then(() => {
      app.listen(port as number, HOST, () => {
        console.log(`Server is running on http://${HOST}:${port}`);
      });
    })
    .catch((err) => {
      console.log(`DB Connection Failed`, err);
    });
} else {
  // In production, connect to DB but don't start the server (Vercel will handle that)
  connectDB().catch((err) => {
    console.log(`DB Connection Failed`, err);
  });
}
