<!-- src/components/ui/AppModal.vue -->
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';

const props = withDefaults(defineProps<{
  /** Accessible dialog title, also rendered in the header. */
  title: string;
  /** Max width of the dialog. */
  size?: 'sm' | 'md' | 'lg';
}>(), {
  size: 'md',
});

const emit = defineEmits<{
  close: [];
}>();

const modalRef = ref<HTMLElement | null>(null);
const previousOverflow = ref<string>('');
const titleId = `app-modal-title-${Math.random().toString(36).slice(2, 9)}`;

// The element focused before the dialog opened, restored on close.
let previouslyFocused: HTMLElement | null = null;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(): HTMLElement[] {
  if (!modalRef.value)
    return [];
  return Array.from(modalRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }

  if (event.key !== 'Tab')
    return;

  const elements = focusableElements();
  if (elements.length === 0)
    return;

  const first = elements[0]!;
  const last = elements[elements.length - 1]!;
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !modalRef.value?.contains(active))) {
    event.preventDefault();
    last.focus();
  }
  else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown);
  previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  previousOverflow.value = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  await nextTick();
  const [firstElement] = focusableElements();
  (firstElement ?? modalRef.value)?.focus();
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.body.style.overflow = previousOverflow.value;

  // Return focus where it was so keyboard users keep their place.
  if (previouslyFocused && document.contains(previouslyFocused))
    previouslyFocused.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        ref="modalRef"
        class="modal"
        :class="`modal-${props.size}`"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <header class="modal-header">
          <h2 :id="titleId" class="modal-title">
            {{ title }}
          </h2>
          <button type="button" class="btn btn-subtle btn-icon" aria-label="ปิดหน้าต่าง" @click="emit('close')">
            <AppIcon name="x" />
          </button>
        </header>

        <div class="modal-body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-sm {
  max-width: 420px;
}

.modal-md {
  max-width: 640px;
}

.modal-lg {
  max-width: 860px;
}
</style>
