import express from "express";
import {
  getConversations,
  getMessages,
  createOrFindConversation,
  postMessage,
  getAutoReplySettings,
  updateAutoReplySettings,
  getUnreadCount,
} from "../controllers/chat.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect); // All chat routes need authentication

// Get user's conversations
router.get("/conversations", getConversations);
// Get messages for a specific conversation
router.get("/messages/:conversationId", getMessages);
// Create or find a conversation
router.post("/conversation", createOrFindConversation);
// Send a message (HTTP fallback/initialization)
router.post("/message", postMessage);

// Auto-reply settings
router.get("/auto-reply", getAutoReplySettings);
router.put("/auto-reply", updateAutoReplySettings);

// Unread message count
router.get("/unread/count", getUnreadCount);

export default router;
