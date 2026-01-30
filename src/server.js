import compression from "compression";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import http from "http";
import morgan from "morgan";
import { Server as SocketIOServer } from "socket.io";
import { corsMiddleware } from "./config/cors.config.js";
import connectDB from "./config/database.js";
import { swaggerUi, swaggerSpec } from "./config/swagger.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import productRoutes from "./routes/product.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import attributeRoutes from "./routes/attribute.routes.js";
import inventoryRoutes from "./routes/inventory.routes.js";
import homeRoutes from "./routes/home.routes.js";
import brandRoutes from "./routes/brand.routes.js";
import dealRoutes from "./routes/deal.routes.js";
import searchRoutes from "./routes/search.routes.js";
import favouriteRoutes from "./routes/favourite.routes.js";
import userRoutes from "./routes/user.routes.js";
import logger from "./utils/logger.js";
import { setupUploadDirectories } from "./utils/setupUploads.js";
import cartRoutes from "./routes/cart.routes.js";
import orderRoutes from "./routes/order.routes.js";
import orderSellerRoutes from "./routes/orderSeller.routes.js";
import flashSaleRoutes from "./routes/flashsale.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import addressRoutes from "./routes/address.routes.js";

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

// Set up upload directories
setupUploadDirectories();

const app = express();

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Apply CORS middleware first - this should handle everything
app.use(corsMiddleware);
// Ensure preflight requests are handled explicitly across all routes
app.options("*", corsMiddleware);

// Enhanced request logging with detailed debug info
// app.use((req, res, next) => {
//   console.log(`=== REQUEST DEBUG ===`);
//   console.log(
//     `${req.method} ${req.path} from ${req.headers.origin || "unknown"}`,
//   );
//   console.log("Host:", req.headers.host);
//   console.log("User-Agent:", req.headers["user-agent"]);
//   console.log("Content-Type:", req.headers["content-type"]);
//   console.log("Content-Length:", req.headers["content-length"]);
//   console.log("Request URL:", req.url);
//   console.log("Request path:", req.path);
//   console.log("Request base URL:", req.baseUrl);
//   console.log("Request original URL:", req.originalUrl);
//   console.log("========================");
//   next();
// });

// Fallback CORS headers (backup if cors middleware fails)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // List of allowed origins
  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    // Azure App Service domains
    process.env.WEBSITE_HOSTNAME
      ? `https://${process.env.WEBSITE_HOSTNAME}`
      : null,
    process.env.WEBSITE_HOSTNAME
      ? `http://${process.env.WEBSITE_HOSTNAME}`
      : null,
  ].filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,PATCH,OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Requested-With,Accept,Origin",
    );
  }

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(200).end();
  }

  next();
});

app.use(morgan("dev"));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(compression());

// Serve static files from uploads directory
app.use("/uploads", express.static("uploads"));

// Default route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to GZMart API" });
});

// Swagger API Documentation
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "GZMart API Documentation",
  }),
);

// Health check endpoint for deployment monitoring
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    version: process.env.npm_package_version || "1.0.0",
  });
});

// Debug endpoint to test tryon route accessibility
app.get("/api/tryon/debug", (req, res) => {
  console.log("=== TRYON DEBUG ENDPOINT ===");
  console.log("Request received at:", new Date().toISOString());
  console.log("Request headers:", req.headers);

  res.status(200).json({
    message: "Tryon endpoint is accessible",
    timestamp: new Date().toISOString(),
    headers: req.headers,
    method: req.method,
    url: req.url,
    path: req.path,
  });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/attributes", attributeRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/home", homeRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/deals", dealRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/favourites", favouriteRoutes);
app.use("/api/users", userRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/seller/orders", orderSellerRoutes);
app.use("/api/flash-sales", flashSaleRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/addresses", addressRoutes);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const HOST = process.env.WEBSITE_HOSTNAME ? "0.0.0.0" : "localhost"; // Azure App Service compatibility
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        // Azure App Service domains
        process.env.WEBSITE_HOSTNAME
          ? `https://${process.env.WEBSITE_HOSTNAME}`
          : null,
        process.env.WEBSITE_HOSTNAME
          ? `http://${process.env.WEBSITE_HOSTNAME}`
          : null,
        // Additional domains for better cross-network support
        // 'https://kicks-shoes-frontend.azurewebsites.net',
        // 'https://kicks-shoes-app.azurewebsites.net',
        // 'https://kicks-shoes-backend.azurewebsites.net',
      ].filter(Boolean);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log("Socket CORS blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

import { setSocketIO } from "./utils/socketIO.js";

// Setup socket handlers
// setupSocketHandlers(io);

// Make io instance globally accessible for controllers
setSocketIO(io);

server.listen(PORT, HOST, () => {
  logger.info(`Server is running on port ${PORT}`);
});

export default app;
export { io, server };
