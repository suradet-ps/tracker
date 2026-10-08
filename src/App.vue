<!-- src/App.vue -->
<script setup lang="ts">
import type { Session } from '@supabase/supabase-js';

import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from '@/components/AppSidebar.vue';
import Notification from '@/components/Notification.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import BrandMark from '@/components/ui/BrandMark.vue';
import { useTheme } from '@/composables/use-theme';
import { supabase } from '@/supabase/client';
import AuthView from '@/views/AuthView.vue';

const SIDEBAR_STORAGE_KEY = 'tracker:sidebar-collapsed';

const session = ref<Session | null>(null);
let authSubscription: { unsubscribe: () => void } | null = null;

const route = useRoute();
const { isDark, toggleTheme } = useTheme();

// Shell state
const sidebarOpen = ref<boolean>(false);
const sidebarCollapsed = ref<boolean>(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');

watch(sidebarCollapsed, (value: boolean) => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? '1' : '0');
});

// The mobile drawer never survives a navigation.
watch(() => route.fullPath, () => {
  sidebarOpen.value = false;
});

// Lock background scroll while the mobile drawer is open.
watch(sidebarOpen, (open: boolean) => {
  document.body.style.overflow = open ? 'hidden' : '';
});

onMounted(() => {
  supabase.auth.getSession()
    .then(({ data }) => {
      session.value = data.session;
    })
    .catch((err) => {
      console.error('Failed to retrieve auth session:', err);
    });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
    session.value = newSession;
  });

  authSubscription = subscription;
});

onUnmounted(() => {
  authSubscription?.unsubscribe();
});
</script>

<template>
  <div v-if="session" class="app-shell" :class="{ 'is-collapsed': sidebarCollapsed }">
    <a class="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>

    <AppSidebar
      :open="sidebarOpen"
      :collapsed="sidebarCollapsed"
      @close="sidebarOpen = false"
      @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
    />

    <div class="app-main">
      <!-- Compact app bar — mobile and tablet only -->
      <header class="topbar">
        <button
          type="button"
          class="btn btn-subtle btn-icon"
          aria-label="เปิดเมนูหลัก"
          @click="sidebarOpen = true"
        >
          <AppIcon name="menu" />
        </button>

        <div class="topbar-brand">
          <BrandMark :size="26" />
          <span class="topbar-title">Tracker</span>
        </div>

        <button
          type="button"
          class="btn btn-subtle btn-icon"
          :aria-label="isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'"
          @click="toggleTheme"
        >
          <AppIcon :name="isDark ? 'sun' : 'moon'" />
        </button>
      </header>

      <main id="main-content" class="app-content">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <Notification />
  </div>
  <AuthView v-else />
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-main {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  margin-left: var(--sidebar-w);
  transition: margin-left 0.2s ease;
}

.app-shell.is-collapsed .app-main {
  margin-left: var(--sidebar-w-collapsed);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 900;
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  height: var(--topbar-h);
  padding: 0 0.75rem;
  background-color: var(--surface);
  border-bottom: 1px solid var(--border);
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.topbar-title {
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.app-content {
  flex-grow: 1;
}

/* Navigation stays snappy: the old screen leaves immediately and the new
   one settles in with a short fade — no vertical movement, no blank gap. */
.page-enter-active {
  transition: opacity 0.12s ease;
}

.page-enter-from {
  opacity: 0;
}

@media (max-width: 1023px) {
  .app-main,
  .app-shell.is-collapsed .app-main {
    margin-left: 0;
  }

  .topbar {
    display: flex;
  }
}
</style>
