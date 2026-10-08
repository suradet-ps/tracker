<!-- src/components/ui/BrandMark.vue -->
<script setup lang="ts">
withDefaults(defineProps<{
  /** Rendered size in pixels. */
  size?: number;
}>(), {
  size: 32,
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    role="img"
    aria-label="Tracker"
    class="brand-mark"
  >
    <rect width="64" height="64" rx="15" fill="var(--primary)" />
    <path
      d="M20 33.5 28 41.5 44 25.5"
      fill="none"
      stroke="var(--on-primary)"
      stroke-width="6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
