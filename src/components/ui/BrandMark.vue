<!-- src/components/ui/BrandMark.vue -->
<script setup lang="ts">
import { useId } from 'vue';

withDefaults(defineProps<{
  /** Rendered size in pixels. */
  size?: number;
}>(), {
  size: 32,
});

// Unique per instance: the mark can render more than once on a page (sidebar
// plus mobile topbar), and duplicate SVG filter ids would collide.
const shadowId = `brand-shadow-${useId()}`;
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    role="img"
    aria-label="Tracker"
    class="brand-mark"
  >
    <defs>
      <filter :id="shadowId" x="-15%" y="-15%" width="130%" height="130%">
        <feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#000000" flood-opacity="0.4" />
      </filter>
    </defs>

    <g transform="translate(30, 20) scale(1.08)" :filter="`url(#${shadowId})`">
      <path d="M 0 70 L 210 0 L 420 70 L 420 310 L 210 390 L 0 310 Z" fill="#D97706" />
      <path d="M 0 70 L 210 140 L 210 390 L 0 310 Z" fill="#F59E0B" />
      <path d="M 420 70 L 210 140 L 210 390 L 420 310 Z" fill="#B45309" />

      <g transform="translate(240, 170) rotate(12)">
        <rect x="0" y="0" width="120" height="84" rx="10" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="3" />
        <g transform="translate(14, 18)">
          <rect x="0" y="0" width="7" height="48" fill="#1E293B" />
          <rect x="10" y="0" width="3" height="48" fill="#1E293B" />
          <rect x="16" y="0" width="10" height="48" fill="#1E293B" />
          <rect x="30" y="0" width="5" height="48" fill="#1E293B" />
          <rect x="38" y="0" width="14" height="48" fill="#1E293B" />
          <rect x="56" y="0" width="4" height="48" fill="#1E293B" />
          <rect x="63" y="0" width="9" height="48" fill="#1E293B" />
          <rect x="75" y="0" width="6" height="48" fill="#1E293B" />
          <rect x="84" y="0" width="10" height="48" fill="#1E293B" />
        </g>
      </g>
    </g>
  </svg>
</template>
