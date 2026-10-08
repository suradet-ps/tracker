// src/stores/order-counts.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/supabase/client';

/**
 * Lightweight sidebar counters for the two action queues.
 *
 * Counts are refreshed on shell mount and by the views after they
 * mutate an order, so the navigation always reflects reality without
 * polling.
 */
export const useOrderCountsStore = defineStore('order-counts', () => {
  const pending = ref<number>(0);
  const receiving = ref<number>(0);

  async function refresh(): Promise<void> {
    const [pendingResult, receivingResult] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'ต้องสั่งซื้อ'),
      supabase
        .from('purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'สั่งแล้ว'),
    ]);

    // Fail quiet: stale counters are better than an error in the chrome.
    if (!pendingResult.error) {
      pending.value = pendingResult.count ?? 0;
    }
    if (!receivingResult.error) {
      receiving.value = receivingResult.count ?? 0;
    }
  }

  return {
    pending,
    receiving,
    refresh,
  };
});
