import express from 'express';
import {
  createConversation,
  deleteConversationForUser,
  deleteMessageForEveryone,
  deleteMessageForMe,
  getConversations,
  getConversationsData,
  getInbox,
  getMessagesByConversationId,
  getOrCreatePrivateConversation,
  markMessagesSeen,
  softDeleteConversation
} from '../controllers/chat.controller';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

router.post('/private', protect, getOrCreatePrivateConversation);
router.get('/', protect, getConversations);
router.get('/:conversationId/messages', protect, getMessagesByConversationId);

router.post('/messages/seen', protect, markMessagesSeen);
router.delete('/message/:messageId/me', protect, deleteMessageForMe);
router.delete('/message/:messageId/everyone', protect, deleteMessageForEveryone);

router.delete('/conversation/:conversationId', protect, deleteConversationForUser);
// Get all conversations for the logged-in user
router.get('/inbox', protect, getConversationsData);
router.get('/get-inbox', protect, getInbox);
router.post('/create-con', protect, createConversation);
router.delete('/softdelete', protect, softDeleteConversation);

export default router;
