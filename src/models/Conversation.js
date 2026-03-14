import mongoose from "mongoose";

const ConversationSchema = new mongoose.Schema({
  participants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  ],
  lastMessage: {
    type: String,
    default: "",
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  lastAutoReplyAt: {
    type: Date,
    default: null,
  },
  lastSellerReplyAt: {
    type: Date,
    default: null,
  },
});

export default mongoose.model("Conversation", ConversationSchema);
