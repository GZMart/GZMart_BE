# 🧪 API Test Guide - Manual Copy to Postman

## 📌 Prerequisites

- Server running: `npm run dev` (port 3000)
- Postman installed
- Replace `{{jwt_token}}` with actual JWT token từ login

---

## ✅ Test 1: Get All Orders with Pagination

**Method:** GET

**URL:**
```
http://localhost:3000/api/seller/orders?page=1&limit=10
```

**Headers:**
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

**Query Parameters (tùy chọn):**
```
page: 1
limit: 10
status: pending  (optional: pending, processing, shipped, delivered, etc.)
sortBy: createdAt  (optional: createdAt, newest-first, oldest-first)
```

**Expected Response (200):**
```json
{
  "success": true,
  "total": 5,
  "page": 1,
  "limit": 10,
  "pages": 1,
  "data": [
    {
      "_id": "65a1234567890abcdef12345",
      "orderNumber": "ORD-1704551200000-5432",
      "userId": "65a9876543210fedcba98765",
      "status": "pending",
      "subtotal": 500000,
      "totalPrice": 530000,
      "shippingCost": 30000,
      "tax": 0,
      "discount": 0,
      "paymentMethod": "cash_on_delivery",
      "paymentStatus": "pending",
      "shippingAddress": "123 Nguyễn Hue, Bến Nghé, Hồ Chí Minh",
      "shippingMethod": "standard",
      "items": [],
      "createdAt": "2024-01-06T10:30:00.000Z",
      "updatedAt": "2024-01-06T10:30:00.000Z"
    }
  ]
}
```

---

## ✅ Test 2: Get Orders by Status

**Method:** GET

**URL:**
```
http://localhost:3000/api/seller/orders/status/pending
```

**Headers:**
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

**Valid Status Values:**
- `pending`
- `processing`
- `shipped`
- `delivered`
- `delivered_pending_confirmation`
- `completed`
- `cancelled`
- `refunded`
- `refund_pending`
- `under_investigation`

**Expected Response (200):**
```json
{
  "success": true,
  "total": 3,
  "page": 1,
  "limit": 10,
  "pages": 1,
  "statusCounts": {
    "pending": 3,
    "processing": 2,
    "shipped": 1,
    "delivered": 5,
    "completed": 10,
    "cancelled": 1
  },
  "data": [
    {
      "_id": "65a1234567890abcdef12345",
      "orderNumber": "ORD-1704551200000-5432",
      "status": "pending",
      "totalPrice": 530000,
      "createdAt": "2024-01-06T10:30:00.000Z"
    }
  ]
}
```

---

## ✅ Test 3: Get Order Detail

**Method:** GET

**URL:**
```
http://localhost:3000/api/seller/orders/65a1234567890abcdef12345
```

**Replace `65a1234567890abcdef12345` với thực tế order ID từ Test 1 hoặc 2**

**Headers:**
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "65a1234567890abcdef12345",
    "orderNumber": "ORD-1704551200000-5432",
    "userId": "65a9876543210fedcba98765",
    "status": "pending",
    "subtotal": 500000,
    "shippingCost": 30000,
    "tax": 0,
    "discount": 0,
    "totalPrice": 530000,
    "discountCode": null,
    "shippingAddress": "123 Nguyễn Hue, Bến Nghé, Hồ Chí Minh",
    "shippingMethod": "standard",
    "trackingNumber": null,
    "estimatedDelivery": null,
    "paymentMethod": "cash_on_delivery",
    "paymentStatus": "pending",
    "paymentDate": null,
    "notes": "Giao vào buổi sáng",
    "isActive": true,
    "items": [
      {
        "_id": "65a0987654321fedcba98765",
        "orderId": "65a1234567890abcdef12345",
        "productId": "65a1111111111111111111111",
        "quantity": 2,
        "price": 250000,
        "size": "L",
        "color": "Đen",
        "subtotal": 500000,
        "originalPrice": 300000,
        "isFlashSale": false,
        "createdAt": "2024-01-06T10:30:00.000Z"
      }
    ],
    "createdAt": "2024-01-06T10:30:00.000Z",
    "updatedAt": "2024-01-06T10:30:00.000Z"
  }
}
```

---

## ✅ Test 4: Update Order Status (pending → processing)

**Method:** PUT

**URL:**
```
http://localhost:3000/api/seller/orders/65a1234567890abcdef12345/status
```

**Headers:**
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "newStatus": "processing"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Order status updated to 'processing'",
  "data": {
    "_id": "65a1234567890abcdef12345",
    "orderNumber": "ORD-1704551200000-5432",
    "status": "processing",
    "updatedAt": "2024-01-06T11:45:00.000Z"
  }
}
```

**Error Response (400) - Invalid Transition:**
```json
{
  "success": false,
  "message": "Cannot transition from 'shipped' to 'processing'"
}
```

---

## ✅ Test 5: Update Order Status (processing → shipped)

**Method:** PUT

**URL:**
```
http://localhost:3000/api/seller/orders/65a1234567890abcdef12345/status
```

**Headers:**
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "newStatus": "shipped",
  "trackingNumber": "VN123456789",
  "estimatedDelivery": "2024-01-08T18:00:00Z"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Order status updated to 'shipped'",
  "data": {
    "_id": "65a1234567890abcdef12345",
    "status": "shipped",
    "trackingNumber": "VN123456789",
    "estimatedDelivery": "2024-01-08T18:00:00Z",
    "shipperId": "65a9876543210fedcba98765",
    "updatedAt": "2024-01-06T12:00:00.000Z"
  }
}
```

---

## ✅ Test 6: Update Order Status (shipped → delivered)

**Method:** PUT

**URL:**
```
http://localhost:3000/api/seller/orders/65a1234567890abcdef12345/status
```

**Headers:**
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

**Body (JSON):**
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
    "_id": "65a1234567890abcdef12345",
    "status": "delivered",
    "updatedAt": "2024-01-06T17:30:00.000Z"
  }
}
```

---

## ✅ Test 7: Cancel Order (pending hoặc processing)

**Method:** PUT

**URL:**
```
http://localhost:3000/api/seller/orders/65a1234567890abcdef12345/cancel
```

**Headers:**
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

**Body (JSON):**
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
    "_id": "65a1234567890abcdef12345",
    "status": "cancelled",
    "cancellationReason": "Hết hàng trong kho",
    "cancelledAt": "2024-01-06T11:00:00.000Z",
    "updatedAt": "2024-01-06T11:00:00.000Z"
  }
}
```

**Error Response (400) - Cannot Cancel:**
```json
{
  "success": false,
  "message": "Cannot cancel order with status 'shipped'"
}
```

---

## ✅ Test 8: Generate Delivery Note (HTML)

**Method:** GET

**URL:**
```
http://localhost:3000/api/seller/orders/65a1234567890abcdef12345/delivery-note
```

**Headers:**
```
Authorization: Bearer {{jwt_token}}
```

**Expected Response (200):**
```json
{
  "success": true,
  "html": "<!DOCTYPE html><html lang=\"vi\">...[HTML content]...",
  "orderNumber": "ORD-1704551200000-5432"
}
```

**Cách lưu HTML:**
1. Copy giá trị `html` từ response
2. Tạo file `delivery_note.html` với content từ `html` field
3. Mở file trong browser
4. Dùng `Ctrl+P` (Print) → Save as PDF

---

## 📊 Complete Flow Test Sequence

**Scenario: Xử lý 1 đơn hàng hoàn chỉnh**

### **Step 1: Lấy danh sách pending orders**
```
GET http://localhost:3000/api/seller/orders?status=pending
```
→ Copy `_id` của một order từ response

### **Step 2: Xem chi tiết order**
```
GET http://localhost:3000/api/seller/orders/{ORDER_ID}
```

### **Step 3: Confirm order (pending → processing)**
```
PUT http://localhost:3000/api/seller/orders/{ORDER_ID}/status
Body: { "newStatus": "processing" }
```

### **Step 4: Prepare for shipping (processing → shipped)**
```
PUT http://localhost:3000/api/seller/orders/{ORDER_ID}/status
Body: { 
  "newStatus": "shipped",
  "trackingNumber": "VN123456789",
  "estimatedDelivery": "2024-01-08T18:00:00Z"
}
```

### **Step 5: Mark as delivered (shipped → delivered)**
```
PUT http://localhost:3000/api/seller/orders/{ORDER_ID}/status
Body: { "newStatus": "delivered" }
```

### **Step 6: Verify final status**
```
GET http://localhost:3000/api/seller/orders/{ORDER_ID}
```
→ Should show status = "delivered"

### **Step 7: Generate delivery note**
```
GET http://localhost:3000/api/seller/orders/{ORDER_ID}/delivery-note
```
→ Save HTML to file

---

## 🔍 Valid Status Transitions

```
pending → processing, cancelled
processing → shipped, cancelled
shipped → delivered, refund_pending
delivered → delivered_pending_confirmation
delivered_pending_confirmation → completed, refund_pending
completed → (final)
cancelled → (final)
refund_pending → refunded, under_investigation
refunded → (final)
under_investigation → completed, refunded
```

---

## ❌ Error Handling

### Invalid Status Code (400):
```json
{
  "success": false,
  "message": "Invalid status. Valid statuses: pending, processing, shipped, delivered, ..."
}
```

### Order Not Found (404):
```json
{
  "success": false,
  "message": "Order not found"
}
```

### Authorization Failed (403):
```json
{
  "success": false,
  "message": "Not authorized to access this order"
}
```

### Missing Token (401):
```json
{
  "success": false,
  "message": "Not authorized to access this route"
}
```

---

## 💡 Tips

- **Set variable trong Postman:** Sau khi get list orders, highlight order ID từ response → `Ctrl+Shift+P` → Set as variable
- **Use Pre-request script:** Tự động extract order ID để dùng ở request tiếp theo
- **Check timestamps:** Mỗi status update sẽ update `updatedAt` field
- **PaymentStatus:** Hiện tại mặc định là `pending`, có thể update sau khi integrate payment gateway
