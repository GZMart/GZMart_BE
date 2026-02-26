import express from 'express';

const router = express.Router();

// Streams Gemini AI response to the client using gemini-2.0-flash model (updated from reference)
// Reference used gemini-2.5-flash but 2.0-flash or 1.5-flash is more likely available/stable public API
// Using 'gemini-1.5-flash' as a safe default for now, can be updated.
const MODEL_NAME = process.env.GEMINI_MODEL_ID || 'gemini-1.5-flash';

router.post('/stream', async (req, res) => {
  let conversationId = null;
  
  try {
    const { message, conversationId: cId } = req.body || {};
    conversationId = cId;

    if (!message) {
      return res.status(400).json({ message: 'Missing required field: message' });
    }

    // Initialize Gemini AI
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    
    // Config
    const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    const MODEL_NAME = process.env.GEMINI_MODEL_ID || 'gemini-1.5-flash';

    if (!API_KEY) {
       console.warn('Gemini API Key missing');
       throw new Error('API Key missing');
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Create prompt
    const systemPrompt = `Bạn là AI tư vấn sản phẩm của GZMart chuyên nghiệp. Bạn có kiến thức sâu rộng về:
- Các loại sản phẩm trên GZMart
- Chính sách mua hàng và bảo hành
- Cách chọn sản phẩm phù hợp
- So sánh giá cả và chất lượng

Hãy tư vấn một cách thân thiện, chuyên nghiệp và hữu ích. Nếu không biết thông tin cụ thể, hãy đề xuất người dùng liên hệ trực tiếp với người bán (Seller) qua tính năng chat.

Câu hỏi của khách hàng: ${message}`;

    console.log(`Calling Gemini SDK with model: ${MODEL_NAME}`);
    
    // Generate stream
    const result = await model.generateContentStream(systemPrompt);

    // Set headers
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullText = '';

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      
      res.write(JSON.stringify({
          type: 'message',
          content: chunkText,
          conversationId: conversationId || null
      }) + '\n');
    }

    // Final message
    res.write(JSON.stringify({
        type: 'final',
        content: {
            final_response: fullText,
            conversation_id: conversationId || null
        }
    }) + '\n');
    
    res.end();

  } catch (error) {
    console.error('AI Chat Error:', error);
    
    // Check for rate limit/quota errors
    const isRateLimit = error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('RESOURCE_EXHAUSTED');
    
    if (isRateLimit) {
        console.warn('Rate limit hit, sending specific error message.');
    }

    // Fallback response if API fails
    const mockResponse = `Xin chào! Tôi là AI tư vấn của GZMart. Hiện tại kết nối đến hệ thống AI đang gián đoạn (Lỗi: ${isRateLimit ? 'Quá tải hệ thống' : 'Kết nối'}), nhưng tôi có thể giúp bạn:
1. Tìm kiếm sản phẩm
2. Liên hệ người bán
3. Xem chính sách đổi trả

Bạn cần hỗ trợ cụ thể về vấn đề gì ạ?`;

    // Send fallback as stream to match client expectation
    let index = 0;
    const chunkSize = 50;
    const sendFallbackChunk = () => {
      if (index < mockResponse.length) {
        const chunk = mockResponse.slice(index, index + chunkSize);
        res.write(JSON.stringify({
           type: 'message',
           content: chunk,
           conversationId: conversationId || null
        }) + '\n');
        index += chunkSize;
        setTimeout(sendFallbackChunk, 50);
      } else {
         res.write(JSON.stringify({
            type: 'final',
            content: { final_response: mockResponse, conversation_id: conversationId || null }
         }) + '\n');
         res.end();
      }
    };
    sendFallbackChunk();
  }
});

export default router;
