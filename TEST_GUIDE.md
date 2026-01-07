# 🧪 Hướng Dẫn Test API với Postman

## 📋 Chuẩn Bị

### 1. Import Collection vào Postman
- Mở Postman
- Click `File` → `Import`
- Chọn file `Postman_Collection.json`
- Collection sẽ hiển thị 8 endpoints

### 2. Setup Environment Variables
Click tab `Variables` ở trên cùng, set các giá trị:

```
jwt_token = <JWT token của seller>
order_id = <MongoDB order ID>
shipper_id = <MongoDB shipper user ID> (tùy chọn)
```

---

## 🔐 Bước 1: Lấy JWT Token

**Trước hết, bạn cần một JWT token từ login endpoint**

Nếu bạn có login endpoint, request:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seller@example.com",
    "password": "password123"
  }'
```

Response sẽ trả về:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Copy token vào variable `{{jwt_token}}` trong Postman.

---

## 🧪 Cách Test từng API

### **API #1: Get All Orders**

**Mô tả:** Lấy danh sách tất cả đơn hàng của seller

**URL:** `GET /api/seller/orders`

**Query Parameters:**
- `page=1` - Trang thứ 1
- `limit=10` - Lấy 10 orders
- `status=pending` - Filter chỉ orders đang chờ (tùy chọn)
- `sortBy=createdAt` - Sort theo ngày tạo (mới nhất trước)

**Expected Response (200):**
```json
{
  "success": true,
  "total": 25,
  "page": 1,
  "limit": 10,
  "pages": 3,
  "data": [
    {
      "_id": "65a1234567890abcdef12345",
      "orderNumber": "ORD-1704551200000-5432",
      "status": "pending",
      "totalAmount": 500000,
      "buyerId": {
        "_id": "...",
        "fullName": "Nguyễn Văn A",
        "email": "buyer@example.com",
        "phone": "0123456789"
      },
      "createdAt": "2024-01-06T10:30:00Z"
    }
  ]
}
```

---

### **API #2: Get Orders by Status**

**Mô tả:** Lấy danh sách orders theo status cụ thể + đếm mỗi status

**URL:** `GET /api/seller/orders/status/pending`

**Thay `pending` với:** `confirmed`, `shipping`, `delivered`, `cancelled`

**Expected Response (200):**
```json
{
  "success": true,
  "total": 5,
  "statusCounts": {
    "pending": 5,
    "confirmed": 3,
    "shipping": 2,
    "delivered": 20,
    "cancelled": 1
  },
  "data": [...]
}
```

**Error Response (400) - Invalid Status:**
```json
{
  "success": false,
  "message": "Invalid status. Valid statuses: pending, confirmed, shipping, delivered, cancelled"
}
```

---

### **API #3: Get Order Detail**

**Mô tả:** Lấy chi tiết 1 đơn hàng

**URL:** `GET /api/seller/orders/{order_id}`

**Ghi chú:** Thay `{order_id}` với MongoDB ID của order

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "65a1234567890abcdef12345",
    "orderNumber": "ORD-1704551200000-5432",
    "status": "pending",
    "totalAmount": 500000,
    "items": [
      {
        "_id": "...",
        "productName": "MacBook Pro M1",
        "quantity": 1,
        "pricePerUnit": 25000000,
        "discountPercentage": 10,
        "subtotal": 22500000
      }
    ],
    "buyerId": {...},
    "shippingAddress": {...},
    "createdAt": "2024-01-06T10:30:00Z"
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Order not found"
}
```

---

### **API #4: Update Order Status - Confirm**

**Mô tả:** Xác nhận đơn hàng (pending → confirmed)

**URL:** `PUT /api/seller/orders/{order_id}/status`

**Body:**
```json
{
  "newStatus": "confirmed",
  "sellerNotes": "Đã kiểm tra hàng, sẵn sàng giao"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Order status updated to 'confirmed'",
  "data": {
    "_id": "...",
    "status": "confirmed",
    "confirmedAt": "2024-01-06T11:45:00Z",
    "sellerNotes": "Đã kiểm tra hàng, sẵn sàng giao",
    ...
  }
}
```

**Error Response (400) - Invalid Transition:**
```json
{
  "success": false,
  "message": "Cannot transition from 'shipping' to 'confirmed'",
  "validTransitions": ["delivered"]
}
```

---

### **API #5: Update Order Status - Assign Shipper**

**Mô tả:** Chuyển sang trạng thái giao hàng + assign shipper (confirmed → shipping)

**URL:** `PUT /api/seller/orders/{order_id}/status`

**Body:**
```json
{
  "newStatus": "shipping",
  "shipperId": "65a9876543210fedcba98765",
  "estimatedDeliveryDate": "2024-01-08T18:00:00Z",
  "sellerNotes": "Giao cho bạn Minh, SĐT 0987654321"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Order status updated to 'shipping'",
  "data": {
    "_id": "...",
    "status": "shipping",
    "shippingAt": "2024-01-06T12:00:00Z",
    "shipperId": "65a9876543210fedcba98765",
    "estimatedDeliveryDate": "2024-01-08T18:00:00Z",
    ...
  }
}
```

---

### **API #6: Update Order Status - Mark Delivered**

**Mô tả:** Đánh dấu đơn đã giao (shipping → delivered)

**URL:** `PUT /api/seller/orders/{order_id}/status`

**Body:**
```json
{
  "newStatus": "delivered"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Order status updated to 'delivered'",
  "data": {
    "_id": "...",
    "status": "delivered",
    "deliveredAt": "2024-01-06T17:30:00Z",
    ...
  }
}
```

---

### **API #7: Cancel Order**

**Mô tả:** Hủy đơn hàng (chỉ khi pending hoặc confirmed)

**URL:** `PUT /api/seller/orders/{order_id}/cancel`

**Body:**
```json
{
  "reason": "Hết hàng trong kho"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Order cancelled successfully",
  "data": {
    "_id": "...",
    "status": "cancelled",
    "cancelledAt": "2024-01-06T11:00:00Z",
    "cancellationReason": "Hết hàng trong kho",
    ...
  }
}
```

**Error Response (400) - Cannot Cancel:**
```json
{
  "success": false,
  "message": "Cannot cancel order with status 'delivered'"
}
```

---

### **API #8: Generate Delivery Note**

**Mô tả:** In phiếu giao hàng (HTML format)

**URL:** `GET /api/seller/orders/{order_id}/delivery-note`

**Expected Response (200):**
```json
{
  "success": true,
  "html": "<!DOCTYPE html><html lang=\"vi\">...",
  "orderNumber": "ORD-1704551200000-5432"
}
```

**Cách sử dụng HTML:**
1. Copy `html` value từ response
2. Tạo file `.html` tại localhost
3. Mở trong browser để preview
4. Dùng browser's print-to-PDF feature để export PDF

---

## 📊 Luồng Test Hoàn Chỉnh

**Scenario: Xử lý 1 đơn hàng từ pending → delivered**

```
1. GET /api/seller/orders?status=pending
   → Lấy danh sách pending orders
   → Copy order_id từ response

2. GET /api/seller/orders/{order_id}
   → Xem chi tiết đơn

3. PUT /api/seller/orders/{order_id}/status
   Body: { "newStatus": "confirmed", "sellerNotes": "..." }
   → Xác nhận đơn

4. PUT /api/seller/orders/{order_id}/status
   Body: { "newStatus": "shipping", "shipperId": "...", ... }
   → Assign shipper & chuyển sang giao hàng

5. PUT /api/seller/orders/{order_id}/status
   Body: { "newStatus": "delivered" }
   → Đánh dấu đã giao

6. GET /api/seller/orders/status/delivered
   → Verify đơn đã chuyển sang delivered
```

---

## 🔍 Debugging Tips

### Status Code Reference:
- **200** - Thành công
- **400** - Bad request (invalid data/transition)
- **401** - Unauthorized (missing/invalid token)
- **403** - Forbidden (not owner of order)
- **404** - Not found (order không tồn tại)
- **500** - Server error

### Common Errors:

**"Not authorized to access this route"**
- → Kiểm tra JWT token có valid không
- → Token hết hạn? Refresh token

**"Cannot transition from 'X' to 'Y'"**
- → Status transition không hợp lệ
- → Xem validTransitions field trong response

**"Order not found"**
- → Order ID sai
- → Order đã bị xóa

**"Not authorized to view this order"**
- → Seller khác tạo order này
- → Admin có thể xem tất cả

---

## 📝 Notes

- Tất cả endpoint yêu cầu `Authorization: Bearer {token}`
- Seller chỉ có thể quản lý đơn của mình (được validate server-side)
- Status transition được validate theo rules định sẵn
- Timestamps (`confirmedAt`, `shippingAt`, etc.) tự động set khi status thay đổi
