// db.ts
import mongoose from 'mongoose';
import dotenv from "dotenv";

dotenv.config();

const connectDB = async () => {
  try {
    const DB_URL = process.env.MONGODB_URI as string;
    // console.log(DB_URL, 'db url');
    const conn = await mongoose.connect(DB_URL);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1); // Exit process if connection fails
  }
};

export default connectDB;
