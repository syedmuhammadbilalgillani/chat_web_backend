import { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../controllers/auth.controller';
import { User } from '../schema';

export interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token: string | undefined;

  // ✅ 1️⃣ Check Authorization header first
  if (req.headers.authorization) {
    const authHeader = req.headers.authorization.trim();

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
      console.log('Token from Bearer:', token);
    } else if (authHeader.startsWith('token=')) {
      let value = authHeader.split('token=')[1];
      const endIndex = value.indexOf('du');
      token = endIndex !== -1 ? value.substring(0, endIndex) : value;
      console.log('Token from token= format:', token);
    }
  }
  console.log(req.cookies?.token, 'req.cookies?.token');

  // ✅ 2️⃣ If not found, check cookies
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
    console.log('Token from cookies:', token);
  }

  // ✅ 3️⃣ If no token found at all
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  // ✅ 4️⃣ Verify token
  try {
    const decoded = verifyToken(token ) as {
      id: string;
      email: string;
      password: string;
    };
    console.log(decoded, 'deconded');
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }

    next();
  } catch (error) {
    console.error('JWT verification failed:', error);
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};
