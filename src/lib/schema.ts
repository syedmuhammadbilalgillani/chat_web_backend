import mongoose, { Document, Schema, Model } from "mongoose";

/* ==============================
   1️⃣  USER SCHEMA & INTERFACE
   ============================== */

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
    profilePicture: { type: String, default: "" },
    isActive: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
    socketId: { type: String, default: null },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });

/* ==============================
   2️⃣  CONVERSATION SCHEMA & INTERFACE
   ============================== */

export interface IParticipant {
  userId: mongoose.Types.ObjectId;
  deletedAt?: Date | null;
}

export interface IConversation extends Document {
  type: "private" | "group";
  participants: IParticipant[];
  groupName?: string | null;
  groupPhoto?: string | null;
  lastMessage?: {
    messageId: mongoose.Types.ObjectId;
    text: string;
    sentAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<IParticipant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null },
  },
  { _id: false }
);

const conversationSchema = new Schema<IConversation>(
  {
    type: { type: String, enum: ["private", "group"], default: "private" },
    participants: { type: [participantSchema], required: true },
    groupName: { type: String, default: null },
    groupPhoto: { type: String, default: null },
    lastMessage: {
      messageId: { type: Schema.Types.ObjectId, ref: "Message" },
      text: { type: String },
      sentAt: { type: Date },
    },
  },
  { timestamps: true }
);

conversationSchema.index({ "participants.userId": 1 });

/* ==============================
   3️⃣  MESSAGE SCHEMA & INTERFACE
   ============================== */

export interface IAttachment {
  type: "image" | "video" | "file";
  url: string;
}

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  text?: string;
  attachments?: IAttachment[];
  isDeletedForEveryone: boolean;
  deletedFor: mongoose.Types.ObjectId[];
  seenBy: mongoose.Types.ObjectId[];
  deliveredTo: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = new Schema<IAttachment>(
  {
    type: { type: String, enum: ["image", "video", "file"], required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, trim: true },
    attachments: { type: [attachmentSchema], default: [] },
    isDeletedForEveryone: { type: Boolean, default: false },
    deletedFor: [{ type: Schema.Types.ObjectId, ref: "User" }],
    seenBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

/* ==============================
   4️⃣  EXPORT MODELS
   ============================== */

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", userSchema);

export const Conversation: Model<IConversation> =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", conversationSchema);

export const Message: Model<IMessage> =
  mongoose.models.Message || mongoose.model<IMessage>("Message", messageSchema);
