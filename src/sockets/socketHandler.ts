import mongoose from 'mongoose';
import { Server, Socket } from 'socket.io';
import { verifyToken } from '../controllers/auth.controller';
import { Conversation, Message, User } from '../schema';

/**
 * Socket auth: client should connect with token in query: io('/?token=...')
 * Or use auth: io({ auth: { token } })
 *
 * Events:
 * - user:online (server sets user active)
 * - send:message { conversationId, text, attachments }
 * - message:seen { messageIds: [] }
 * - message:deleteForMe { messageId }
 * - message:deleteForEveryone { messageId }
 * - chat:delete { conversationId } -> mark participant.deletedAt for the requester
 * - typing { conversationId, typing: boolean }
 */

export const setupSocket = (io: Server) => {
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next();

    try {
      const secret = process.env.JWT_SECRET!;
      const payload = verifyToken(token.toString()) as {
        id: string;
        email: string;
        password: string;
      };
      const user = await User.findById(payload.id).select('-password');
      if (!user) return next(new Error('Unauthorized'));
      // attach user to socket
      (socket as any).user = user;
      return next();
    } catch (err) {
      console.error('Socket auth error:', err);
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const userId = user._id.toString();
    // store socketId on user document for direct messaging
    User.findByIdAndUpdate(userId, { isActive: true, socketId: socket.id }).catch(console.error);

    // join room for this user to receive messages by room name `user:<id>`
    socket.join(`user:${userId}`);

    // Optional: join all conversation rooms the user is in (so server can emit to conversation room)
    // Could be expensive for many convs; do it on demand in production
    Conversation.find({ 'participants.userId': user._id, 'participants.deletedAt': null })
      .then((convs) => convs.forEach((c: any) => socket.join(`conversation:${c._id.toString()}`)))
      .catch(console.error);

    // notify others (for presence) — emit to followers/contacts or globally as needed
    io.emit('user:status', { userId, isActive: true });

    // handle sending message
    socket.on('send:message', async (payload: any, ack?: (resp: any) => void) => {
      /**
       * payload: { conversationId, text, attachments: [{type,url}] }
       * Steps:
       * - Validate conversation and sender participant
       * - Create message
       * - Update conversation.lastMessage
       * - Emit to conversation room + to each participant's user room
       */
      try {
        const { conversationId, text, attachments } = payload;
        if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId))
          return ack?.({ ok: false, message: 'Invalid conversationId' });

        const conv = await Conversation.findById(conversationId);
        if (!conv) return ack?.({ ok: false, message: 'Conversation not found' });

        // ensure sender is participant
        const isParticipant = conv.participants.some((p) => p.userId.toString() === userId);
        if (!isParticipant) return ack?.({ ok: false, message: 'Not a participant' });

        const msg = await Message.create({
          conversationId,
          senderId: user._id,
          text: text || null,
          attachments: attachments || [],
        });

        // update conversation lastMessage and updatedAt
        conv.lastMessage = { messageId: msg._id, text: text || null, sentAt: msg.createdAt };
        conv.updatedAt = new Date();
        await conv.save();

        const populatedMsg = await msg.populate('senderId', 'username profilePicture');
        //   .execPopulate();

        // Emit to conversation room
        io.to(`conversation:${conversationId}`).emit('message:received', populatedMsg);

        // Also emit to each participant individually (useful if client listens on user room)
        conv.participants.forEach((p) => {
          io.to(`user:${p.userId.toString()}`).emit('notification:new_message', {
            conversationId,
            message: {
              id: msg._id,
              text: msg.text,
              senderId: userId,
              sentAt: msg.createdAt,
            },
          });
        });

        ack?.({ ok: true, message: populatedMsg });
      } catch (err) {
        console.error('send:message error:', err);
        ack?.({ ok: false, message: 'Server error' });
      }
    });

    // message seen
    socket.on('message:seen', async (payload: any, ack?: (res: any) => void) => {
      // payload: { messageIds: [id], conversationId }
      try {
        const { messageIds } = payload;
        if (!Array.isArray(messageIds) || messageIds.length === 0) return ack?.({ ok: false });

        const ops = messageIds.map((mid: string) =>
          Message.updateOne(
            { _id: mid, seenBy: { $ne: user._id } },
            { $addToSet: { seenBy: user._id } },
          ),
        );
        await Promise.all(ops);

        // notify other participants that these messages were seen
        messageIds.forEach((mid: string) => {
          io.to(`conversation:${payload.conversationId}`).emit('message:seen', {
            messageId: mid,
            userId,
          });
        });

        ack?.({ ok: true });
      } catch (err) {
        console.error('message:seen error:', err);
        ack?.({ ok: false });
      }
    });

    // delete message for me
    socket.on('message:deleteForMe', async (payload: any, ack?: (res: any) => void) => {
      // payload: { messageId }
      try {
        const { messageId } = payload;
        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) return ack?.({ ok: false });

        await Message.updateOne({ _id: messageId }, { $addToSet: { deletedFor: user._id } });

        // emit to requester only (they removed locally)
        socket.emit('message:deletedForMe', { messageId });
        ack?.({ ok: true });
      } catch (err) {
        console.error('deleteForMe error:', err);
        ack?.({ ok: false });
      }
    });

    // delete message for everyone
    socket.on('message:deleteForEveryone', async (payload: any, ack?: (res: any) => void) => {
      // payload: { messageId }
      try {
        const { messageId } = payload;
        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) return ack?.({ ok: false });

        // Optionally check sender match or permission; here allow only sender to delete for everyone
        const msg = await Message.findById(messageId);
        if (!msg) return ack?.({ ok: false, message: 'Message not found' });
        if (msg.senderId.toString() !== userId) return ack?.({ ok: false, message: 'Not sender' });

        msg.isDeletedForEveryone = true;
        await msg.save();

        // announce in conversation room
        io.to(`conversation:${msg.conversationId.toString()}`).emit('message:deletedForEveryone', {
          messageId,
        });
        ack?.({ ok: true });
      } catch (err) {
        console.error('deleteForEveryone error:', err);
        ack?.({ ok: false });
      }
    });

    // chat delete for user (per-user conversation delete)
    socket.on('chat:delete', async (payload: any, ack?: (res: any) => void) => {
      // payload { conversationId }
      try {
        const { conversationId } = payload;
        if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId))
          return ack?.({ ok: false });

        await Conversation.updateOne(
          { _id: conversationId, 'participants.userId': user._id },
          { $set: { 'participants.$.deletedAt': new Date() } },
        );

        // leave socket room for conversation
        socket.leave(`conversation:${conversationId}`);
        ack?.({ ok: true });
      } catch (err) {
        console.error('chat:delete error:', err);
        ack?.({ ok: false });
      }
    });

    socket.on('typing', (payload: any) => {
      // payload: { conversationId, typing: boolean }
      const { conversationId, typing } = payload;
      if (!conversationId) return;
      io.to(`conversation:${conversationId}`).emit('typing', { conversationId, userId, typing });
    });

    socket.on('disconnect', async () => {
      // mark user offline and set lastSeen
      try {
        await User.findByIdAndUpdate(userId, {
          isActive: false,
          lastSeen: new Date(),
          socketId: null,
        });
        io.emit('user:status', { userId, isActive: false, lastSeen: new Date() });
      } catch (err) {
        console.error('disconnect update error:', err);
      }
    });
  });
};
