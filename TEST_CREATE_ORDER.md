# 🧪 Hướng Dẫn Test API Tạo Order

## ⚠️ Vấn đề Hiện Tại
Lỗi: `userId: Cast to ObjectId failed` - userId phải là một ObjectId hợp lệ từ MongoDB, không phải string bất kỳ.

## ✅ Giải Pháp

### Step 1: Lấy danh sách User hợp lệ
**GET** `http://localhost:3000/api/orders/test/users`

Response:
```json
{
  "success": true,
  "message": "Use one of these _id values as userId in your order creation request",
  "data": [
    {
      "_id": "65f7a1234567890abcdef001",
      "fullName": "Nguyen Van A",
      "email": "user1@example.com",
      "phone": "0901234567",
      "role": "customer"
    },
    ...
  ]
}
```

### Step 2: Tạo Order với userId hợp lệ
**POST** `http://localhost:3000/api/orders`

Lấy `_id` từ Step 1 và dùng làm `userId`:

```json
{
  "userId": "65f7a1234567890abcdef001",
  "subtotal": 500000,
  "shippingCost": 30000,
  "tax": 50000,
  "discount": 0,
  "totalPrice": 580000,
  "shippingAddress": "123 Nguyễn Hữu Cảnh, Bình Thạnh, TP.HCM",
  "paymentMethod": "cash_on_delivery",
  "shippingMethod": "standard",
  "notes": "Giao vào chiều",
  "items": [
    {
      "productId": "65f7a1234567890abcdef002",
      "quantity": 2,
      "price": 250000,
      "size": "L",
      "color": "Đỏ",
      "isFlashSale": false
    }
  ]
}
```

### Lưu ý quan trọng:
- **Nếu không có user trong database**: Bạn cần tạo user trước hoặc kiểm tra database có dữ liệu không
- **userId phải là ObjectId hợp lệ** từ MongoDB (24 ký tự hex)
- **productId cũng phải hợp lệ** nếu bạn muốn liên kết với Product model

## 🔧 Nếu Database Trống

Nếu bạn không có user nào trong database, hãy:

1. Kiểm tra MongoDB connection: Chạy `npm run dev` và xem log
2. Tạo test user qua MongoDB directly hoặc tạo endpoint seed

## 📋 Các API Test Khác

**GET** `/api/orders` - Lấy danh sách order
```
http://localhost:3000/api/orders?page=1&limit=10&status=pending
```

**GET** `/api/orders/:orderId` - Chi tiết order
```
http://localhost:3000/api/orders/{orderId}
```

**PUT** `/api/orders/:orderId/status` - Cập nhật trạng thái
```json
{
  "newStatus": "processing",
  "notes": "Đơn đã được xác nhận"
}
```

**GET** `/api/orders/:orderId/delivery-note` - In phiếu giao hàng

---

## 📌 Summary
1. Gọi `GET /api/orders/test/users` để lấy userId hợp lệ
2. Copy `_id` và dùng trong request `POST /api/orders`
3. OrderNumber sẽ tự động sinh (ORD-{timestamp}-{random})
