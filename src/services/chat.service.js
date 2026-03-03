import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

export const findOrCreateConversation = async (userId, shopId) => {
  let conversation = await Conversation.findOne({
    participants: { $all: [userId, shopId] },
  });
  if (!conversation) {
    conversation = await Conversation.create({
      participants: [userId, shopId],
    });
  }
  return conversation;
};

export const saveMessage = async ({ conversationId, sender, receiver, content }) => {
  const message = await Message.create({
    conversationId,
    sender,
    receiver,
    content,
  });
  // Update last message in conversation
  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: content,
    lastUpdated: Date.now(),
  });
  return message;
};

export const getConversationsByUser = async userId => {
  return Conversation.find({ participants: userId })
    .sort({ lastUpdated: -1 })
    .populate('participants', 'fullName firstName lastName email avatar role'); // Added role and firstName/lastName
};

export const getMessagesByConversation = async conversationId => {
  return Message.find({ conversationId })
    .sort({ timestamp: 1 })
    .populate('sender', 'fullName firstName lastName email avatar')
    .populate('receiver', 'fullName firstName lastName email avatar');
};
