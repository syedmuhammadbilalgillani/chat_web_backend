import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../schema';
import { Types } from 'mongoose';
import AuthenticatedRequest from '../config/request';

const generateToken = (id: string, email: string, password: string) => {
  const token = jwt.sign({ id, email, password }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  return Buffer.from(token).toString('base64url'); // safe, URL-friendly
};

// Then decode before verifying:
export const verifyToken = (encodedToken: string) => {
  console.log(encodedToken, 'token');
  console.log(typeof encodedToken, 'token');
  const decoded = Buffer.from(encodedToken, 'base64url').toString('utf8');
  return jwt.verify(decoded, process.env.JWT_SECRET!);
};
// @desc Register user
export const registerUser = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;
    console.log(req.body);
    if (!username || !email || !password)
      return res.status(400).json({ message: 'All fields are required' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = (await User.create({
      username,
      email,
      password: hashedPassword,
    })) as any;

    res.status(201).json({
      message: 'User registered successfully',
      token: generateToken(user._id.toString(), user?.email.toString(), user.password.toString()),
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// @desc Login user
export const loginUser = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    console.log(req.body);

    const user = (await User.findOne({ email })) as any;
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    res.status(200).json({
      message: 'Login successful',
      token: generateToken(user._id.toString(), user?.email.toString(), user.password.toString()),
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Server error', error });
  }
};

// @desc Get all users
export const getUsers = async (_req: Request, res: Response) => {
  try {
    console.log('======== fetching start');
    const users = await User.find().select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// @desc Get single user
export const getUser = async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};
// @desc Get single user (by filtering from all users)
export const getOtherUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authUserId = new Types.ObjectId(req?.user?._id);

    // ✅ Fetch all users except the one whose _id matches the given ID
    const otherUsers = await User.find({ _id: { $ne: authUserId } }).select('-password');

    // ✅ Handle case if no other users found
    if (!otherUsers || otherUsers.length === 0) {
      return res.status(404).json({ message: 'No other users found' });
    }

    console.log(otherUsers, 'other users');

    // ✅ Return remaining users
    res.status(200).json(otherUsers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error });
  }
};

// @desc Update user
export const updateUser = async (req: Request, res: Response) => {
  try {
    const { username, profilePicture } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { username, profilePicture },
      { new: true },
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

// @desc Delete user
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};
