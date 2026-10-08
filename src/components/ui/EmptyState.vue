<!-- src/components/ui/EmptyState.vue -->
<script setup lang="ts">
import type { IconName } from './icons';
import AppIcon from './AppIcon.vue';

withDefaults(defineProps<{
  /** Icon shown inside the state tile. */
  icon?: IconName;
  /** Short, plain-language title. */
  title: string;
  /** Optional supporting sentence explaining what to do next. */
  description?: string;
  /** Renders the error treatment when true. */
  isError?: boolean;
}>(), {
  icon: 'inbox',
  description: '',
  isError: false,
});
</script>

<template>
  <div class="state-block" :class="{ 'is-error': isError }">
    <span class="state-icon">
      <AppIcon :name="icon" :size="26" :stroke-width="1.6" />
    </span>
    <p class="state-title">
      {{ title }}
    </p>
    <p v-if="description" class="state-desc">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="state-actions">
      <slot />
    </div>
  </div>
</template>
