import mongoose, { Document, Schema, Model } from 'mongoose';

interface IParticipant {
  userId: mongoose.Types.ObjectId;
  deletedAt?: Date | null; // hide chat from inbox
  hideMessagesBefore?: Date | null; // watermark: hide messages older than this for this user
  archivedAt?: Date | null; // optional
  mutedUntil?: Date | null; // optional
  blocked?: boolean; // optional
}

export interface IConversation extends Document {
  type: 'private' | 'group';
  participants: IParticipant[];
  groupName?: string | null;
  groupPhoto?: string | null;
  lastMessage?: {
    messageId: mongoose.Types.ObjectId | any;
    text: string;
    sentAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<IParticipant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
    hideMessagesBefore: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    mutedUntil: { type: Date, default: null },
    blocked: { type: Boolean, default: false },
  },
  { _id: false },
);







const conversationSchema = new Schema<IConversation>(
  {
    type: { type: String, enum: ['private', 'group'], default: 'private' },
    participants: { type: [participantSchema], required: true },
    groupName: { type: String, default: null },
    groupPhoto: { type: String, default: null },
    lastMessage: {
      messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
      text: { type: String },
      sentAt: { type: Date },
    },
  },
  { timestamps: true },
);

// For faster lookup by participant
conversationSchema.index({ 'participants.userId': 1, updatedAt: -1 });

export const Conversation: Model<IConversation> =
  mongoose.models.Conversation || mongoose.model<IConversation>('Conversation', conversationSchema);
