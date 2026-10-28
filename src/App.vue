<!-- src/App.vue -->
<script setup lang="ts">
import type { Session } from '@supabase/supabase-js';
import type { StaffRole } from '@/types/database';

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppSidebar from '@/components/AppSidebar.vue';
import Notification from '@/components/Notification.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import BrandMark from '@/components/ui/BrandMark.vue';
import { useTheme } from '@/composables/use-theme';
import { supabase } from '@/supabase/client';
import { getLocalStorageItem, setLocalStorageItem } from '@/utils/safe-storage';
import { isStaffRole } from '@/utils/staff-role';
import AuthView from '@/views/AuthView.vue';

const SIDEBAR_STORAGE_KEY = 'tracker:sidebar-collapsed';
const DESKTOP_QUERY = '(min-width: 1024px)';

const session = ref<Session | null>(null);
let authSubscription: { unsubscribe: () => void } | null = null;
let desktopMediaQuery: MediaQueryList | null = null;

const route = useRoute();
const router = useRouter();
const { isDark, toggleTheme } = useTheme();

// Profile / access state
const profileRole = ref<StaffRole | null>(null);
const profileLoading = ref<boolean>(false);
const profileError = ref<string>('');
let profileRequest = 0;

const hasDataAccess = computed<boolean>(() => isStaffRole(profileRole.value));

const accessTitle = computed<string>(() => {
  if (profileError.value)
    return 'ตรวจสอบสิทธิ์ไม่สำเร็จ';
  if (profileRole.value === 'pending')
    return 'บัญชีนี้รอการอนุมัติ';
  return 'บัญชีนี้ยังไม่ได้รับสิทธิ์';
});

const accessMessage = computed<string>(() => {
  if (profileError.value)
    return 'ไม่สามารถตรวจสอบสิทธิ์การใช้งานได้ กรุณาลองใหม่อีกครั้ง';
  if (profileRole.value === 'pending')
    return 'ผู้ดูแลระบบต้องกำหนดบทบาทให้บัญชีของคุณก่อนจึงจะใช้งานได้';
  return 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลจัดซื้อ กรุณาติดต่อผู้ดูแลระบบ';
});

async function loadProfile(userId: string): Promise<void> {
  const request = ++profileRequest;
  profileLoading.value = true;
  profileError.value = '';

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (request !== profileRequest)
      return;
    if (error)
      throw error;

    profileRole.value = data?.role ?? null;
  }
  catch (err: unknown) {
    if (request !== profileRequest)
      return;
    profileRole.value = null;
    profileError.value = err instanceof Error ? err.message : 'Unknown error';
    console.error('Failed to load profile:', err);
  }
  finally {
    if (request === profileRequest)
      profileLoading.value = false;
  }
}

function retryProfile(): void {
  if (session.value)
    loadProfile(session.value.user.id);
}

async function handleLogout(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error)
      throw error;
    router.push({ name: 'Auth' });
  }
  catch (err: unknown) {
    console.error('Logout failed:', err);
  }
}

// Shell state
const sidebarOpen = ref<boolean>(false);
const sidebarCollapsed = ref<boolean>(getLocalStorageItem(SIDEBAR_STORAGE_KEY) === '1');

watch(sidebarCollapsed, (value: boolean) => {
  setLocalStorageItem(SIDEBAR_STORAGE_KEY, value ? '1' : '0');
});

// The mobile drawer never survives a navigation.
watch(() => route.fullPath, () => {
  sidebarOpen.value = false;
});

// Lock background scroll while the mobile drawer is open.
watch(sidebarOpen, (open: boolean) => {
  document.body.style.overflow = open ? 'hidden' : '';
});

// Crossing into desktop layout retires the drawer (and its scroll lock).
function handleDesktopChange(event: MediaQueryListEvent): void {
  if (event.matches)
    sidebarOpen.value = false;
}

watch(session, (currentSession) => {
  if (!currentSession) {
    profileRequest += 1;
    profileRole.value = null;
    profileLoading.value = false;
    profileError.value = '';
    return;
  }

  loadProfile(currentSession.user.id);
}, { immediate: true });

onMounted(() => {
  desktopMediaQuery = window.matchMedia(DESKTOP_QUERY);
  desktopMediaQuery.addEventListener('change', handleDesktopChange);

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
  desktopMediaQuery?.removeEventListener('change', handleDesktopChange);
  authSubscription?.unsubscribe();
});
</script>

<template>
  <div v-if="session && profileLoading" class="access-page">
    <section class="access-card" aria-live="polite">
      <BrandMark :size="34" />
      <span class="spinner access-spinner" />
      <p>กำลังตรวจสอบสิทธิ์การใช้งาน...</p>
    </section>
  </div>

  <div v-else-if="session && !hasDataAccess" class="access-page">
    <section class="access-card">
      <BrandMark :size="34" />
      <h1>{{ accessTitle }}</h1>
      <p>{{ accessMessage }}</p>
      <p v-if="session.user.email" class="access-email">
        {{ session.user.email }}
      </p>
      <div class="access-actions">
        <button
          v-if="profileError"
          type="button"
          class="btn btn-primary"
          @click="retryProfile"
        >
          ลองใหม่
        </button>
        <button type="button" class="btn btn-ghost" @click="handleLogout">
          ออกจากระบบ
        </button>
      </div>
    </section>
  </div>

  <div v-else-if="session" class="app-shell" :class="{ 'is-collapsed': sidebarCollapsed }">
    <a class="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>

    <AppSidebar
      :open="sidebarOpen"
      :collapsed="sidebarCollapsed"
      :role="profileRole"
      @close="sidebarOpen = false"
      @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
    />

    <div class="app-main">
      <!-- Compact app bar - mobile and tablet only -->
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
        <RouterView v-slot="{ Component, route: currentRoute }">
          <!-- Keep the list screens alive so returning to them paints the
               previous rows immediately while fresh data loads in the
               background. The route name is the cache key: without it Vue
               would reuse one entry for every screen. QuickOrder is
               intentionally excluded: it is a form and should start from a
               clean catalog every time. -->
          <KeepAlive :include="['OrderView', 'ReceiveView', 'HistoryView', 'AutoPlanView']">
            <component :is="Component" :key="currentRoute.name" />
          </KeepAlive>
        </RouterView>
      </main>
    </div>

    <Notification />
  </div>
  <AuthView v-else />
</template>

<style scoped>
.access-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1.5rem;
  background-color: var(--bg);
}

.access-card {
  width: 100%;
  max-width: 440px;
  padding: 2rem;
  text-align: center;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.access-card h1 {
  margin-top: 1.25rem;
  font-size: var(--text-xl);
}

.access-card p {
  margin-top: 0.75rem;
  color: var(--text-2);
}

.access-email {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.access-spinner {
  display: block;
  margin: 1.25rem auto 0;
}

.access-actions {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

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
  font-weight: 600;
  letter-spacing: -0.01em;
}

.app-content {
  flex-grow: 1;
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
