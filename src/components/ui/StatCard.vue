<!-- src/components/ui/StatCard.vue -->
<script setup lang="ts">
import type { IconName } from './icons';
import AppIcon from './AppIcon.vue';

withDefaults(defineProps<{
  /** Metric label, kept short and uppercase-friendly. */
  label: string;
  /** Preformatted metric value. */
  value: string | number;
  /** Optional secondary line (context, comparison, unit). */
  hint?: string;
  /** Optional leading icon. */
  icon?: IconName;
}>(), {
  hint: '',
  icon: undefined,
});
</script>

<template>
  <div class="stat-card">
    <span v-if="icon" class="stat-icon">
      <AppIcon :name="icon" :size="18" />
    </span>
    <div>
      <span class="stat-label">{{ label }}</span>
      <span class="stat-value">{{ value }}</span>
      <span v-if="hint" class="stat-hint">{{ hint }}</span>
    </div>
  </div>
</template>
