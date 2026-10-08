<!-- src/components/ui/TableSkeleton.vue -->
<script setup lang="ts">
withDefaults(defineProps<{
  /** Number of placeholder rows to render. */
  rows?: number;
  /** Number of placeholder columns per row. */
  columns?: number;
}>(), {
  rows: 6,
  columns: 5,
});
</script>

<template>
  <div class="table-wrap" aria-busy="true" aria-live="polite">
    <span class="sr-only">กำลังโหลดข้อมูล...</span>
    <table class="data-table skeleton-table">
      <tbody>
        <tr v-for="row in rows" :key="row">
          <td v-for="column in columns" :key="column">
            <span class="skeleton skeleton-line" :style="{ width: `${45 + ((row * column) % 4) * 14}%` }" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
