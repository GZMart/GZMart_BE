import express from 'express';
import {
  getConversations,
  getMessages,
  createOrFindConversation,
  postMessage,
} from '../controllers/chat.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect); // All chat routes need authentication

// Get user's conversations
router.get('/conversations', getConversations);
// Get messages for a specific conversation
router.get('/messages/:conversationId', getMessages);
// Create or find a conversation
router.post('/conversation', createOrFindConversation);
// Send a message (HTTP fallback/initialization)
router.post('/message', postMessage);

export default router;
