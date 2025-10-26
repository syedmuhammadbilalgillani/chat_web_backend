import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IAttachment {
  type: 'image' | 'video' | 'file';
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
    type: { type: String, enum: ['image', 'video', 'file'], required: true },
    url: { type: String, required: true },
  },
  { _id: false },
);

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, trim: true },
    attachments: { type: [attachmentSchema], default: [] },
    isDeletedForEveryone: { type: Boolean, default: false },
    deletedFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    seenBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

// Optimize message lookups
messageSchema.index({ conversationId: 1, createdAt: 1 });

export const Message: Model<IMessage> =
  mongoose.models.Message || mongoose.model<IMessage>('Message', messageSchema);
