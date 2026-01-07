# 📦 Seller Order Management - API Documentation

## 🎯 Overview
Module quản lý đơn hàng từ phía Seller (Shop). Cho phép Seller xem, xử lý và quản lý trạng thái các đơn hàng.

---

## 🔄 Order Status Flow

```
pending → confirmed → shipping → delivered
   ↓          ↓
 cancelled  cancelled
```

### Status Descriptions:
- **pending** (Chờ xác nhận): Đơn hàng mới được tạo, chờ seller xác nhận
- **confirmed** (Đã xác nhận): Seller đã xác nhận, chuẩn bị giao cho shipper
- **shipping** (Đang giao): Shipper đang giao hàng
- **delivered** (Đã giao): Giao hàng thành công
- **cancelled** (Đã hủy): Đơn hàng bị hủy bởi seller hoặc buyer

---

## 📚 API Endpoints

### 1. Get All Orders (with filters & pagination)
```http
GET /api/seller/orders?page=1&limit=10&status=pending&sortBy=createdAt
```

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Query Parameters:**
- `page` (number): Trang hiện tại (default: 1)
- `limit` (number): Số item trên mỗi trang (default: 10)
- `status` (string): Lọc theo status (optional)
- `sortBy` (string): Sắp xếp theo (createdAt, newest-first, oldest-first, total-high, total-low)

**Response:**
```json
{
  "success": true,
  "total": 25,
  "page": 1,
  "limit": 10,
  "pages": 3,
  "data": [
    {
      "_id": "order123",
      "orderNumber": "ORD-1704551200000-5432",
      "sellerId": "seller123",
      "buyerId": {
        "_id": "buyer123",
        "fullName": "Nguyễn Văn A",
        "email": "a@example.com",
        "phone": "0123456789"
      },
      "items": [...],
      "status": "pending",
      "totalAmount": 500000,
      "createdAt": "2024-01-06T10:30:00Z"
    }
  ]
}
```

---

### 2. Get Orders by Status
```http
GET /api/seller/orders/status/pending?page=1&limit=10
```

**Response:**
```json
{
  "success": true,
  "total": 5,
  "page": 1,
  "limit": 10,
  "pages": 1,
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

---

### 3. Get Order Detail
```http
GET /api/seller/orders/{orderId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "order123",
    "orderNumber": "ORD-1704551200000-5432",
    "sellerId": {...},
    "buyerId": {...},
    "items": [
      {
        "_id": "item123",
        "productId": "prod123",
        "productName": "MacBook Pro M1",
        "quantity": 1,
        "pricePerUnit": 25000000,
        "discountPercentage": 10,
        "subtotal": 22500000
      }
    ],
    "subtotal": 22500000,
    "discount": 2500000,
    "shippingFee": 30000,
    "totalAmount": 20030000,
    "status": "pending",
    "shippingAddress": {
      "fullName": "Nguyễn Văn A",
      "phone": "0123456789",
      "address": "123 Nguyễn Hue",
      "wardName": "Bến Nghé",
      "provinceName": "Hồ Chí Minh"
    },
    "createdAt": "2024-01-06T10:30:00Z"
  }
}
```

---

### 4. Update Order Status
```http
PUT /api/seller/orders/{orderId}/status
```

**Body:**
```json
{
  "newStatus": "confirmed",
  "sellerNotes": "Sẽ giao trong 2 ngày"
}
```

Hoặc khi chuyển sang shipping:
```json
{
  "newStatus": "shipping",
  "shipperId": "shipper123",
  "estimatedDeliveryDate": "2024-01-08T18:00:00Z",
  "sellerNotes": "Giao cho bạn Minh, số điện thoại 0987654321"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order status updated to 'confirmed'",
  "data": {...}
}
```

**Error Response (Invalid Transition):**
```json
{
  "success": false,
  "message": "Cannot transition from 'shipped' to 'confirmed'",
  "validTransitions": ["delivered"]
}
```

---

### 5. Cancel Order
```http
PUT /api/seller/orders/{orderId}/cancel
```

**Body:**
```json
{
  "reason": "Hết hàng"
}
```

**Note:** Chỉ có thể hủy đơn ở status **pending** hoặc **confirmed**

**Response:**
```json
{
  "success": true,
  "message": "Order cancelled successfully",
  "data": {...}
}
```

---

### 6. Generate Delivery Note (HTML/PDF)
```http
GET /api/seller/orders/{orderId}/delivery-note
```

**Response:**
```json
{
  "success": true,
  "html": "<html>...</html>",
  "orderNumber": "ORD-1704551200000-5432"
}
```

**Usage (Frontend):**
```javascript
// Fetch delivery note
const response = await fetch(`/api/seller/orders/${orderId}/delivery-note`, {
  headers: { Authorization: `Bearer ${token}` }
});
const { html } = await response.json();

// Display HTML
document.getElementById('preview').innerHTML = html;

// Print to PDF (using html2pdf library)
html2pdf().set(options).fromString(html).save('phieu_giao_hang.pdf');
```

---

## 🛡️ Authentication & Authorization

### Required Authentication:
- All endpoints require a valid JWT token in the `Authorization` header
- Token format: `Bearer {jwt_token}`

### Role Requirements:
- Only users with role **'shop'** (Seller) or **'admin'** can access order management endpoints
- Sellers can only view/manage their own orders
- Admins can manage all orders

---

## 🔧 Implementation Details

### Database Models:
1. **Order**: Lưu thông tin đơn hàng chính
2. **OrderItem**: Lưu chi tiết từng sản phẩm trong đơn
3. **FlashSale**: Lưu thông tin chương trình giảm giá (tùy chọn)

### Key Fields:

**Order:**
- `orderNumber`: Mã đơn hàng duy nhất (auto-generated)
- `status`: Trạng thái đơn hàng
- `confirmedAt`, `shippingAt`, `deliveredAt`, `cancelledAt`: Timestamps cho mỗi status
- `totalAmount`: Tổng tiền (bao gồm discount & shipping)

**OrderItem:**
- `productId`: Reference đến Product
- `pricePerUnit`: Giá lúc mua
- `discountPercentage`: % giảm giá (nếu có flash sale)
- `subtotal`: Tổng tiền cho item này

---

## 💡 Usage Examples

### Example 1: Get all pending orders
```bash
curl -X GET "http://localhost:5000/api/seller/orders?status=pending" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Example 2: Confirm an order and prepare for shipping
```bash
curl -X PUT "http://localhost:5000/api/seller/orders/order123/status" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "newStatus": "confirmed",
    "sellerNotes": "Đã kiểm tra hàng, sẵn sàng giao"
  }'
```

### Example 3: Assign shipper and move to shipping
```bash
curl -X PUT "http://localhost:5000/api/seller/orders/order123/status" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "newStatus": "shipping",
    "shipperId": "shipper456",
    "estimatedDeliveryDate": "2024-01-08T18:00:00Z"
  }'
```

### Example 4: Cancel an order
```bash
curl -X PUT "http://localhost:5000/api/seller/orders/order123/cancel" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Hết hàng trong kho"
  }'
```

---

## ✅ Next Steps

1. **Create Product Model** (nếu chưa có)
2. **Integrate with Flash Sale Module** (để áp giá khuyến mãi)
3. **Add Email Notifications** (thông báo cho buyer khi order status thay đổi)
4. **Dashboard Analytics** (thống kê doanh thu, sản phẩm bán chạy, v.v.)
5. **PDF Export** (convert delivery note to PDF)

---

## 📝 Notes

- Seller chỉ có thể xem/manage orders của chính họ
- Admin có thể xem/manage tất cả orders
- Các status transition được validate trong `orderStatusRules.js`
- Timestamps tự động được set khi status thay đổi
