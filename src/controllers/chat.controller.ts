import { Response } from 'express';
import { Conversation, IMessage, Message, User } from '../schema';
import mongoose, { Types } from 'mongoose';
import AuthenticatedRequest from '../config/request';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Create or return existing private conversation between two users
 * body: { participantId }
 */
export const getOrCreatePrivateConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meId = req?.user?._id as mongoose.Types.ObjectId;
    const { participantId } = req.body;

    if (!participantId) return res.status(400).json({ message: 'participantId required' });
    if (!mongoose.Types.ObjectId.isValid(participantId))
      return res.status(400).json({ message: 'invalid id' });

    // Optional: block guard (professional UX)
    const blockedExisting = await Conversation.findOne({
      type: 'private',
      participants: {
        $all: [{ $elemMatch: { userId: meId } }, { $elemMatch: { userId: participantId } }],
      },
      $or: [
        { participants: { $elemMatch: { userId: meId, blocked: true } } },
        { participants: { $elemMatch: { userId: participantId, blocked: true } } },
      ],
    }).select({ _id: 1 });
    if (blockedExisting) return res.status(403).json({ message: 'Conversation not allowed' });

    // Return only if BOTH sides are active (deletedAt: null)
    const active = await Conversation.findOne({
      type: 'private',
      participants: {
        $all: [
          { $elemMatch: { userId: meId, deletedAt: null } },
          { $elemMatch: { userId: participantId, deletedAt: null } },
        ],
      },
    });

    if (active) return res.json(active);

    // If any prior (deleted/archived) thread exists, DO NOT restore. Make a fresh one.
    const conv = await Conversation.create({
      type: 'private',
      participants: [{ userId: meId }, { userId: participantId }],
    });

    return res.status(201).json(conv);
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

export const getConversations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meId = req?.user?._id as mongoose.Types.ObjectId;

    const convs = await Conversation.find({
      participants: { $elemMatch: { userId: meId, deletedAt: null } },
    }).sort({ updatedAt: -1 });

    return res.json(convs);
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

export const getMessagesByConversationId = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = new mongoose.Types.ObjectId(req?.user?._id);
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation ID.' });
    }

    // 1️⃣ Validate conversation and participant
    const conversation = await Conversation.findOne({
      _id: conversationId,
      'participants.userId': userId,
      'participants.deletedAt': null,
    }).select('participants type groupName');

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found or access denied.' });
    }

    // 2️⃣ Get participant data for this user (hideMessagesBefore, etc.)
    const participant = conversation.participants.find((p) => p.userId.equals(userId));
    const hideBefore = participant?.hideMessagesBefore || null;

    // 3️⃣ Pagination (optional)
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const before = req.query.before ? new Date(String(req.query.before)) : null;

    const timeFilter = before ? { createdAt: { $lt: before } } : {};

    // 4️⃣ Fetch messages
    const messages = await Message.find({
      conversationId: conversation._id,
      deletedFor: { $ne: userId }, // not deleted for this user
      ...(hideBefore ? { createdAt: { $gt: hideBefore } } : {}),
      ...timeFilter,
    })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate('senderId', 'username profilePicture isActive')
      .lean();

    // 5️⃣ Pagination cursor
    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

    // 6️⃣ Mark messages as read for this user (optional)
    await Message.updateMany(
      {
        conversationId: conversation._id,
        senderId: { $ne: userId },
        readBy: { $ne: userId },
      },
      { $addToSet: { readBy: userId } },
    );

    // 7️⃣ Return response
    return res.status(200).json({
      conversationId: conversation._id,
      conversationType: conversation.type,
      messages: items.reverse(), // oldest first
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error('getMessagesByConversationId error:', err);
    return res.status(500).json({
      message: 'Failed to fetch conversation messages.',
      error: (err as Error).message,
    });
  }
};
// export const getMessages = async (req: AuthenticatedRequest, res: Response) => {
//   try {
//     const meId = req?.user?._id as mongoose.Types.ObjectId;
//     const convId = req.params.conversationId;

//     if (!mongoose.Types.ObjectId.isValid(convId))
//       return res.status(400).json({ message: 'invalid conversation id' });

//     const conv = await Conversation.findById(convId, { participants: 1, type: 1 });
//     if (!conv) return res.status(404).json({ message: 'Conversation not found' });

//     // Block guard: if either side blocked, you can still read history or restrict; here we allow read.
//     const mePart = conv.participants.find((p) => p.userId.toString() === meId.toString());
//     if (!mePart) return res.status(403).json({ message: 'Access denied' });
//     if (mePart.deletedAt) return res.json([]); // hidden from inbox => no messages

//     const cutoff = mePart.hideMessagesBefore || undefined;

//     const messages = await Message.find({
//       conversationId: conv._id,
//       isDeletedForEveryone: false,
//       deletedFor: { $ne: meId },
//       ...(cutoff ? { createdAt: { $gte: cutoff } } : {}),
//     }).sort({ createdAt: 1 });

//     return res.json(messages);
//   } catch (err) {
//     return res.status(500).json({ message: 'Server error', error: err });
//   }
// };

export const markMessagesSeen = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meId = req?.user?._id as mongoose.Types.ObjectId;
    const { messageIds } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0)
      return res.status(400).json({ message: 'messageIds required' });

    await Message.updateMany(
      { _id: { $in: messageIds }, seenBy: { $ne: meId } },
      { $push: { seenBy: meId } },
    );

    return res.json({ message: 'Marked seen' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

export const deleteMessageForMe = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meId = req?.user?._id as mongoose.Types.ObjectId;
    const messageId = req.params.messageId;
    if (!mongoose.Types.ObjectId.isValid(messageId))
      return res.status(400).json({ message: 'invalid message id' });

    await Message.updateOne({ _id: messageId }, { $addToSet: { deletedFor: meId } });
    return res.json({ message: 'Deleted for you' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

// Delete message for everyone (only sender allowed)
export const deleteMessageForEveryone = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meId = req?.user?._id as mongoose.Types.ObjectId;
    const messageId = req.params.messageId;

    if (!mongoose.Types.ObjectId.isValid(messageId))
      return res.status(400).json({ message: 'invalid message id' });

    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ message: 'Message not found' });

    if (msg.senderId.toString() !== meId.toString())
      return res.status(403).json({ message: 'Only sender can delete for everyone' });

    msg.isDeletedForEveryone = true;
    await msg.save();

    // Maintain lastMessage so inbox doesn't show a deleted message
    const conv = await Conversation.findById(msg.conversationId);
    if (conv) {
      const isLast =
        conv.lastMessage?.messageId?.toString &&
        conv.lastMessage.messageId.toString() === messageId.toString();

      if (isLast) {
        const latest = await Message.findOne({
          conversationId: msg.conversationId,
          isDeletedForEveryone: false,
        })
          .sort({ createdAt: -1 })
          .select({ _id: 1, text: 1, createdAt: 1 });

        conv.lastMessage = latest
          ? { messageId: latest._id, text: latest.text || '', sentAt: latest.createdAt }
          : null;

        // Touch updatedAt to reflect the change
        conv.updatedAt = new Date();
        await conv.save();
      }
    }

    return res.json({ message: 'Deleted for everyone' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

export const deleteConversationForUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meId = req?.user?._id as mongoose.Types.ObjectId;
    const convId = req.params.conversationId;

    if (!mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ message: 'invalid conversation id' });

    const conv = await Conversation.findById(convId);
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });

    const now = new Date();
    conv.participants = conv.participants.map((p) => {
      if (p.userId.toString() === meId.toString()) {
        p.deletedAt = now;
        p.hideMessagesBefore = now; // watermark
      }
      return p;
    });

    await conv.save();
    return res.json({ message: 'Conversation deleted for you', conv });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

export const getConversationsData = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const meId = new mongoose.Types.ObjectId(req?.user?._id);

    const convs = await Conversation.aggregate([
      { $match: { participants: { $elemMatch: { userId: meId, deletedAt: null } } } },

      {
        $addFields: {
          otherIds: {
            $map: {
              input: {
                $filter: {
                  input: '$participants',
                  as: 'p',
                  cond: { $ne: ['$$p.userId', meId] },
                },
              },
              as: 'op',
              in: '$$op.userId',
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'otherIds',
          foreignField: '_id',
          as: 'otherUsers',
          pipeline: [{ $project: { username: 1, profilePicture: 1, isActive: 1, lastSeen: 1 } }],
        },
      },
      {
        $project: {
          type: 1,
          groupName: 1,
          groupPhoto: 1,
          lastMessage: 1,
          updatedAt: 1,
          peer: {
            $cond: [
              { $eq: ['$type', 'private'] },
              { $arrayElemAt: ['$otherUsers', 0] },
              '$$REMOVE',
            ],
          },
          members: { $cond: [{ $eq: ['$type', 'group'] }, '$otherUsers', '$$REMOVE'] },
        },
      },
      { $sort: { updatedAt: -1 } },
    ]);

    return res.json(convs);
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

export const getInbox = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 1️⃣ Get userId from token
    const userId = new mongoose.Types.ObjectId(req?.user?._id);

    // 2️⃣ Validate user
    const user = await User.findById(userId).select('_id');
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    // Pagination (optional): ?limit=20&after=<ISO date>
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const after = req.query.after ? new Date(String(req.query.after)) : null;
    const timeFilter = after ? { updatedAt: { $lt: after } } : {};

    // 3️⃣ Fetch conversations where THIS user's participant has deletedAt = null
    const conversations = await Conversation.find({
      ...timeFilter,
      participants: { $elemMatch: { userId, deletedAt: null } },
    })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .select('type participants groupName groupPhoto lastMessage updatedAt createdAt')
      .populate({
        path: 'participants.userId',
        select: 'username profilePicture isActive lastSeen',
        model: 'User',
      })
      .lean();

    // 4️⃣ Shape response for inbox
    const shaped = await Promise.all(
      conversations.map(async (c) => {
        const me = (c.participants as any[]).find((p) => String(p.userId._id) === String(userId));

        const others = (c.participants as any[])
          .filter((p) => String(p.userId._id) !== String(userId))
          .map((p) => ({
            _id: p.userId._id,
            username: p.userId.username,
            profilePicture: p.userId.profilePicture,
            isActive: p.userId.isActive,
            lastSeen: p.userId.lastSeen,
          }));

        const peer = c.type === 'private' ? others[0] : undefined;

        // 🆕 Get last unread message (if any)
        const lastUnread = await Message.findOne({
          conversationId: c._id,
          senderId: { $ne: userId },
          seenBy: { $ne: userId },
        })
          .sort({ createdAt: -1 })
          .select('_id text senderId createdAt')
          .lean();

        return {
          _id: c._id,
          type: c.type,
          groupName: c.groupName,
          groupPhoto: c.groupPhoto,
          lastMessage: c.lastMessage || null,
          lastUnreadMessage: lastUnread || null, // 🆕 added field
          updatedAt: c.updatedAt,
          createdAt: c.createdAt,
          peer, // for private
          participants: others, // for group
          me: me
            ? {
                archivedAt: me.archivedAt ?? null,
                mutedUntil: me.mutedUntil ?? null,
                blocked: !!me.blocked,
                hideMessagesBefore: me.hideMessagesBefore ?? null,
              }
            : null,
        };
      }),
    );

    // 5️⃣ Keyset pagination cursor
    const hasMore = shaped.length > limit;
    const items = hasMore ? shaped.slice(0, limit) : shaped;
    const nextCursor = hasMore ? items[items.length - 1].updatedAt : null;

    return res.json({
      items,
      nextCursor, // pass as ?after=<nextCursor> for next page
    });
  } catch (e) {
    console.error('getInbox error:', e);
    return res.status(500).json({ message: 'Failed to fetch inbox.' });
  }
};

// --- Helper Function for Message Creation ---
const isValidObjectId = (value: unknown): value is string =>
  typeof value === 'string' && Types.ObjectId.isValid(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const createConversation = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  if (!req.user?._id) {
    res.status(401).json({ message: 'Authenticated user context is missing or invalid.' });
    return;
  }

  const authUserId = new Types.ObjectId(req.user._id);
  const { type } = req.body;
  console.log(authUserId, 'authUserId');
  console.log(type, 'type');
  if (type !== 'private' && type !== 'group') {
    res.status(400).json({ message: "Conversation type must be either 'private' or 'group'." });
    return;
  }

  try {
    if (type === 'private') {
      console.log('======= private ++++++++++++');

      await handlePrivateConversation(req, res, authUserId);
      return;
    }
    console.log('======= group ++++++++++++');

    await handleGroupConversation(req, res, authUserId);
  } catch (error) {
    console.error('createConversation error:', error);
    res
      .status(500)
      .json({ message: 'Failed to create conversation.', details: (error as Error).message });
  }
};

const handlePrivateConversation = async (
  req: AuthenticatedRequest,
  res: Response,
  authUserId: Types.ObjectId,
): Promise<void> => {
  const { targetUserId, initialMessage } = req.body;

  if (!isValidObjectId(targetUserId)) {
    res.status(400).json({ message: 'targetUserId must be a valid ObjectId string.' });
    return;
  }

  if (!isNonEmptyString(initialMessage)) {
    res
      .status(400)
      .json({ message: 'An initial message is required to start a private conversation.' });
    return;
  }

  if (targetUserId === authUserId.toHexString()) {
    res.status(400).json({ message: 'You cannot start a private chat with yourself.' });
    return;
  }

  const targetUser = (await User.findById(targetUserId).select('_id isActive')) as any;
  if (!targetUser) {
    res.status(404).json({ message: 'The target user was not found.' });
    return;
  }

  const existingConversation = await Conversation.findOne({
    type: 'private',
    'participants.userId': { $all: [authUserId, new Types.ObjectId(targetUserId)] },
  });

  if (existingConversation) {
    if (existingConversation.participants.length !== 2) {
      res
        .status(409)
        .json({ message: 'A conflicting private conversation exists with invalid participants.' });
      return;
    }

    const authParticipant = existingConversation.participants.find((p) =>
      p.userId.equals(authUserId),
    );
    const targetParticipant = existingConversation.participants.find((p) =>
      p.userId.equals(targetUser?._id),
    );

    if (!authParticipant || !targetParticipant) {
      res.status(409).json({ message: 'Existing conversation is missing participants metadata.' });
      return;
    }

    if (authParticipant.blocked || targetParticipant.blocked) {
      res.status(403).json({ message: 'One of the participants has blocked this conversation.' });
      return;
    }

    if (targetParticipant.deletedAt) {
      res.status(403).json({
        message: 'The other participant has hidden this chat. They must restore it first.',
      });
      return;
    }

    if (authParticipant.deletedAt) {
      authParticipant.deletedAt = null;
      authParticipant.hideMessagesBefore = null;
      await existingConversation.save();
    }

    await existingConversation.populate('participants.userId', 'username profilePicture isActive');

    res.status(200).json({
      message: 'Private conversation restored.',
      conversation: existingConversation,
    });
    return;
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const conversation = await Conversation.create(
        [
          {
            type: 'private',
            participants: [{ userId: authUserId }, { userId: targetUser._id }],
            lastMessage: null,
          },
        ],
        { session },
      );

      const createdConversation = conversation[0];

      const message = await Message.create(
        [
          {
            conversationId: createdConversation._id,
            senderId: authUserId,
            text: initialMessage.trim(),
          },
        ],
        { session },
      );

      createdConversation.lastMessage = {
        messageId: message[0]._id,
        text: message[0].text ?? '',
        sentAt: now,
      };

      await createdConversation.save({ session });
      await createdConversation.populate({
        path: 'participants.userId',
        select: 'username profilePicture isActive',
        options: { session },
      });

      res.status(201).json({
        message: 'Private conversation created successfully.',
        conversation: createdConversation,
      });
    });
  } finally {
    session.endSession();
  }
};

const handleGroupConversation = async (
  req: AuthenticatedRequest,
  res: Response,
  authUserId: Types.ObjectId,
): Promise<void> => {
  const {
    participantIds,
    groupName,
    groupPhoto,
    message: groupMessage,
  } = req.body as {
    participantIds?: unknown;
    groupName?: unknown;
    groupPhoto?: unknown;
    message?: unknown;
  };
  console.log('======= group 1 ++++++++++++');
  if (!Array.isArray(participantIds) || participantIds.length < 2) {
    console.log('[❌ Validation Failed] participantIds invalid:', participantIds);
    res.status(400).json({
      message: 'A group chat requires at least two additional participant IDs besides the creator.',
    });
    return;
  }

  console.log('[✅ Validation Passed] participantIds:', participantIds);

  if (!isNonEmptyString(groupName)) {
    console.log('[❌ Validation Failed] Missing or invalid groupName:', groupName);
    res.status(400).json({ message: 'Group name is required for a group conversation.' });
    return;
  }

  console.log('[✅ Validation Passed] groupName:', groupName);

  // if (groupPhoto !== undefined && !isNonEmptyString(groupPhoto)) {
  //   console.log('[❌ Validation Failed] Invalid groupPhoto:', groupPhoto);
  //   res.status(400).json({
  //     message: 'Group photo, if provided, must be a valid Base64-encoded image string.',
  //   });
  //   return;
  // }

  console.log('[✅ Validation Passed] groupPhoto:', groupPhoto ? '[Provided]' : '[Not Provided]');

  // Filter valid ObjectIds, remove duplicates
  const uniqueParticipantIds = Array.from(new Set(participantIds.filter(isValidObjectId))).map(
    (id) => new Types.ObjectId(id),
  );

  console.log('[🔍 Unique Participant IDs After Filtering]:', uniqueParticipantIds);

  if (uniqueParticipantIds.length !== participantIds.length) {
    console.log(
      '[❌ Validation Failed] Some participant IDs invalid or duplicated:',
      participantIds,
      '=>',
      uniqueParticipantIds,
    );
    res
      .status(400)
      .json({ message: 'All participant IDs must be valid, non-duplicate ObjectId strings.' });
    return;
  }

  if (uniqueParticipantIds.some((id) => id.equals(authUserId))) {
    console.log('[❌ Validation Failed] User included themselves in participantIds:', authUserId);
    res.status(400).json({
      message: 'Do not include yourself in the participantIds list; you are added automatically.',
    });
    return;
  }

  console.log('[✅ Validation Passed] No self-inclusion detected.');

  const participants = await User.find({ _id: { $in: uniqueParticipantIds } }).select(
    '_id isActive',
  );
  console.log(
    '[🔍 Found Participants in DB]:',
    participants.map((u) => u._id),
  );

  if (participants.length !== uniqueParticipantIds.length) {
    console.log('[❌ Validation Failed] Missing users in DB.');
    res.status(404).json({ message: 'One or more participant users could not be found.' });
    return;
  }

  console.log('[✅ Validation Passed] All participants exist and are valid.');

  console.log('======= group 2 ++++++++++++');

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      console.log('======= group 3 ++++++++++++');

      const conversation = await Conversation.create(
        [
          {
            type: 'group',
            groupName: groupName.trim(),
            groupPhoto: groupPhoto ?? null,
            participants: [
              { userId: authUserId },
              ...uniqueParticipantIds.map((id) => ({ userId: id })),
            ],
            lastMessage: null,
          },
        ],
        { session },
      );

      const createdConversation = conversation[0];
      let createdMessage = null;

      if (isNonEmptyString(groupMessage)) {
        const messageDocs = await Message.create(
          [
            {
              conversationId: createdConversation._id,
              senderId: authUserId,
              text: groupMessage.trim(),
            },
          ],
          { session },
        );

        createdMessage = messageDocs[0];

        createdConversation.lastMessage = {
          messageId: createdMessage._id,
          text: createdMessage.text ?? '',
          sentAt: createdMessage.createdAt,
        };

        await createdConversation.save({ session });
      }

      await createdConversation.populate({
        path: 'participants.userId',
        select: 'username profilePicture isActive',
        options: { session },
      });
      console.log(res, 'res from group');

      res.status(201).json({
        message: createdMessage
          ? 'Group conversation and initial message created successfully.'
          : 'Group conversation created successfully.',
        conversation: createdConversation,
      });
    });
  } finally {
    session.endSession();
  }
};

export const softDeleteConversation = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  if (!req.user?._id) {
    res.status(401).json({ message: 'Authenticated user context is missing or invalid.' });
    return;
  }

  const authUserId = new Types.ObjectId(req.user._id);
  const { conversationId } = req.body as { conversationId?: unknown };

  if (!isValidObjectId(conversationId)) {
    res.status(400).json({ message: 'conversationId must be a valid ObjectId string.' });
    return;
  }

  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    res.status(404).json({ message: 'Conversation not found.' });
    return;
  }

  const participant = conversation.participants.find((p) => p.userId.equals(authUserId));

  if (!participant) {
    res.status(403).json({ message: 'You are not a participant in this conversation.' });
    return;
  }

  if (participant.blocked) {
    res.status(403).json({ message: 'Conversation cannot be deleted while blocked.' });
    return;
  }

  const now = new Date();

  if (
    participant.deletedAt &&
    participant.hideMessagesBefore &&
    participant.deletedAt.getTime() === participant.hideMessagesBefore.getTime()
  ) {
    res.status(200).json({ message: 'Conversation already deleted for this user.' });
    return;
  }

  participant.deletedAt = now;
  participant.hideMessagesBefore = now;

  await conversation.save();

  res.status(200).json({
    message: 'Conversation hidden successfully for the current user.',
    conversationId,
    deletedAt: now,
  });
};
