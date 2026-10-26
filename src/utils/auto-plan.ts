/**
 * Shared quantity math for automatic purchase plans.
 *
 * A plan can either use the quantity derived from its usage history or an
 * explicit per-cycle quantity. Keep this behavior in sync with
 * `supabase/functions/generate-auto-orders/index.ts`, which runs the same
 * calculation on the server.
 */

export type AutoPlanQuantityInput = {
  usage_quantity: number;
  usage_months: number;
  interval_months: number;
  order_quantity?: number | null;
};

/**
 * Quantity for one cycle: average monthly usage × interval, rounded up so the
 * plan never under-orders. Returns 0 when the inputs cannot produce a valid
 * quantity.
 */
export function calculateOrderQuantity(
  usageQuantity: number,
  usageMonths: number,
  intervalMonths: number,
): number {
  const monthly = Number(usageQuantity) / Number(usageMonths);
  const interval = Number(intervalMonths);

  if (!Number.isFinite(monthly) || monthly <= 0 || !Number.isFinite(interval) || interval <= 0)
    return 0;

  return Math.max(1, Math.ceil(monthly * interval));
}

/**
 * Quantity the plan will order: the user's explicit override when it is a
 * positive number, otherwise the calculated quantity.
 */
export function resolveOrderQuantity(plan: AutoPlanQuantityInput): number {
  const override = Number(plan.order_quantity);

  if (plan.order_quantity != null && Number.isFinite(override) && override > 0)
    return override;

  return calculateOrderQuantity(plan.usage_quantity, plan.usage_months, plan.interval_months);
}
