import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  profilePicture?: string;
  isActive: boolean;
  lastSeen?: Date | null;
  socketId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    profilePicture: { type: String, default: '' },
    isActive: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
    socketId: { type: String, default: null },
  },
  { timestamps: true },
);

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', userSchema);
