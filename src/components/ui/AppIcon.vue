<!-- src/components/ui/AppIcon.vue -->
<script setup lang="ts">
import type { IconName } from './icons';

import { computed } from 'vue';
import { ICON_PATHS } from './icons';

const props = withDefaults(defineProps<{
  /** Name of the icon to render. */
  name: IconName;
  /** Rendered size in pixels. */
  size?: number;
  /** SVG stroke width. */
  strokeWidth?: number;
}>(), {
  size: 18,
  strokeWidth: 2,
});

const paths = computed<string[]>(() => [...ICON_PATHS[props.name]]);
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  flex-shrink: 0;
}
</style>
