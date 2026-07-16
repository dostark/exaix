/**
 * @module RefactorExtractFunctionFixtures
 * @path tests/scenario_framework/fixtures/portals/refactor-extract-function/src/order_processor.ts
 * @description Fixture portal: order processing module with monolithic function to refactor.
 */

export interface IOrderItem {
  sku: string;
  quantity: number;
  price: number;
}

export interface IOrder {
  id: string;
  items: IOrderItem[];
  customerId: string;
  shippingAddress: string;
}

export function processOrder(order: IOrder): { success: boolean; total: number; errors: string[] } {
  const errors: string[] = [];
  let total = 0;

  if (!order.id) errors.push("Missing order id");
  if (!order.customerId) errors.push("Missing customer id");
  if (!order.shippingAddress) errors.push("Missing shipping address");

  for (const item of order.items) {
    if (!item.sku) errors.push("Item missing SKU");
    if (item.quantity <= 0) errors.push(`Invalid quantity for ${item.sku || "unknown"}`);
    if (item.price < 0) errors.push(`Negative price for ${item.sku || "unknown"}`);
    total += item.price * item.quantity;
  }

  if (total > 10000) errors.push("Order exceeds $10,000 limit");

  return { success: errors.length === 0, total, errors };
}
