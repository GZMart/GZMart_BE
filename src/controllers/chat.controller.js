import {
  findOrCreateConversation,
  saveMessage,
  getConversationsByUser,
  getMessagesByConversation,
} from "../services/chat.service.js";
import User from "../models/User.js";

// GET /api/chat/conversations?userId=xxx
export const getConversations = async (req, res) => {
  const userId = req.user?._id || req.query.userId;
  if (!userId) return res.status(400).json({ message: "Missing userId" });
  const conversations = await getConversationsByUser(userId);
  res.json(conversations);
};

// GET /api/chat/messages/:conversationId
export const getMessages = async (req, res) => {
  const { conversationId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const messages = await getMessagesByConversation(
      conversationId,
      page,
      limit,
    );
    // If we received 'limit' messages, there MIGHT be more.
    const hasMore = messages.length === limit;
    res.json({
      messages,
      hasMore,
      page,
      limit,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "Error fetching messages" });
  }
};

// POST /api/chat/conversation
export const createOrFindConversation = async (req, res) => {
  const { shopId } = req.body;
  const userId = req.user?._id || req.body.userId; // Ưu tiên dùng user ID từ auth middleware

  console.log("Creating conversation between:", { userId, shopId });

  if (!userId) return res.status(400).json({ message: "Missing userId" });
  if (!shopId) {
    return res.status(400).json({ message: "Missing shopId" });
  }

  // Prevent user from creating a conversation with themselves
  if (userId.toString() === shopId.toString()) {
    return res
      .status(400)
      .json({ message: "Cannot create conversation with yourself" });
  }

  try {
    const { conversation, isNew } = await findOrCreateConversation(
      userId,
      shopId,
    );
    console.log("Created/found conversation:", conversation, "isNew:", isNew);
    res.json({ ...conversation.toObject(), isNew });
  } catch (error) {
    console.error("Error creating conversation:", error);
    res
      .status(500)
      .json({ message: "Error creating conversation", error: error.message });
  }
};

// POST /api/chat/message
export const postMessage = async (req, res) => {
  const { conversationId, sender, receiver, content, type, productInfo } =
    req.body;
  if (!conversationId || !sender || !receiver) {
    return res.status(400).json({ message: "Missing fields" });
  }
  if (type !== "product" && !content) {
    return res.status(400).json({ message: "Missing content" });
  }
  const message = await saveMessage({
    conversationId,
    sender,
    receiver,
    content,
    type,
    productInfo,
  });
  res.json(message);
};

// GET /api/chat/auto-reply
export const getAutoReplySettings = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await User.findById(userId).select("chatSettings");
    res.json(
      user?.chatSettings?.autoReply || {
        isEnabled: false,
        message:
          "Xin chào, cảm ơn bạn đã nhắn tin. Chúng tôi sẽ phản hồi trong giây lát.",
        cooldownHours: 24,
      },
    );
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching chat settings", error: error.message });
  }
};

// PUT /api/chat/auto-reply
export const updateAutoReplySettings = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { isEnabled, message, cooldownHours } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          "chatSettings.autoReply.isEnabled": isEnabled,
          "chatSettings.autoReply.message": message,
          "chatSettings.autoReply.cooldownHours": cooldownHours || 24,
        },
      },
      { new: true, runValidators: true },
    ).select("chatSettings");

    res.json(user?.chatSettings?.autoReply);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating chat settings", error: error.message });
  }
};
