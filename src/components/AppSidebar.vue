<!-- src/components/AppSidebar.vue -->
<script setup lang="ts">
import type { User } from '@supabase/supabase-js';
import type { IconName } from '@/components/ui/icons';

import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppIcon from '@/components/ui/AppIcon.vue';
import BrandMark from '@/components/ui/BrandMark.vue';
import { useTheme } from '@/composables/use-theme';
import { useOrderCountsStore } from '@/stores/order-counts';
import { supabase } from '@/supabase/client';

const props = defineProps<{
  /** Whether the mobile drawer is open. */
  open: boolean;
  /** Whether the desktop rail is collapsed to icons. */
  collapsed: boolean;
}>();

const emit = defineEmits<{
  close: [];
  toggleCollapse: [];
}>();

type NavItem = {
  name: string;
  label: string;
  icon: IconName;
  badge?: 'pending' | 'receiving';
};

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'งานประจำวัน',
    items: [
      { name: 'QuickOrder', label: 'สร้างใบสั่งซื้อด่วน', icon: 'zap' },
      { name: 'Order', label: 'รายการต้องสั่งซื้อ', icon: 'clipboardList', badge: 'pending' },
      { name: 'Receive', label: 'รายการรอรับของ', icon: 'truck', badge: 'receiving' },
    ],
  },
  {
    label: 'ข้อมูล',
    items: [
      { name: 'History', label: 'ประวัติการสั่งซื้อ', icon: 'history' },
    ],
  },
];

const router = useRouter();
const counts = useOrderCountsStore();
const { isDark, toggleTheme } = useTheme();

const user = ref<User | null>(null);

const userInitial = computed<string>(() =>
  (user.value?.email ?? '?').charAt(0).toUpperCase(),
);

function badgeValue(badge: NavItem['badge']): number {
  if (badge === 'pending')
    return counts.pending;
  if (badge === 'receiving')
    return counts.receiving;
  return 0;
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

onMounted(async () => {
  const { data } = await supabase.auth.getUser();
  user.value = data.user;
  counts.refresh();
});
</script>

<template>
  <div class="sidebar-layer">
    <!-- Mobile scrim -->
    <Transition name="scrim">
      <div v-if="props.open" class="sidebar-scrim" @click="emit('close')" />
    </Transition>

    <aside class="sidebar" :class="{ 'is-open': props.open, 'is-collapsed': props.collapsed }">
      <header class="sidebar-head">
        <router-link :to="{ name: 'Order' }" class="brand" @click="emit('close')">
          <BrandMark :size="30" />
          <span class="brand-text">
            <span class="brand-name">Tracker</span>
            <span class="brand-sub">งานเภสัชกรรม รพ.สระโบสถ์</span>
          </span>
        </router-link>

        <button
          type="button"
          class="btn btn-subtle btn-icon btn-sm collapse-toggle"
          :class="{ 'is-flipped': props.collapsed }"
          :aria-label="props.collapsed ? 'ขยายเมนู' : 'ย่อเมนู'"
          :title="props.collapsed ? 'ขยายเมนู' : 'ย่อเมนู'"
          @click="emit('toggleCollapse')"
        >
          <AppIcon name="panelLeft" :size="16" />
        </button>

        <button
          type="button"
          class="btn btn-subtle btn-icon btn-sm drawer-close"
          aria-label="ปิดเมนู"
          @click="emit('close')"
        >
          <AppIcon name="x" :size="16" />
        </button>
      </header>

      <nav class="sidebar-nav" aria-label="เมนูหลัก">
        <template v-for="section in NAV_SECTIONS" :key="section.label">
          <p class="nav-section">
            {{ section.label }}
          </p>
          <router-link
            v-for="item in section.items"
            :key="item.name"
            :to="{ name: item.name }"
            class="nav-item"
            :title="props.collapsed ? item.label : undefined"
            @click="emit('close')"
          >
            <AppIcon :name="item.icon" :size="18" />
            <span class="nav-label">{{ item.label }}</span>
            <span
              v-if="item.badge && badgeValue(item.badge) > 0"
              class="badge badge-count nav-badge"
            >
              {{ badgeValue(item.badge) }}
            </span>
          </router-link>
        </template>
      </nav>

      <footer class="sidebar-foot">
        <button
          type="button"
          class="nav-item theme-item"
          :title="props.collapsed ? (isDark ? 'โหมดสว่าง' : 'โหมดมืด') : undefined"
          @click="toggleTheme"
        >
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
          <span class="nav-label">{{ isDark ? 'โหมดสว่าง' : 'โหมดมืด' }}</span>
        </button>

        <div class="user-card">
          <span class="user-avatar" aria-hidden="true">{{ userInitial }}</span>
          <span class="user-meta">
            <span class="user-email" :title="user?.email ?? ''">{{ user?.email ?? '-' }}</span>
            <span class="user-role">ผู้ใช้งานระบบ</span>
          </span>
          <button
            type="button"
            class="btn btn-subtle btn-icon logout-btn"
            aria-label="ออกจากระบบ"
            title="ออกจากระบบ"
            @click="handleLogout"
          >
            <AppIcon name="logOut" :size="17" />
          </button>
        </div>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.sidebar {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1400;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-w);
  background-color: var(--surface);
  border-right: 1px solid var(--border);
  transition:
    width 0.2s ease,
    transform 0.24s ease;
}

.sidebar.is-collapsed {
  width: var(--sidebar-w-collapsed);
}

/* ─── Header ─── */
.sidebar-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.9rem 0.9rem 0.75rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.brand:hover {
  text-decoration: none;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-name {
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.brand-sub {
  color: var(--text-3);
  font-size: 0.68rem;
  white-space: nowrap;
}

.collapse-toggle {
  margin-left: auto;
  color: var(--text-3);
}

.drawer-close {
  display: none;
  margin-left: auto;
  color: var(--text-3);
}

/* ─── Navigation ─── */
.sidebar-nav {
  flex-grow: 1;
  overflow-y: auto;
  padding: 0.5rem 0.6rem 1rem;
}

.nav-section {
  padding: 0.9rem 0.5rem 0.35rem;
  color: var(--text-3);
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  min-height: 40px;
  padding: 0.45rem 0.65rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-2);
  font-size: var(--text-base);
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.nav-item + .nav-item {
  margin-top: 2px;
}

.nav-item:hover {
  background-color: var(--surface-3);
  color: var(--text);
  text-decoration: none;
}

.nav-item.router-link-active {
  background-color: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.nav-label {
  flex-grow: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-badge {
  background-color: var(--primary);
  color: var(--on-primary);
}

.nav-item.router-link-active .nav-badge {
  background-color: var(--primary);
  color: var(--on-primary);
}

/* ─── Footer ─── */
.sidebar-foot {
  padding: 0.75rem 0.6rem calc(0.85rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
}

.user-card {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.5rem;
  padding: 0.55rem 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--surface-2);
}

.user-avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background-color: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
  font-size: var(--text-sm);
}

.user-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex-grow: 1;
}

.user-email {
  font-size: var(--text-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  color: var(--text-3);
  font-size: 0.68rem;
}

.logout-btn {
  color: var(--text-3);
}

.logout-btn:hover {
  color: var(--danger);
  background-color: var(--danger-soft);
}

/* ─── Collapsed rail ─── */
.sidebar.is-collapsed .brand-text,
.sidebar.is-collapsed .nav-label,
.sidebar.is-collapsed .nav-section,
.sidebar.is-collapsed .user-meta,
.sidebar.is-collapsed .nav-badge {
  display: none;
}

.sidebar.is-collapsed .collapse-toggle {
  margin-left: 0;
}

.collapse-toggle .icon {
  transition: transform 0.2s ease;
}

.collapse-toggle.is-flipped .icon {
  transform: rotate(180deg);
}

/* The rail stacks its brand and expand control so the toggle stays reachable. */
@media (min-width: 1024px) {
  .sidebar.is-collapsed .sidebar-head {
    flex-direction: column;
    align-items: center;
    gap: 0.45rem;
    padding-inline: 0.5rem;
  }
}

.sidebar.is-collapsed .nav-item {
  justify-content: center;
  padding-inline: 0.4rem;
}

.sidebar.is-collapsed .user-card {
  justify-content: center;
  background: none;
  padding-inline: 0;
}

/* ─── Mobile drawer ─── */
.sidebar-scrim {
  position: fixed;
  inset: 0;
  z-index: 1390;
  background-color: rgba(20, 26, 23, 0.5);
  animation: fade-in 0.18s ease;
}

.scrim-enter-active,
.scrim-leave-active {
  transition: opacity 0.2s ease;
}

.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}

@media (max-width: 1023px) {
  .sidebar {
    width: min(var(--sidebar-w), 84vw);
    transform: translateX(-100%);
    box-shadow: var(--shadow-lg);
  }

  .sidebar.is-open {
    transform: translateX(0);
  }

  .sidebar.is-collapsed {
    width: min(var(--sidebar-w), 84vw);
  }

  .sidebar.is-collapsed .brand-text,
  .sidebar.is-collapsed .nav-label,
  .sidebar.is-collapsed .nav-section,
  .sidebar.is-collapsed .user-meta,
  .sidebar.is-collapsed .nav-badge {
    display: revert;
  }

  .collapse-toggle {
    display: none;
  }

  .drawer-close {
    display: inline-flex;
  }
}
</style>
