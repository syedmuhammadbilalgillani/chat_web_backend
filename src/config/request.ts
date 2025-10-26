import { Request } from 'express';
import mongoose from 'mongoose';

interface AuthenticatedRequest extends Request {
  user?: {
    _id: mongoose.Types.ObjectId | string;
  };
}

export default AuthenticatedRequest;
