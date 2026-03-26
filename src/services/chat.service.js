import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";

export const findOrCreateConversation = async (userId, shopId) => {
  let isNew = false;
  let conversation = await Conversation.findOne({
    participants: { $all: [userId, shopId] },
  }).populate("participants", "fullName firstName lastName email avatar role");

  if (!conversation) {
    isNew = true;
    conversation = await Conversation.create({
      participants: [userId, shopId],
    });
    conversation = await conversation.populate(
      "participants",
      "fullName firstName lastName email avatar role",
    );
  }
  return { conversation, isNew };
};

export const saveMessage = async (
  {
    conversationId,
    sender,
    receiver,
    content,
    type = "text",
    productInfo = null,
  },
  isAutoReply = false,
) => {
  const messageData = { conversationId, sender, receiver, type };

  if (type === "product" && productInfo) {
    messageData.productInfo = productInfo;
    messageData.content = `[Sản phẩm] ${productInfo.name}`;
  } else {
    messageData.content = content;
  }

  const message = await Message.create(messageData);

  const updateData = {
    lastMessage:
      type === "product" ? `[Sản phẩm] ${productInfo?.name || ""}` : content,
    lastUpdated: Date.now(),
  };

  if (!isAutoReply) {
    const senderUser = await User.findById(sender).select("role");
    if (senderUser && senderUser.role === "seller") {
      updateData.lastSellerReplyAt = new Date();
    }
  }

  await Conversation.findByIdAndUpdate(conversationId, updateData);
  return message;
};

// In-memory lock to prevent duplicate auto-replies when multiple messages arrive simultaneously
const pendingAutoReplies = new Map();

export const handleAutoReply = async (message, io) => {
  try {
    const { conversationId, sender, receiver } = message;

    // Prevent concurrent auto-replies for the same conversation
    // Lock MUST be acquired synchronously before any await to prevent race conditions
    if (pendingAutoReplies.get(conversationId)) {
      return;
    }
    pendingAutoReplies.set(conversationId, true);

    // Check if receiver is a seller and has autoReply enabled
    const receiverUser =
      await User.findById(receiver).select("role chatSettings");
    if (!receiverUser || receiverUser.role !== "seller") {
      pendingAutoReplies.delete(conversationId);
      return;
    }

    const autoReplySettings = receiverUser.chatSettings?.autoReply;
    if (!autoReplySettings || !autoReplySettings.isEnabled) {
      pendingAutoReplies.delete(conversationId);
      return;
    }

    // Check cooldown in Conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      pendingAutoReplies.delete(conversationId);
      return;
    }

    const now = new Date();
    const cooldownMs = (autoReplySettings.cooldownHours || 24) * 60 * 60 * 1000;

    if (conversation.lastAutoReplyAt) {
      const timeSinceLastAutoReply =
        now.getTime() - conversation.lastAutoReplyAt.getTime();

      if (timeSinceLastAutoReply < cooldownMs) {
        pendingAutoReplies.delete(conversationId);
        return;
      }
    }

    // Send auto reply!
    const autoReplyMsg = {
      conversationId: conversationId,
      sender: receiver, // the seller
      receiver: sender, // the buyer
      content: autoReplySettings.message,
      type: "text",
    };

    // Delay sending by 1.5 seconds to feel natural
    setTimeout(async () => {
      try {
        const savedAutoReply = await saveMessage(autoReplyMsg, true); // true = isAutoReply
        io.to(conversationId).emit("receive_message", savedAutoReply);
        io.to(`user_${sender}`).emit("new_message_notification", {
          conversationId: conversationId,
        });
        // update conversation lastAutoReplyAt
        await Conversation.findByIdAndUpdate(conversationId, {
          lastAutoReplyAt: new Date(),
        });
      } finally {
        // Release lock after auto-reply is sent
        pendingAutoReplies.delete(conversationId);
      }
    }, 1500);
  } catch (err) {
    pendingAutoReplies.delete(message.conversationId);
    console.error("Error handling auto reply:", err);
  }
};

export const getConversationsByUser = async (userId) => {
  return Conversation.find({ participants: userId })
    .sort({ lastUpdated: -1 })
    .populate("participants", "fullName firstName lastName email avatar role"); // Added role and firstName/lastName
};

/**
 * Count unread messages for a user (messages received by this user that are not read).
 * Used by the seller dashboard badge.
 */
export const getUnreadCountByUser = async (userId) => {
  const count = await Message.countDocuments({
    receiver: userId,
    isRead: false,
  });
  return count;
};

export const getMessagesByConversation = async (
  conversationId,
  page = 1,
  limit = 20,
) => {
  const skip = (page - 1) * limit;

  const messages = await Message.find({ conversationId })
    .sort({ timestamp: -1 }) // Get newest first
    .skip(skip)
    .limit(limit)
    .populate("sender", "fullName email avatar")
    .populate("receiver", "fullName email avatar");

  // Reverse back to chronological order
  return messages.reverse();
};
