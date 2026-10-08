<!-- src/components/Notification.vue -->
<script setup lang="ts">
import type { IconName } from '@/components/ui/icons';

import { computed } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import { useNotificationStore } from '@/stores/notification';

const notificationStore = useNotificationStore();

const iconName = computed<IconName>(() => {
  switch (notificationStore.type) {
    case 'error':
      return 'alertCircle';
    case 'info':
      return 'info';
    case 'success':
    default:
      return 'checkCircle';
  }
});

/** Errors interrupt; everything else waits its turn. */
const isAssertive = computed<boolean>(() => notificationStore.type === 'error');
</script>

<template>
  <div
    class="toast-region"
    :role="isAssertive ? 'alert' : 'status'"
    :aria-live="isAssertive ? 'assertive' : 'polite'"
  >
    <Transition name="toast">
      <div
        v-if="notificationStore.isVisible"
        class="toast"
        :class="`toast-${notificationStore.type}`"
      >
        <AppIcon :name="iconName" :size="18" />
        <div class="toast-body">
          <p class="toast-message">
            {{ notificationStore.message }}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-subtle btn-icon btn-sm"
          aria-label="ปิดการแจ้งเตือน"
          @click="notificationStore.hideNotification()"
        >
          <AppIcon name="x" :size="15" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
