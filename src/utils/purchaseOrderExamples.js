/**
 * ====================================================================
 * PURCHASE ORDER MODULE - USAGE EXAMPLES
 * ====================================================================
 *
 * This file demonstrates how to use the Purchase Order service functions.
 * These examples can be used for testing or as reference for implementation.
 */

import * as purchaseOrderService from "../services/purchaseOrder.service.js";
import Product from "../models/Product.js";

/**
 * Example 1: Create a Supplier
 */
export const exampleCreateSupplier = async (userId) => {
  try {
    const supplierData = {
      name: "ABC Electronics Supplies",
      contactPerson: "John Smith",
      phone: "+1-555-123-4567",
      email: "john.smith@abc-electronics.com",
      address: "123 Industrial Park, Business City, State 12345",
      status: "Active",
      reliabilityScore: 80,
      notes: "Preferred supplier for electronic components",
    };

    const supplier = await purchaseOrderService.createSupplier(
      supplierData,
      userId,
    );

    console.log("✅ Supplier created:", supplier._id);
    return supplier;
  } catch (error) {
    console.error("❌ Error creating supplier:", error.message);
    throw error;
  }
};

/**
 * Example 2: Create a Purchase Order
 */
export const exampleCreatePurchaseOrder = async (
  supplierId,
  products,
  userId,
) => {
  try {
    const purchaseOrderData = {
      supplierId: supplierId,
      status: "Draft", // Start as Draft, then update to Pending
      items: [
        {
          productId: products[0]._id,
          modelId: products[0].models[0]._id, // First variant
          quantity: 100,
          unitPrice: 45.5, // Import price per unit
          // The following will be auto-populated by service:
          // productName, sku, totalPrice
        },
        {
          productId: products[1]._id,
          modelId: products[1].models[0]._id,
          quantity: 50,
          unitPrice: 120.0,
        },
      ],
      shippingCost: 250.0,
      taxAmount: 180.0,
      otherCost: 70.0,
      expectedDeliveryDate: new Date("2026-02-15"),
      notes: "Urgent order for Q1 inventory replenishment",
      warehouseId: null, // Or specify a warehouse ID if multi-warehouse
    };

    const purchaseOrder = await purchaseOrderService.createPurchaseOrder(
      purchaseOrderData,
      userId,
    );

    console.log("✅ Purchase Order created:", purchaseOrder.code);
    console.log("   Total Amount:", purchaseOrder.totalAmount);
    console.log("   Final Amount (with costs):", purchaseOrder.finalAmount);

    return purchaseOrder;
  } catch (error) {
    console.error("❌ Error creating purchase order:", error.message);
    throw error;
  }
};

/**
 * Example 3: Update PO Status to Pending (Ready for Delivery)
 */
export const exampleUpdatePOToPending = async (purchaseOrderId) => {
  try {
    const updated = await purchaseOrderService.updatePurchaseOrder(
      purchaseOrderId,
      {
        status: "Pending",
        notes: "Order confirmed with supplier, awaiting delivery",
      },
    );

    console.log("✅ Purchase Order updated to Pending");
    return updated;
  } catch (error) {
    console.error("❌ Error updating purchase order:", error.message);
    throw error;
  }
};

/**
 * Example 4: Complete Purchase Order (Main Business Logic)
 *
 * This is the core function that:
 * - Calculates landed costs
 * - Updates inventory using Weighted Moving Average
 * - Logs transactions
 * - Uses MongoDB transactions for ACID compliance
 */
export const exampleCompletePurchaseOrder = async (purchaseOrderId, userId) => {
  try {
    console.log("\n🚀 Starting Purchase Order Completion...\n");

    const result = await purchaseOrderService.completePurchaseOrder(
      purchaseOrderId,
      userId,
    );

    console.log("✅ Purchase Order Completed Successfully!\n");
    console.log("📦 Summary:");
    console.log("   PO Code:", result.purchaseOrder.code);
    console.log("   Status:", result.purchaseOrder.status);
    console.log("   Items Processed:", result.summary.totalItemsProcessed);
    console.log("   Quantity Received:", result.summary.totalQuantityReceived);
    console.log("   Total Cost:", `$${result.summary.totalCost.toFixed(2)}`);
    console.log(
      "   Allocated Cost/Unit:",
      `$${result.summary.allocatedCostPerUnit.toFixed(2)}`,
    );

    console.log("\n📊 Updated Products:");
    result.updatedProducts.forEach((prod, index) => {
      console.log(`   ${index + 1}. ${prod.sku}`);
      console.log(`      Stock: ${prod.stockBefore} → ${prod.stockAfter}`);
      console.log(
        `      Cost:  $${prod.costPriceBefore.toFixed(2)} → $${prod.costPriceAfter.toFixed(2)}`,
      );
    });

    console.log("\n📝 Inventory Transactions Created:");
    result.inventoryTransactions.forEach((txn, index) => {
      console.log(
        `   ${index + 1}. ${txn.sku}: +${txn.quantity} units (Stock now: ${txn.stockAfter})`,
      );
    });

    return result;
  } catch (error) {
    console.error("❌ Error completing purchase order:", error.message);
    throw error;
  }
};

/**
 * Example 5: Get Purchase Orders with Filters
 */
export const exampleGetPurchaseOrders = async () => {
  try {
    const filters = {
      status: "Pending",
      page: 1,
      limit: 10,
      sortBy: "expectedDeliveryDate",
      sortOrder: "asc",
    };

    const result = await purchaseOrderService.getPurchaseOrders(filters);

    console.log(`✅ Found ${result.pagination.total} purchase orders`);
    console.log(`   Showing page ${result.pagination.page}`);

    result.purchaseOrders.forEach((po) => {
      console.log(`   - ${po.code}: ${po.status} (${po.items.length} items)`);
    });

    return result;
  } catch (error) {
    console.error("❌ Error fetching purchase orders:", error.message);
    throw error;
  }
};

/**
 * Example 6: Complete Workflow from Start to Finish
 */
export const exampleCompleteWorkflow = async (userId, productIds) => {
  try {
    console.log("=".repeat(60));
    console.log("COMPLETE PURCHASE ORDER WORKFLOW");
    console.log("=".repeat(60));

    // Step 1: Create Supplier
    console.log("\n[STEP 1] Creating Supplier...");
    const supplier = await exampleCreateSupplier(userId);

    // Step 2: Fetch products to order
    console.log("\n[STEP 2] Preparing product list...");
    const products = await Promise.all(
      productIds.map((id) => Product.findById(id)),
    );

    // Step 3: Create Purchase Order
    console.log("\n[STEP 3] Creating Purchase Order...");
    const purchaseOrder = await exampleCreatePurchaseOrder(
      supplier._id,
      products,
      userId,
    );

    // Step 4: Update to Pending (after supplier confirmation)
    console.log("\n[STEP 4] Confirming order with supplier...");
    await exampleUpdatePOToPending(purchaseOrder._id);

    // Simulate waiting for delivery
    console.log("\n[STEP 5] Waiting for goods to arrive...");
    console.log("   (In production, this would be days/weeks)");

    // Step 6: Complete PO (goods arrived)
    console.log("\n[STEP 6] Goods arrived! Completing Purchase Order...");
    const result = await exampleCompletePurchaseOrder(
      purchaseOrder._id,
      userId,
    );

    console.log("\n" + "=".repeat(60));
    console.log("✅ WORKFLOW COMPLETED SUCCESSFULLY");
    console.log("=".repeat(60));

    return result;
  } catch (error) {
    console.error("\n❌ WORKFLOW FAILED:", error.message);
    throw error;
  }
};

/**
 * ====================================================================
 * COST CALCULATION EXAMPLES
 * ====================================================================
 */

/**
 * Example 7: Manual Cost Calculation Demonstration
 * Shows the math behind the Weighted Moving Average formula
 */
export const exampleCostCalculation = () => {
  console.log("\n" + "=".repeat(60));
  console.log("COST CALCULATION EXAMPLE");
  console.log("=".repeat(60));

  // Scenario
  const scenario = {
    currentStock: 100,
    currentCostPrice: 45.0,
    importQuantity: 150,
    importUnitPrice: 50.0,
    shippingCost: 300,
    taxAmount: 200,
    otherCost: 100,
  };

  console.log("\n📊 Scenario:");
  console.log("   Current Stock:", scenario.currentStock);
  console.log("   Current Cost Price:", `$${scenario.currentCostPrice}`);
  console.log("   Import Quantity:", scenario.importQuantity);
  console.log("   Import Unit Price:", `$${scenario.importUnitPrice}`);
  console.log("   Shipping Cost:", `$${scenario.shippingCost}`);
  console.log("   Tax Amount:", `$${scenario.taxAmount}`);
  console.log("   Other Cost:", `$${scenario.otherCost}`);

  // Step 1: Calculate total import quantity
  const totalImportQty = scenario.importQuantity;
  console.log("\n📝 Step 1: Total Import Quantity");
  console.log(`   = ${totalImportQty} units`);

  // Step 2: Calculate allocated cost per unit
  const additionalCosts =
    scenario.shippingCost + scenario.taxAmount + scenario.otherCost;
  const allocatedCostPerUnit = additionalCosts / totalImportQty;
  console.log("\n📝 Step 2: Allocated Cost Per Unit");
  console.log(
    `   = (${scenario.shippingCost} + ${scenario.taxAmount} + ${scenario.otherCost}) / ${totalImportQty}`,
  );
  console.log(`   = $${allocatedCostPerUnit.toFixed(2)}`);

  // Step 3: Calculate landed cost unit
  const landedCostUnit = scenario.importUnitPrice + allocatedCostPerUnit;
  console.log("\n📝 Step 3: Landed Cost Per Unit");
  console.log(
    `   = ${scenario.importUnitPrice} + ${allocatedCostPerUnit.toFixed(2)}`,
  );
  console.log(`   = $${landedCostUnit.toFixed(2)}`);

  // Step 4: Calculate new stock
  const newStock = scenario.currentStock + scenario.importQuantity;
  console.log("\n📝 Step 4: New Stock");
  console.log(`   = ${scenario.currentStock} + ${scenario.importQuantity}`);
  console.log(`   = ${newStock} units`);

  // Step 5: Calculate new cost price (Weighted Moving Average)
  const currentStockValue = scenario.currentStock * scenario.currentCostPrice;
  const importStockValue = scenario.importQuantity * landedCostUnit;
  const newCostPrice = (currentStockValue + importStockValue) / newStock;

  console.log("\n📝 Step 5: New Cost Price (Weighted Moving Average)");
  console.log(
    `   = ((${scenario.currentStock} × $${scenario.currentCostPrice}) + (${scenario.importQuantity} × $${landedCostUnit.toFixed(2)})) / ${newStock}`,
  );
  console.log(
    `   = ($${currentStockValue.toFixed(2)} + $${importStockValue.toFixed(2)}) / ${newStock}`,
  );
  console.log(`   = $${newCostPrice.toFixed(2)}`);

  console.log("\n✅ Final Result:");
  console.log(`   New Stock: ${newStock} units`);
  console.log(`   New Cost Price: $${newCostPrice.toFixed(2)}`);
  console.log(
    `   Profit Margin Impact: ${((newCostPrice / scenario.currentCostPrice - 1) * 100).toFixed(2)}%`,
  );

  console.log("\n" + "=".repeat(60));

  return { newStock, newCostPrice, landedCostUnit, allocatedCostPerUnit };
};

/**
 * Example 8: Edge Case - Zero Stock (New Product)
 */
export const exampleZeroStockCase = () => {
  console.log("\n" + "=".repeat(60));
  console.log("EDGE CASE: ZERO STOCK (NEW PRODUCT)");
  console.log("=".repeat(60));

  const scenario = {
    currentStock: 0,
    currentCostPrice: 0,
    importQuantity: 100,
    importUnitPrice: 40.0,
    additionalCosts: 240, // $2.40 per unit
  };

  const allocatedCostPerUnit =
    scenario.additionalCosts / scenario.importQuantity;
  const landedCostUnit = scenario.importUnitPrice + allocatedCostPerUnit;

  console.log("\n📊 Scenario: First time importing this product");
  console.log("   Current Stock:", scenario.currentStock);
  console.log("   Import Quantity:", scenario.importQuantity);
  console.log("   Import Unit Price:", `$${scenario.importUnitPrice}`);
  console.log("   Additional Costs:", `$${scenario.additionalCosts}`);

  console.log("\n✅ Result:");
  console.log("   Since current stock = 0:");
  console.log("   New Cost Price = Landed Cost Unit");
  console.log(
    `   = $${scenario.importUnitPrice} + $${allocatedCostPerUnit.toFixed(2)}`,
  );
  console.log(`   = $${landedCostUnit.toFixed(2)}`);

  console.log("\n" + "=".repeat(60));

  return { newCostPrice: landedCostUnit };
};

/**
 * ====================================================================
 * EXPORT ALL EXAMPLES
 * ====================================================================
 */
export default {
  exampleCreateSupplier,
  exampleCreatePurchaseOrder,
  exampleUpdatePOToPending,
  exampleCompletePurchaseOrder,
  exampleGetPurchaseOrders,
  exampleCompleteWorkflow,
  exampleCostCalculation,
  exampleZeroStockCase,
};
