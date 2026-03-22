/**
 * @fileoverview Service for analyzing product images using Google Gemini API
 */

export const imageSearchService = {
  analyzeProductImage: async (imageBuffer, mimeType) => {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_AI_API_KEY is not set in the environment variables.");
    }

    const model = process.env.GOOGLE_AI_MODEL || "gemini-2.5-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    // Prompt is designed for a general e-commerce store (fashion, electronics, etc.)
    const prompt = `
      You are an expert e-commerce product analysis assistant.
      Your task is to analyze the given image of a product and return clear, structured information about it to help search for similar products in a shopping platform.
      Always respond in strict JSON format without any extra text, comments, markdown blocks, formatting tags, or explanation.
      
      Analyze this image and identify the following attributes of the product shown:

      brand: Attempt to identify the brand if visible (e.g., Nike, Apple, Sony, Chanel, etc.). Return "Unknown" if not clearly identifiable.
      type: Provide a specific category or type of the product (e.g., "sneakers", "t-shirt", "laptop", "watch", "handbag", "smartphone", etc.).
      color: Identify the dominant color or colors. If multiple, join them with a slash (e.g., "Black/White").
      material: Attempt to identify the material if possible (e.g., "leather", "cotton", "plastic", "metal", "glass").
      features: Provide a brief phrase describing key visual features (e.g., "high-top", "v-neck", "wireless", "triple-camera").

      Respond only with a valid JSON object in this exact format:

      {
        "brand": "",
        "type": "",
        "color": "",
        "material": "",
        "features": ""
      }
    `;

    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBuffer.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      }
    };

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json();
        console.error("Gemini API Error Response:", errorBody);
        throw new Error(
          `Gemini API request failed with status ${response.status}: ${errorBody.error?.message || "Unknown error"}`
        );
      }

      const result = await response.json();
      const text = result.candidates[0].content.parts[0].text;
      
      // Attempt to parse the response text as JSON
      let parsedResult;
      try {
        const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
        parsedResult = JSON.parse(jsonString);
      } catch (e) {
        throw new Error("Failed to parse Gemini response as JSON: " + text);
      }

      // Convert to format suitable for broad search
      return {
        category: parsedResult.type,
        productName: parsedResult.type,
        brand: parsedResult.brand !== "Unknown" ? parsedResult.brand : "",
        colors: parsedResult.color ? parsedResult.color.split("/").map(c => c.trim()) : [],
        material: parsedResult.material || "",
        features: parsedResult.features || "",
      };
    } catch (error) {
      console.error("Error analyzing image with Gemini API:", error);
      throw new Error("Failed to analyze image with Gemini API.");
    }
  }
};

export default imageSearchService;
