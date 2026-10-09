<!-- src/components/ui/StatusBadge.vue -->
<script setup lang="ts">
import type { PurchaseOrderStatus } from '@/types/database';

import { computed } from 'vue';

const props = defineProps<{
  status: PurchaseOrderStatus;
}>();

/** Maps an order status to the shared status-chip class. */
const statusClass = computed<string>(() => {
  switch (props.status) {
    case 'รับของแล้ว':
      return 'status-received';
    case 'สั่งแล้ว':
      return 'status-ordered';
    case 'ยกเลิก':
      return 'status-cancelled';
    case 'ต้องสั่งซื้อ':
    default:
      return 'status-pending';
  }
});
</script>

<template>
  <span class="status-badge" :class="statusClass">
    <span class="badge-dot" />
    {{ status }}
  </span>
</template>
