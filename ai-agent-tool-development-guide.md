# GZMart AI Agent Tool — Hướng dẫn phát triển cho Team

> Tài liệu này dành cho các thành viên trong team cần implement các tính năng AI mới sử dụng hạ tầng LLM + Agentic RAG có sẵn.

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Cấu hình môi trường](#2-cấu-hình-môi-trường)
3. [API Endpoints — Cách gọi LLM & Embedding](#3-api-endpoints--cách-gọi-llm--embedding)
4. [Cách tạo Agent Tool mới (Step-by-step)](#4-cách-tạo-agent-tool-mới-step-by-step)
5. [Cách sử dụng Vector Search (RAG)](#5-cách-sử-dụng-vector-search-rag)
6. [Cách gọi LLM trực tiếp (không qua Agent)](#6-cách-gọi-llm-trực-tiếp-không-qua-agent)
7. [Hướng dẫn implement từng Task AI](#7-hướng-dẫn-implement-từng-task-ai)
8. [Quy tắc & Best Practices](#8-quy-tắc--best-practices)

---

## 1. Tổng quan kiến trúc

```
User Message + Role (buyer/seller/admin)
       │
       ▼
┌─────────────────────┐
│  Intent Router       │  ← Phân loại ý định bằng keyword matching
│  (intentRouter.js)   │     → chọn tools phù hợp
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Tool Executor       │  ← Chạy tools song song (Promise.all)
│  (agentExecutor.js)  │     Mỗi tool query DB → trả về context string
│  ┌────────────────┐  │
│  │ productSearch   │  │  ← Vector search (RAG)
│  │ salesAnalytics  │  │  ← Dashboard queries
│  │ inventoryCheck  │  │  ← Stock levels
│  │ ... 14 tools    │  │
│  └────────────────┘  │
└──────────┬──────────┘
           │  { context: "...", products: [...] }
           ▼
┌─────────────────────┐
│  Prompt Builder      │  ← Ghép tool results vào system prompt
│  + LLM Call          │     Gọi Cloudflare Worker LLM
└──────────┬──────────┘
           │  { response: "..." }
           ▼
┌─────────────────────┐
│  Post-processing     │  ← Format, inject product tags
└─────────────────────┘
```

### File Structure

```
src/services/
├── embedding.service.js        ← Gọi Embedding API (vector hóa text)
├── ai.service.js               ← Entry point cho AI chat
├── dashboard.service.js        ← Analytics queries (reusable)
└── agent/
    ├── tools.js                ← Tool Registry (registerTool, getTool, ...)
    ├── intentRouter.js         ← Phân loại intent → chọn tools
    ├── agentExecutor.js        ← Orchestrate: intent → tools → LLM → response
    └── tools/
        ├── productSearch.js    ← [buyer] Vector + text search
        ├── salesAnalytics.js   ← [seller] Doanh thu, trends
        ├── inventoryCheck.js   ← [seller] Tồn kho
        ├── ... (14 tools)
        └── yourNewTool.js      ← Tool mới của bạn ở đây
```

---

## 2. Cấu hình môi trường

Các biến env cần thiết trong `.env`:

```bash
# LLM Text Generation
AI_API_URL=https://textgeneration.trongducdoan25.workers.dev/
AI_API_TOKEN=ducdeptraivl

# Embedding (vector hóa text → 768 dimensions)
EMBEDDING_API_URL=https://textgeneration.trongducdoan25.workers.dev/embedding
```

Cả 2 endpoint đều dùng chung `AI_API_TOKEN` để xác thực.

---

## 3. API Endpoints — Cách gọi LLM & Embedding

### 3.1 Text Generation (LLM)

**Endpoint:** `POST https://textgeneration.trongducdoan25.workers.dev/`

**Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

**Headers:**
```
Authorization: Bearer <AI_API_TOKEN>
Content-Type: application/json
```

**Request Body:**
```json
{
  "prompt": "Câu hỏi của user",
  "systemPrompt": "System prompt hướng dẫn AI cách trả lời",
  "history": [
    { "role": "user", "content": "tin nhắn trước" },
    { "role": "assistant", "content": "phản hồi trước" }
  ]
}
```

**Response:**
```json
{
  "response": "Nội dung AI trả lời"
}
```

**Code mẫu gọi trực tiếp:**
```javascript
const AI_API_URL = process.env.AI_API_URL;
const AI_API_TOKEN = process.env.AI_API_TOKEN;

async function callLLM(prompt, systemPrompt, history = []) {
  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, systemPrompt, history }),
  });

  if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
  const data = await res.json();
  return data.response;
}

// Sử dụng
const answer = await callLLM(
  "Gợi ý giá bán cho áo hoodie oversize",
  "Bạn là chuyên gia định giá sản phẩm. Dựa vào dữ liệu sau:\n...",
);
```

---

### 3.2 Embedding (Vector hóa text)

**Endpoint:** `POST https://textgeneration.trongducdoan25.workers.dev/embedding`

**Model:** `@cf/baai/bge-base-en-v1.5` (768 dimensions)

**Headers:**
```
Authorization: Bearer <AI_API_TOKEN>
Content-Type: application/json
```

**Request Body (1 text):**
```json
{
  "text": "áo hoodie nam oversize"
}
```

**Request Body (batch — nhiều text cùng lúc):**
```json
{
  "text": ["áo hoodie nam", "quần jean nữ", "giày sneaker"]
}
```

**Response:**
```json
{
  "embeddings": [[0.123, -0.456, ...], [0.789, ...], ...],
  "dimensions": 768
}
```

**Code mẫu — sử dụng service có sẵn:**
```javascript
import embeddingService from "../services/embedding.service.js";

// Embed 1 text (có cache tự động)
const vector = await embeddingService.getEmbedding("áo hoodie nam oversize");
console.log(vector.length); // 768

// Embed nhiều text cùng lúc (nhanh hơn gọi từng cái)
const vectors = await embeddingService.getEmbeddings([
  "áo hoodie nam",
  "quần jean nữ",
  "giày sneaker",
]);
```

---

### 3.3 MongoDB Atlas Vector Search

Khi đã có vector embedding, dùng `$vectorSearch` aggregation để tìm documents tương tự:

```javascript
const queryVector = await embeddingService.getEmbedding("áo khoác mùa đông");

const results = await Product.aggregate([
  {
    $vectorSearch: {
      index: "product_vector_index",   // Tên index trên Atlas
      path: "embedding",               // Field chứa vector trong document
      queryVector: queryVector,         // Vector query (768 dims)
      numCandidates: 50,               // Số candidates để scan
      limit: 10,                       // Số kết quả trả về
      filter: { status: "active" },    // Pre-filter (optional)
    },
  },
  {
    $project: {
      name: 1, rating: 1, sold: 1,
      score: { $meta: "vectorSearchScore" },  // Similarity score (0-1)
    },
  },
]);
```

---

## 4. Cách tạo Agent Tool mới (Step-by-step)

### Bước 1: Tạo file tool

Tạo file `src/services/agent/tools/yourToolName.js`:

```javascript
// src/services/agent/tools/priceSuggestion.js
import Product from "../../../models/Product.js";
import OrderItem from "../../../models/OrderItem.js";
import embeddingService from "../../embedding.service.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, query }) {
  // 1. Query dữ liệu từ DB
  // 2. Xử lý logic
  // 3. Format thành context string

  const context = `=== ĐỀ XUẤT GIÁ SẢN PHẨM ===
📊 Phân tích thị trường:
  ...nội dung...`;

  return { context };
}

registerTool("priceSuggestion", {
  description: "Đề xuất giá bán dựa trên phân tích thị trường",
  roles: ["seller"],           // Ai được dùng: "buyer", "seller", "admin"
  keywords: [                  // Trigger keywords — Intent Router dùng để match
    "giá", "định giá", "price", "pricing",
    "đề xuất giá", "nên bán giá", "giá bao nhiêu",
  ],
  execute,
});
```

### Bước 2: Đăng ký tool trong agentExecutor.js

Thêm 1 dòng import ở đầu file `src/services/agent/agentExecutor.js`:

```javascript
import "./tools/priceSuggestion.js";
```

### Bước 3: Done

Intent Router sẽ tự match keywords và gọi tool khi user nhắn tin liên quan. Không cần sửa thêm file nào.

---

### Anatomy của 1 Tool

```javascript
registerTool("toolName", {
  description: "Mô tả ngắn",          // Cho developer đọc
  roles: ["seller"],                   // Permission: ai dùng được
  keywords: ["từ khóa 1", "keyword"],  // Intent Router match dựa trên đây
  execute,                             // async function(params) → { context, ...data }
});
```

**Params nhận được trong `execute(params)`:**

| Param | Nguồn | Mô tả |
|-------|-------|-------|
| `query` | User message gốc | Nội dung user nhắn |
| `sellerId` | Request body (seller role) | ID của seller đang chat |
| `userId` | Request body (buyer role) | ID của buyer đang chat |
| `days` | Trích xuất từ message | Số ngày (nếu user nhắc) |
| `period` | Trích xuất từ message | "daily"/"weekly"/"monthly"/"yearly" |
| `limit` | Trích xuất từ message | Số lượng kết quả |

**Return format:**

```javascript
return {
  context: "String mô tả kết quả — sẽ được đưa vào system prompt cho LLM",
  products: [],  // Optional: array of product objects (cho buyer tools)
};
```

> **Quan trọng:** `context` phải là **plain text**, format rõ ràng, đủ thông tin để LLM đọc và tạo phản hồi. LLM sẽ KHÔNG được gọi DB — nó chỉ thấy text trong context.

---

## 5. Cách sử dụng Vector Search (RAG)

Nếu tool cần tìm kiếm ngữ nghĩa (semantic search), follow pattern này:

### 5.1 Thêm embedding field vào Model (nếu model mới)

```javascript
// Trong schema definition
embedding: {
  type: [Number],
  default: [],
  select: false,   // Không load mặc định để tiết kiệm RAM
},
embeddingText: {
  type: String,
  select: false,
},
```

### 5.2 Tạo Atlas Vector Search Index

Trên MongoDB Atlas UI → Collection → Search Indexes → Create:

```json
{
  "type": "vectorSearch",
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "status" }
  ]
}
```

### 5.3 Generate embeddings cho data hiện có

```javascript
import embeddingService from "../services/embedding.service.js";

const text = buildTextForEmbedding(document);  // Ghép các fields quan trọng
const vector = await embeddingService.getEmbedding(text);
await Model.updateOne({ _id: doc._id }, { $set: { embedding: vector, embeddingText: text } });
```

### 5.4 Query bằng vector search trong tool

```javascript
const queryVector = await embeddingService.getEmbedding(userQuery);
const results = await Model.aggregate([
  {
    $vectorSearch: {
      index: "your_index_name",
      path: "embedding",
      queryVector,
      numCandidates: 50,
      limit: 10,
    },
  },
]);
```

---

## 6. Cách gọi LLM trực tiếp (không qua Agent)

Nếu tính năng không cần Agent framework (ví dụ: content moderation, auto-categorize), gọi LLM trực tiếp:

```javascript
const AI_API_URL = process.env.AI_API_URL;
const AI_API_TOKEN = process.env.AI_API_TOKEN;

async function analyzeWithLLM(data, instruction) {
  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: JSON.stringify(data),
      systemPrompt: instruction,
      history: [],
    }),
  });

  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  const json = await res.json();
  return json.response;
}

// Ví dụ: Auto-detect fraud
const result = await analyzeWithLLM(
  { productName: "iPhone 15", price: 500000, description: "Hàng chính hãng..." },
  `Phân tích sản phẩm sau và xác định nguy cơ gian lận.
   Trả về JSON: { "riskLevel": "low|medium|high", "reasons": [...] }`,
);
```

---

## 7. Hướng dẫn implement từng Task AI

### Task A: Intelligent Pricing Suggestions

**Mô tả:** Đề xuất giá bán tối ưu cho seller dựa trên phân tích thị trường.

**Approach:** Tạo Agent Tool `priceSuggestion`

**Dữ liệu cần:**
- Giá SP tương tự cùng category → dùng `$vectorSearch` trên products
- Lịch sử bán hàng của SP → query `OrderItem`
- Deal/voucher đang có → query `Deal`, `Voucher`

**Cách implement:**

```javascript
// src/services/agent/tools/priceSuggestion.js
import mongoose from "mongoose";
import Product from "../../../models/Product.js";
import OrderItem from "../../../models/OrderItem.js";
import Deal from "../../../models/Deal.js";
import embeddingService from "../../embedding.service.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, query }) {
  // 1. Tìm SP của seller phù hợp với query
  const sellerProducts = await Product.find({ sellerId, status: "active" })
    .select("name originalPrice rating sold categoryId models.price")
    .lean();

  if (!sellerProducts.length) return { context: "Shop chưa có sản phẩm." };

  // 2. Tìm SP cạnh tranh cùng category bằng vector search
  const queryEmbedding = await embeddingService.getEmbedding(query);
  const competitors = await Product.aggregate([
    {
      $vectorSearch: {
        index: "product_vector_index",
        path: "embedding",
        queryVector: queryEmbedding,
        numCandidates: 50,
        limit: 10,
        filter: { status: "active" },
      },
    },
    {
      $project: {
        name: 1, originalPrice: 1, rating: 1, sold: 1,
        sellerId: 1, "models.price": 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ]);

  // 3. Tính thống kê giá thị trường
  const prices = competitors.flatMap((p) =>
    p.models?.map((m) => m.price).filter(Boolean) || [p.originalPrice]
  ).filter(Boolean);

  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // 4. Phân tích SP bán chạy nhất trong nhóm
  const topSeller = competitors.sort((a, b) => b.sold - a.sold)[0];

  // 5. Format context
  const competitorLines = competitors.slice(0, 5).map((p) => {
    const price = p.models?.[0]?.price || p.originalPrice;
    return `  - ${p.name}: ${price?.toLocaleString("vi-VN")}₫ | ⭐${p.rating} | ${p.sold} đã bán`;
  });

  const context = `=== ĐỀ XUẤT GIÁ SẢN PHẨM ===
📊 Phân tích thị trường (${competitors.length} SP tương tự):
  Giá thấp nhất: ${minPrice.toLocaleString("vi-VN")}₫
  Giá trung bình: ${Math.round(avgPrice).toLocaleString("vi-VN")}₫
  Giá cao nhất: ${maxPrice.toLocaleString("vi-VN")}₫

🏆 SP bán chạy nhất: ${topSeller?.name} (${topSeller?.sold} đã bán, giá ${(topSeller?.models?.[0]?.price || topSeller?.originalPrice)?.toLocaleString("vi-VN")}₫)

📋 Top 5 đối thủ:
${competitorLines.join("\n")}

📦 Sản phẩm của bạn:
${sellerProducts.slice(0, 5).map((p) => `  - ${p.name}: ${(p.models?.[0]?.price || p.originalPrice)?.toLocaleString("vi-VN")}₫ | ${p.sold} đã bán`).join("\n")}`;

  return { context };
}

registerTool("priceSuggestion", {
  description: "Đề xuất giá bán dựa trên phân tích đối thủ và thị trường",
  roles: ["seller"],
  keywords: [
    "giá", "định giá", "price", "pricing", "đề xuất giá",
    "nên bán giá", "giá bao nhiêu", "điều chỉnh giá", "tăng giá", "giảm giá",
    "cạnh tranh", "thị trường",
  ],
  execute,
});
```

Đăng ký trong `agentExecutor.js`:
```javascript
import "./tools/priceSuggestion.js";
```

---

### Task B: Trend Prediction & Restock Alert

**Mô tả:** Dự báo xu hướng bán hàng + cảnh báo cần nhập hàng.

**Approach:** Tạo Agent Tool `demandForecast`

**Dữ liệu cần:**
- Lịch sử bán hàng 90 ngày → `OrderItem` + `Order`
- Tồn kho hiện tại → `Product.models.stock`
- Seasonal patterns → group by week/month

**Cách implement:**

```javascript
// src/services/agent/tools/demandForecast.js
import mongoose from "mongoose";
import Product from "../../../models/Product.js";
import Order from "../../../models/Order.js";
import OrderItem from "../../../models/OrderItem.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId }) {
  if (!sellerId) return { context: "Cần sellerId để dự báo." };

  const sellerOid = new mongoose.Types.ObjectId(sellerId);
  const products = await Product.find({ sellerId: sellerOid, status: "active" })
    .select("_id name models.stock models.sku")
    .lean();

  const productIds = products.map((p) => p._id);
  if (!productIds.length) return { context: "Shop chưa có sản phẩm." };

  // Lấy dữ liệu bán hàng 90 ngày, group theo tuần
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const salesByWeek = await OrderItem.aggregate([
    {
      $lookup: {
        from: "orders", localField: "orderId", foreignField: "_id", as: "order",
      },
    },
    { $unwind: "$order" },
    {
      $match: {
        productId: { $in: productIds },
        "order.createdAt": { $gte: since },
        "order.status": { $in: ["completed", "delivered", "delivered_pending_confirmation"] },
      },
    },
    {
      $group: {
        _id: {
          productId: "$productId",
          week: { $dateToString: { format: "%Y-W%V", date: "$order.createdAt" } },
        },
        qty: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
      },
    },
    { $sort: { "_id.week": 1 } },
  ]);

  // Tính trung bình bán/tuần cho mỗi SP
  const productSales = {};
  salesByWeek.forEach((row) => {
    const pid = row._id.productId.toString();
    if (!productSales[pid]) productSales[pid] = [];
    productSales[pid].push(row.qty);
  });

  const productMap = {};
  products.forEach((p) => { productMap[p._id.toString()] = p; });

  const forecasts = Object.entries(productSales).map(([pid, weeklySales]) => {
    const product = productMap[pid];
    const totalStock = product?.models?.reduce((s, m) => s + (m.stock || 0), 0) || 0;
    const avgPerWeek = weeklySales.reduce((a, b) => a + b, 0) / weeklySales.length;

    // Simple trend: compare last 4 weeks vs previous 4 weeks
    const recent = weeklySales.slice(-4);
    const previous = weeklySales.slice(-8, -4);
    const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const prevAvg = previous.length ? previous.reduce((a, b) => a + b, 0) / previous.length : 0;
    const trend = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100).toFixed(0) : 0;

    const weeksOfStock = avgPerWeek > 0 ? (totalStock / avgPerWeek).toFixed(1) : "∞";
    const needRestock = avgPerWeek > 0 && totalStock / avgPerWeek < 2;

    return {
      name: product?.name || "SP",
      avgPerWeek: avgPerWeek.toFixed(1),
      trend,
      totalStock,
      weeksOfStock,
      needRestock,
    };
  });

  const restockAlerts = forecasts.filter((f) => f.needRestock);
  const trendUp = forecasts.filter((f) => Number(f.trend) > 10);
  const trendDown = forecasts.filter((f) => Number(f.trend) < -10);

  const context = `=== DỰ BÁO NHU CẦU & CẢNH BÁO NHẬP HÀNG ===

🚨 CẦN NHẬP HÀNG GẤP (${restockAlerts.length} SP):
${restockAlerts.map((f) => `  ⚠️ ${f.name}: còn ${f.totalStock} SP (${f.weeksOfStock} tuần), bán TB ${f.avgPerWeek}/tuần`).join("\n") || "  ✅ Không có SP nào cần nhập gấp"}

📈 XU HƯỚNG TĂNG (${trendUp.length} SP):
${trendUp.map((f) => `  🔥 ${f.name}: +${f.trend}% so với tháng trước, bán TB ${f.avgPerWeek}/tuần`).join("\n") || "  Không có"}

📉 XU HƯỚNG GIẢM (${trendDown.length} SP):
${trendDown.map((f) => `  ${f.name}: ${f.trend}% so với tháng trước, bán TB ${f.avgPerWeek}/tuần`).join("\n") || "  Không có"}

📊 CHI TIẾT TẤT CẢ SP:
${forecasts.map((f) => `  ${f.needRestock ? "🔴" : "🟢"} ${f.name} | ${f.avgPerWeek}/tuần | Trend: ${f.trend}% | Tồn: ${f.totalStock} (${f.weeksOfStock} tuần)`).join("\n")}`;

  return { context };
}

registerTool("demandForecast", {
  description: "Dự báo nhu cầu và cảnh báo nhập hàng",
  roles: ["seller"],
  keywords: [
    "dự báo", "forecast", "predict", "nhu cầu",
    "nhập hàng", "restock", "bổ sung", "sắp hết",
    "xu hướng", "trend", "tuần tới", "tháng tới",
  ],
  execute,
});
```

---

### Task C: Automated Product Categorization via Vision API

**Mô tả:** Tự động phân loại sản phẩm dựa trên hình ảnh và mô tả.

**Approach:** Gọi LLM trực tiếp (không cần Agent tool, dùng trong product creation flow).

> **Lưu ý:** LLM hiện tại (`llama-3.3-70b`) là text-only, không hỗ trợ Vision. Có 2 cách:
> 1. **Text-based categorization:** Dùng tên + mô tả SP → LLM phân loại (implement được ngay)
> 2. **Vision-based:** Cần thêm Vision model vào Cloudflare Worker (ví dụ: `@cf/meta/llama-3.2-11b-vision-instruct`)

**Text-based approach (implement được ngay):**

```javascript
// src/services/productCategorization.service.js
import Category from "../models/Category.js";

const AI_API_URL = process.env.AI_API_URL;
const AI_API_TOKEN = process.env.AI_API_TOKEN;

async function suggestCategory(productName, productDescription) {
  const categories = await Category.find({ status: "active" })
    .select("name slug parentId")
    .lean();

  const categoryList = categories.map((c) => `- ${c.name} (ID: ${c._id})`).join("\n");

  const systemPrompt = `Bạn là hệ thống phân loại sản phẩm. Dựa vào tên và mô tả sản phẩm, chọn danh mục PHÙ HỢP NHẤT từ danh sách bên dưới.

DANH MỤC CÓ SẴN:
${categoryList}

Trả về ĐÚNG FORMAT JSON (không markdown):
{"categoryId": "<ID>", "categoryName": "<tên>", "confidence": "high|medium|low"}`;

  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: `Tên: ${productName}\nMô tả: ${productDescription?.slice(0, 500)}`,
      systemPrompt,
      history: [],
    }),
  });

  const data = await res.json();
  try {
    return JSON.parse(data.response);
  } catch {
    return { categoryId: null, categoryName: null, confidence: "low" };
  }
}

export { suggestCategory };
```

**Vision-based (cần thêm endpoint vào Cloudflare Worker):**

Thêm route `/vision` vào Worker:
```javascript
// Trong Cloudflare Worker
async function handleVision(request, env) {
  const body = await request.json();
  const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
    messages: [
      { role: "system", content: body.systemPrompt || "Describe this image." },
      { role: "user", content: body.prompt, images: body.images },
    ],
  });
  return json({ response: result.response });
}
```

---

### Task D: Automated Fraud Detection & Content Moderation

**Mô tả:** Tự động phát hiện sản phẩm gian lận và kiểm duyệt nội dung.

**Approach:** Gọi LLM trực tiếp trong product creation/update middleware.

```javascript
// src/services/contentModeration.service.js
const AI_API_URL = process.env.AI_API_URL;
const AI_API_TOKEN = process.env.AI_API_TOKEN;

async function moderateProduct(product) {
  const systemPrompt = `Bạn là hệ thống kiểm duyệt sản phẩm e-commerce. Phân tích sản phẩm và phát hiện:
1. Giá bất thường (quá rẻ so với thị trường → có thể lừa đảo)
2. Tên/mô tả chứa từ ngữ vi phạm, spam, hoặc gây hiểu nhầm
3. Sản phẩm cấm bán (thuốc, vũ khí, hàng giả...)
4. Keyword stuffing (nhồi từ khóa không liên quan)

Trả về ĐÚNG FORMAT JSON:
{
  "approved": true/false,
  "riskLevel": "low|medium|high",
  "flags": ["lý do 1", "lý do 2"],
  "suggestion": "Gợi ý sửa (nếu có)"
}`;

  const productInfo = `Tên: ${product.name}
Giá: ${product.originalPrice}₫
Mô tả: ${product.description?.replace(/<[^>]*>/g, "").slice(0, 500)}
Brand: ${product.brand || "N/A"}
Tags: ${product.tags?.join(", ") || "N/A"}`;

  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: productInfo,
      systemPrompt,
      history: [],
    }),
  });

  const data = await res.json();
  try {
    return JSON.parse(data.response);
  } catch {
    return { approved: true, riskLevel: "low", flags: [], suggestion: null };
  }
}

export { moderateProduct };
```

**Sử dụng trong middleware hoặc service:**

```javascript
// Trong product.service.js hoặc route
import { moderateProduct } from "../services/contentModeration.service.js";

// Khi seller tạo/sửa sản phẩm
const moderation = await moderateProduct(productData);
if (!moderation.approved) {
  throw new Error(`Sản phẩm bị từ chối: ${moderation.flags.join(", ")}`);
}
if (moderation.riskLevel === "high") {
  // Đánh dấu cần admin review
  productData.status = "pending_review";
}
```

---

## 8. Quy tắc & Best Practices

### DO
- `context` string phải đủ thông tin cho LLM tạo phản hồi tốt
- Dùng emoji + format rõ ràng trong context (LLM đọc dễ hơn)
- Dùng `Promise.all` khi query nhiều collection cùng lúc
- Luôn có fallback khi tool fail (`try/catch` → return context lỗi)
- Keywords trong tool càng specific càng tốt (tránh trigger sai)
- Dùng `embeddingService` có sẵn thay vì gọi API trực tiếp (có cache)

### DON'T
- Đừng trả context quá dài (> 10KB) — LLM sẽ bỏ sót thông tin
- Đừng gọi LLM bên trong tool — tool chỉ query DB, LLM được gọi 1 lần duy nhất ở cuối bởi `agentExecutor`
- Đừng hardcode API URL/token — luôn lấy từ `process.env`
- Đừng quên thêm `import "./tools/yourTool.js"` trong `agentExecutor.js`
- Đừng dùng role `"buyer"` cho tool seller/admin — Intent Router sẽ filter theo role

### Checklist khi tạo tool mới

- [ ] File tạo trong `src/services/agent/tools/`
- [ ] Có `registerTool()` ở cuối file
- [ ] `roles` đúng (buyer/seller/admin)
- [ ] `keywords` đủ cover các cách user có thể hỏi
- [ ] `execute()` return `{ context: "string" }`
- [ ] Thêm import trong `agentExecutor.js`
- [ ] Test bằng cách chat thử với keyword matching

---

## Liên hệ

- **LLM Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Cloudflare Workers AI)
- **Embedding Model:** `@cf/baai/bge-base-en-v1.5` (768 dimensions)
- **Worker URL:** `https://textgeneration.trongducdoan25.workers.dev/`
- **Endpoints:** `/` (text gen), `/embedding` (vectors)
- **Auth:** `Bearer <AI_API_TOKEN>` header
