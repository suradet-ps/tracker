import type { NotificationPayload, NotificationType } from '@/types/database';

// src/stores/notification.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';

/** How long each toast stays on screen before auto-hiding. */
const AUTO_HIDE_MS: Record<NotificationType, number> = {
  success: 3_500,
  info: 4_500,
  error: 6_000,
};

const TRANSITION_DURATION_MS = 250;

export const useNotificationStore = defineStore('notification', () => {
  const message = ref<string>('');
  const type = ref<NotificationType>('success');
  const isVisible = ref<boolean>(false);

  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (autoHideTimer !== null) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    if (resetTimer !== null) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  function showNotification(payload: NotificationPayload): void {
    clearTimers();

    message.value = payload.message;
    type.value = payload.type ?? 'success';
    isVisible.value = true;

    autoHideTimer = setTimeout(() => {
      hideNotification();
    }, AUTO_HIDE_MS[type.value]);
  }

  function hideNotification(): void {
    clearTimers();
    isVisible.value = false;

    // Reset state after the CSS transition completes
    resetTimer = setTimeout(() => {
      message.value = '';
      type.value = 'success';
    }, TRANSITION_DURATION_MS);
  }

  return {
    message,
    type,
    isVisible,
    showNotification,
    hideNotification,
  };
});
