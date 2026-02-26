import * as chatService from '../services/chat.service.js';

export const getConversations = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const conversations = await chatService.getConversationsByUser(userId);
    res.status(200).json(conversations);
  } catch (error) {
    next(error);
  }
};

export const getMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const messages = await chatService.getMessagesByConversation(conversationId);
    res.status(200).json(messages);
  } catch (error) {
    next(error);
  }
};

export const createOrFindConversation = async (req, res, next) => {
  try {
    const { userId, shopId } = req.body; // Expecting userId and shopId
    // Ensure the requester is one of the participants or logic is secured.
    // For now assuming if buyer calls, userId is them, shopId is target.
    // If seller calls, shopId is them (as user), userId is target.
    
    // Actually, usually req.user._id is one participant.
    const currentUserId = req.user._id;
    const targetId = userId === currentUserId ? shopId : userId; // Simple logic, might need refinement

    const conversation = await chatService.findOrCreateConversation(userId, shopId);
    res.status(200).json(conversation);
  } catch (error) {
    next(error);
  }
};

export const postMessage = async (req, res, next) => {
  try {
    const { conversationId, sender, receiver, content } = req.body;
    const message = await chatService.saveMessage({
      conversationId,
      sender,
      receiver,
      content,
    });
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
};
