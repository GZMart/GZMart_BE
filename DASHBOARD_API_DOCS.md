# Dashboard Analytics API Documentation

## Base URL
```
/api/dashboard
```

---

## Authentication
**All endpoints require:**
- Authorization header: `Authorization: Bearer <token>`
- User role: `seller` or `admin`

---

## 1. GET COMPLETE DASHBOARD (Main Overview)
**Endpoint:** `GET /api/dashboard`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy tất cả thông tin dashboard (revenue, best sellers, low stock, order stats, customer stats)

### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "period": "today",
    "revenue": {
      "today": 5000000,
      "thisWeek": 25000000,
      "thisMonth": 100000000,
      "thisYear": 500000000,
      "total": 1200000000
    },
    "bestSellers": [
      {
        "productId": "6694a1c1f4b0e8e5c1234abc",
        "name": "Áo thun cao cấp",
        "originalPrice": 299000,
        "images": ["https://..."],
        "totalSold": 150,
        "totalRevenue": 29850000,
        "averagePrice": 199000
      }
    ],
    "lowStock": [
      {
        "_id": "6694a1c1f4b0e8e5c1234abc",
        "name": "Áo polo",
        "stock": 8,
        "totalModels": 5,
        "activeModels": 4,
        "images": ["https://..."]
      }
    ],
    "orderStats": {
      "total": 350,
      "pending": 20,
      "processing": 50,
      "shipped": 100,
      "delivered": 170,
      "cancelled": 10,
      "averageValue": 2857142
    },
    "customerStats": {
      "totalCustomers": 200,
      "repeatCustomers": 80,
      "newCustomers": 120,
      "repeatedPurchaseRate": 40
    }
  }
}
```

---

## 2. GET REVENUE STATS
**Endpoint:** `GET /api/dashboard/revenue`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy thống kê doanh thu (hôm nay, tuần này, tháng này, năm này)

### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "today": 5000000,
    "thisWeek": 25000000,
    "thisMonth": 100000000,
    "thisYear": 500000000,
    "total": 1200000000
  }
}
```

---

## 3. GET REVENUE OVER TIME
**Endpoint:** `GET /api/dashboard/revenue-trend`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy doanh thu theo thời gian (ngày, tuần, tháng)

### Query Parameters
```json
{
  "period": "daily"  // 'daily', 'weekly', 'monthly' (default: 'daily')
}
```

### Response (200 OK - Daily)
```json
{
  "success": true,
  "period": "daily",
  "data": [
    {
      "_id": "2026-01-13",
      "revenue": 5000000,
      "count": 20
    },
    {
      "_id": "2026-01-12",
      "revenue": 4500000,
      "count": 18
    }
  ]
}
```

### Response (Weekly)
```json
{
  "success": true,
  "period": "weekly",
  "data": [
    {
      "_id": "2026-W02",
      "revenue": 25000000,
      "count": 100
    },
    {
      "_id": "2026-W01",
      "revenue": 20000000,
      "count": 80
    }
  ]
}
```

### Response (Monthly)
```json
{
  "success": true,
  "period": "monthly",
  "data": [
    {
      "_id": "2026-01",
      "revenue": 100000000,
      "count": 400
    },
    {
      "_id": "2025-12",
      "revenue": 95000000,
      "count": 380
    }
  ]
}
```

---

## 4. GET BEST SELLING PRODUCTS
**Endpoint:** `GET /api/dashboard/best-sellers`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy danh sách sản phẩm bán chạy nhất

### Query Parameters
```json
{
  "limit": 5  // (optional) Số sản phẩm muốn lấy, default: 5
}
```

### Response (200 OK)
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "productId": "6694a1c1f4b0e8e5c1234abc",
      "name": "Áo thun cao cấp",
      "originalPrice": 299000,
      "images": ["https://..."],
      "totalSold": 150,
      "totalRevenue": 29850000,
      "averagePrice": 199000
    },
    {
      "productId": "6694a1c1f4b0e8e5c1234abd",
      "name": "Quần jean nam",
      "originalPrice": 599000,
      "images": ["https://..."],
      "totalSold": 120,
      "totalRevenue": 59880000,
      "averagePrice": 499000
    }
  ]
}
```

---

## 5. GET LOW STOCK PRODUCTS (Alert)
**Endpoint:** `GET /api/dashboard/low-stock`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy danh sách sản phẩm có tồn kho thấp (cảnh báo)

### Query Parameters
```json
{
  "threshold": 20,   // (optional) Ngưỡng stock, default: 20
  "limit": 10        // (optional) Số sản phẩm muốn lấy, default: 10
}
```

### Response (200 OK)
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "_id": "6694a1c1f4b0e8e5c1234abc",
      "name": "Áo polo đỏ",
      "stock": 8,
      "totalModels": 5,
      "activeModels": 4,
      "images": ["https://..."],
      "lowestStockModel": {
        "_id": "6694a1c1f4b0e8e5c1234xyz",
        "sku": "APOLO-RED-M",
        "price": 349000,
        "stock": 2,
        "tierIndex": [0, 1],
        "image": "https://...",
        "isActive": true
      }
    }
  ]
}
```

---

## 6. GET ORDER STATISTICS
**Endpoint:** `GET /api/dashboard/order-stats`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy thống kê đơn hàng (tổng, pending, processing, shipped, delivered, cancelled)

### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "total": 350,
    "pending": 20,
    "processing": 50,
    "shipped": 100,
    "delivered": 170,
    "cancelled": 10,
    "averageValue": 2857142
  }
}
```

### Công thức
```
averageValue = (revenue của tất cả orders) / (số orders)
```

---

## 7. GET CUSTOMER STATISTICS
**Endpoint:** `GET /api/dashboard/customer-stats`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy thống kê khách hàng (tổng, repeat, new, repeat rate)

### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "totalCustomers": 200,
    "repeatCustomers": 80,
    "newCustomers": 120,
    "repeatedPurchaseRate": 40
  }
}
```

### Công thức
```
repeatedPurchaseRate (%) = (repeatCustomers / totalCustomers) * 100
```

---

## 8. GET DETAILED PRODUCT ANALYTICS
**Endpoint:** `GET /api/dashboard/product-analytics`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy phân tích chi tiết từng sản phẩm (quantity sold, revenue, profit)

### Query Parameters
```json
{
  "limit": 10  // (optional) Số sản phẩm muốn lấy, default: 10
}
```

### Response (200 OK)
```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "_id": "6694a1c1f4b0e8e5c1234abc",
      "name": "Áo thun cao cấp",
      "originalPrice": 299000,
      "quantitySold": 150,
      "revenue": 29850000,
      "averagePrice": 199000,
      "numberOfOrders": 45,
      "profit": 29850000 - (299000 * 150) = -14850000  // Nếu cost = originalPrice
    }
  ]
}
```

### Ghi chú
- **profit**: Tính dựa trên originalPrice (có thể cần model.costPrice để tính chính xác hơn)
- Sắp xếp theo **revenue** giảm dần

---

## 9. GET SALES TREND
**Endpoint:** `GET /api/dashboard/sales-trend`  
**Access:** Private (Seller, Admin)  
**Description:** Lấy xu hướng bán hàng (số ngày tùy chỉnh)

### Query Parameters
```json
{
  "days": 30  // (optional) Số ngày muốn lấy, default: 30
}
```

### Response (200 OK)
```json
{
  "success": true,
  "period": "Last 30 days",
  "count": 30,
  "data": [
    {
      "_id": "2026-01-13",
      "sales": 20,
      "revenue": 5000000,
      "quantity": 45
    },
    {
      "_id": "2026-01-12",
      "sales": 18,
      "revenue": 4500000,
      "quantity": 42
    }
  ]
}
```

---

## 10. GET COMPARISON STATS (Current vs Previous Period)
**Endpoint:** `GET /api/dashboard/comparison`  
**Access:** Private (Seller, Admin)  
**Description:** So sánh thống kê kỳ hiện tại với kỳ trước

### Query Parameters
```json
{
  "period": "month"  // 'month' hoặc 'week' (default: 'month')
}
```

### Response (200 OK)
```json
{
  "success": true,
  "period": "month",
  "data": {
    "currentPeriod": {
      "orders": 150,
      "revenue": 75000000,
      "quantity": 300
    },
    "previousPeriod": {
      "orders": 120,
      "revenue": 60000000,
      "quantity": 250
    },
    "growth": {
      "orders": 25,        // % tăng đơn hàng
      "revenue": 25,       // % tăng doanh thu
      "quantity": 20       // % tăng số lượng
    }
  }
}
```

### Công thức tính growth
```
growth (%) = ((currentValue - previousValue) / previousValue) * 100
```

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Seller ID is required"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Not authorized to access this route"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "User is not authorized to perform this action"
}
```

---

## Frontend Implementation Examples

### Example 1: Lấy tất cả thống kê dashboard
```javascript
const getDashboard = async (token) => {
  const response = await fetch('/api/dashboard', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### Example 2: Lấy doanh thu theo ngày (30 ngày gần đây)
```javascript
const getRevenueChart = async (token) => {
  const response = await fetch('/api/dashboard/revenue-trend?period=daily', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  // Dữ liệu này có thể dùng cho chart: x-axis là ngày, y-axis là doanh thu
  return data.data.map(item => ({
    date: item._id,
    revenue: item.revenue,
    orders: item.count
  }));
};
```

### Example 3: Lấy sản phẩm bán chạy nhất
```javascript
const getBestSellers = async (token, limit = 5) => {
  const response = await fetch(`/api/dashboard/best-sellers?limit=${limit}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### Example 4: Lấy cảnh báo hàng tồn kho thấp
```javascript
const getLowStockAlert = async (token, threshold = 20) => {
  const response = await fetch(`/api/dashboard/low-stock?threshold=${threshold}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### Example 5: So sánh tháng này vs tháng trước
```javascript
const getMonthComparison = async (token) => {
  const response = await fetch('/api/dashboard/comparison?period=month', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return {
    currentMonth: data.data.currentPeriod,
    previousMonth: data.data.previousPeriod,
    growth: data.data.growth
  };
};
```

---

## Dashboard UI Components

### Recommended Dashboard Layout:

1. **KPI Cards** (Top section)
   - Today Revenue
   - This Month Revenue
   - Total Orders
   - Total Customers
   - Repeat Customer Rate

2. **Charts** (Middle section)
   - Revenue Trend Chart (line/area chart)
   - Order Status Breakdown (pie chart)
   - Best Selling Products (bar chart)

3. **Tables & Alerts** (Bottom section)
   - Best Sellers Table
   - Low Stock Alert Table
   - Sales Trend Table

4. **Comparison Cards**
   - Month-over-Month Growth
   - Week-over-Week Growth

---

## Data Aggregation Details

### Aggregation Pipeline Used:
1. **Revenue Stats**: Sum subtotals from OrderItems grouped by date ranges
2. **Best Sellers**: Group by productId, sum quantities and revenue
3. **Low Stock**: Unwind models, filter by stock < threshold
4. **Order Stats**: Group by order status, count occurrences
5. **Customer Stats**: Track unique userId with purchase count
6. **Sales Trend**: Group by date, sum sales metrics
7. **Comparison**: Compare date ranges with growth calculation

### Key Filters:
- Only counts **paymentStatus = 'paid'** orders
- Only counts **isActive = true** models
- Seller products filtered by **sellerId**
- Orders filtered by seller's products using OrderItem lookup

---

## Performance Notes

- All endpoints use MongoDB aggregation for optimal performance
- Results are calculated real-time (suitable for dashboards)
- For very high-volume stores, consider caching with Redis
- Indexes recommended on: orderId, productId, createdAt, status, paymentStatus
