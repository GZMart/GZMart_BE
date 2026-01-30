import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "GZMart API Documentation",
      version: "1.0.0",
      description: "API documentation for GZMart E-commerce Backend System",
      contact: {
        name: "GZMart Support",
        email: "support@gzmart.com",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
      {
        url: "https://your-production-url.com",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter JWT token in format: Bearer <token>",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            message: {
              type: "string",
              example: "Error message",
            },
            error: {
              type: "string",
              example: "Detailed error information",
            },
          },
        },
        User: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            username: {
              type: "string",
              example: "johndoe",
            },
            email: {
              type: "string",
              example: "john@example.com",
            },
            fullName: {
              type: "string",
              example: "John Doe",
            },
            role: {
              type: "string",
              enum: ["buyer", "seller", "admin"],
              example: "buyer",
            },
            phoneNumber: {
              type: "string",
              example: "+84901234567",
            },
            avatar: {
              type: "string",
              example: "https://example.com/avatar.jpg",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        Product: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            productName: {
              type: "string",
              example: "Nike Air Max 2024",
            },
            description: {
              type: "string",
              example: "Premium running shoes",
            },
            price: {
              type: "number",
              example: 2500000,
            },
            discount: {
              type: "number",
              example: 10,
            },
            categoryId: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            brandId: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            images: {
              type: "array",
              items: {
                type: "string",
              },
              example: ["https://example.com/image1.jpg"],
            },
            sellerId: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected"],
              example: "approved",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        Category: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            categoryName: {
              type: "string",
              example: "Sneakers",
            },
            description: {
              type: "string",
              example: "All types of sneakers",
            },
            image: {
              type: "string",
              example: "https://example.com/category.jpg",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        Order: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            userId: {
              type: "string",
              example: "507f1f77bcf86cd799439011",
            },
            orderItems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  productId: {
                    type: "string",
                  },
                  quantity: {
                    type: "number",
                  },
                  price: {
                    type: "number",
                  },
                },
              },
            },
            totalPrice: {
              type: "number",
              example: 5000000,
            },
            status: {
              type: "string",
              enum: [
                "pending",
                "processing",
                "shipping",
                "delivered",
                "cancelled",
              ],
              example: "pending",
            },
            paymentMethod: {
              type: "string",
              enum: ["cod", "payos"],
              example: "payos",
            },
            shippingAddress: {
              type: "object",
              properties: {
                fullName: {
                  type: "string",
                },
                phoneNumber: {
                  type: "string",
                },
                address: {
                  type: "string",
                },
                city: {
                  type: "string",
                },
                district: {
                  type: "string",
                },
              },
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: "Access token is missing or invalid",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Error",
              },
            },
          },
        },
        NotFoundError: {
          description: "Resource not found",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Error",
              },
            },
          },
        },
        ValidationError: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/Error",
              },
            },
          },
        },
      },
    },
    tags: [
      {
        name: "Authentication",
        description: "Authentication and authorization endpoints",
      },
      {
        name: "Products",
        description: "Product management endpoints",
      },
      {
        name: "Categories",
        description: "Category management endpoints",
      },
      {
        name: "Brands",
        description: "Brand management endpoints",
      },
      {
        name: "Cart",
        description: "Shopping cart endpoints",
      },
      {
        name: "Orders",
        description: "Order management endpoints",
      },
      {
        name: "Users",
        description: "User management endpoints",
      },
      {
        name: "Payments",
        description: "Payment processing endpoints",
      },
      {
        name: "Flash Sales",
        description: "Flash sale management endpoints",
      },
      {
        name: "Dashboard",
        description: "Dashboard and analytics endpoints",
      },
      {
        name: "Home",
        description: "Home page data endpoints",
      },
      {
        name: "Search",
        description: "Search functionality endpoints",
      },
      {
        name: "Favourites",
        description: "User favourites endpoints",
      },
      {
        name: "Deals",
        description: "Special deals endpoints",
      },
      {
        name: "Inventory",
        description: "Inventory management endpoints",
      },
      {
        name: "Upload",
        description: "File upload endpoints",
      },
    ],
  },
  apis: ["./src/routes/*.js", "./src/controllers/*.js"], // Đường dẫn đến các file chứa JSDoc comments
};

const swaggerSpec = swaggerJsdoc(options);

export { swaggerUi, swaggerSpec };
