<!-- src/views/AuthView.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppIcon from '@/components/ui/AppIcon.vue';
import BrandMark from '@/components/ui/BrandMark.vue';
import { supabase } from '@/supabase/client';

type MessageType = 'error' | 'success';

const email = ref<string>('');
const password = ref<string>('');
const message = ref<string>('');
const messageType = ref<MessageType>('success');
const isLoading = ref<boolean>(false);
const showPassword = ref<boolean>(false);
const loginForm = ref<HTMLFormElement | null>(null);
const router = useRouter();

const messageIcon = computed(() => (messageType.value === 'error' ? 'alertCircle' : 'checkCircle'));

function setMessage(text: string, type: MessageType): void {
  message.value = text;
  messageType.value = type;
}

/**
 * Register sits outside the form element, so surface the browser's native
 * validity feedback before calling `handleRegister`.
 */
function handleRegisterClick(): void {
  if (!loginForm.value?.reportValidity())
    return;
  handleRegister();
}

async function handleLogin(): Promise<void> {
  isLoading.value = true;
  message.value = '';
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    });
    if (error)
      throw error;
    router.push('/');
  }
  catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    setMessage(`เกิดข้อผิดพลาด: ${errorMessage}`, 'error');
  }
  finally {
    isLoading.value = false;
  }
}

async function handleRegister(): Promise<void> {
  isLoading.value = true;
  message.value = '';
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.value.trim(),
      password: password.value,
    });
    if (error)
      throw error;

    // Only navigate if a session/user is present (email confirmation may be required)
    if (data?.session || data?.user) {
      router.push('/');
    }
    else {
      setMessage('ลงทะเบียนสำเร็จ! กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชีของคุณก่อนเข้าสู่ระบบ', 'success');
    }
  }
  catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    setMessage(`เกิดข้อผิดพลาด: ${errorMessage}`, 'error');
  }
  finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <!-- Brand panel -->
    <section class="auth-brand">
      <div class="brand-head">
        <BrandMark :size="40" />
        <span class="brand-word">Tracker</span>
      </div>

      <div class="brand-copy">
        <h1>ติดตามใบสั่งซื้อ ยาและเวชภัณฑ์</h1>
        <p>
          จากรายการนำเข้า ถึงวันรับของ - ทุกคำสั่งซื้อมีสถานะ
          มีวันที่ และมีประวัติให้ตรวจสอบเสมอ
        </p>

        <ul class="brand-points">
          <li>
            <AppIcon name="fileSpreadsheet" :size="17" />
            นำเข้ารายการสั่งซื้อจากไฟล์ CSV
          </li>
          <li>
            <AppIcon name="truck" :size="17" />
            ติดตามสถานะตั้งแต่สั่งซื้อถึงวันรับของ
          </li>
          <li>
            <AppIcon name="send" :size="17" />
            แจ้งเตือนทุกคำสั่งซื้อผ่าน Telegram ทันที
          </li>
        </ul>
      </div>

      <p class="brand-foot">
        งานเภสัชกรรม · โรงพยาบาลสระโบสถ์
      </p>
    </section>

    <!-- Form panel -->
    <section class="auth-panel">
      <div class="auth-card">
        <header class="auth-head">
          <h2>เข้าสู่ระบบ</h2>
          <p>ใช้บัญชีอีเมลของหน่วยงานเพื่อดำเนินการต่อ</p>
        </header>

        <div
          v-if="message"
          class="alert"
          :class="messageType === 'error' ? 'alert-error' : 'alert-success'"
          :role="messageType === 'error' ? 'alert' : 'status'"
        >
          <AppIcon :name="messageIcon" :size="17" />
          <span>{{ message }}</span>
        </div>

        <form ref="loginForm" class="auth-form" @submit.prevent="handleLogin">
          <div class="form-group">
            <label class="form-label" for="email">อีเมล</label>
            <input
              id="email"
              v-model="email"
              type="email"
              class="form-input"
              placeholder="name@hospital.go.th"
              autocomplete="email"
              required
            >
          </div>

          <div class="form-group">
            <label class="form-label" for="password">รหัสผ่าน</label>
            <div class="input-wrap">
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                class="form-input password-input"
                placeholder="••••••••"
                autocomplete="current-password"
                required
              >
              <span class="input-suffix">
                <button
                  type="button"
                  class="btn btn-subtle btn-icon btn-sm"
                  :aria-label="showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'"
                  @click="showPassword = !showPassword"
                >
                  <AppIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="16" />
                </button>
              </span>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="isLoading">
            <span v-if="isLoading" class="spinner spinner-sm" />
            {{ isLoading ? 'กำลังดำเนินการ...' : 'เข้าสู่ระบบ' }}
          </button>
        </form>

        <div class="auth-divider">
          <span>ยังไม่มีบัญชี?</span>
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-block"
          :disabled="isLoading"
          @click="handleRegisterClick"
        >
          สมัครใช้งานใหม่
        </button>
      </div>

      <p class="auth-note">
        ระบบภายในสำหรับเจ้าหน้าที่เท่านั้น
      </p>
    </section>
  </div>
</template>

<style scoped>
.auth-page {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  min-height: 100vh;
  background-color: var(--bg);
}

/* ─── Brand panel ─── */
.auth-brand {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2rem;
  padding: 3rem;
  overflow: hidden;
  background:
    radial-gradient(42rem 24rem at 88% -8%, rgba(255, 203, 154, 0.22), transparent 60%),
    radial-gradient(30rem 22rem at -12% 108%, rgba(209, 232, 226, 0.16), transparent 55%),
    linear-gradient(158deg, var(--teal-600) 0%, var(--teal-700) 38%, var(--charcoal-900) 100%);
  color: var(--mint-100);
}

.brand-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-word {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.brand-copy {
  max-width: 30rem;
}

.brand-copy h1 {
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.brand-copy p {
  margin-top: 1rem;
  color: rgba(230, 242, 239, 0.82);
  font-size: 1.05rem;
}

.brand-points {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 2.25rem;
  list-style: none;
}

.brand-points li {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  color: rgba(230, 242, 239, 0.92);
  font-size: var(--text-md);
}

.brand-points .icon {
  padding: 0.3rem;
  box-sizing: content-box;
  border-radius: var(--radius-sm);
  background-color: rgba(255, 203, 154, 0.16);
  color: var(--peach-300);
}

.brand-foot {
  color: rgba(230, 242, 239, 0.6);
  font-size: var(--text-sm);
  letter-spacing: 0.02em;
}

/* ─── Form panel ─── */
.auth-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem 1.5rem;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  padding: 2rem;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.auth-head h2 {
  font-size: var(--text-xl);
}

.auth-head p {
  margin-top: 0.35rem;
  margin-bottom: 1.5rem;
  color: var(--text-2);
  font-size: var(--text-base);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  margin-top: 1.25rem;
}

.password-input {
  padding-right: 2.75rem;
}

.btn-primary .spinner-sm {
  border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  border-top-color: var(--on-primary);
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.5rem 0 1rem;
  color: var(--text-3);
  font-size: var(--text-xs);
}

.auth-divider::before,
.auth-divider::after {
  content: '';
  height: 1px;
  flex-grow: 1;
  background-color: var(--border);
}

.auth-note {
  color: var(--text-3);
  font-size: var(--text-xs);
}

/* ─── Responsive ─── */
@media (max-width: 900px) {
  .auth-page {
    grid-template-columns: 1fr;
  }

  .auth-brand {
    padding: 1.5rem 1.25rem;
    gap: 1rem;
  }

  .brand-copy h1 {
    font-size: 1.4rem;
  }

  .brand-copy p,
  .brand-points {
    display: none;
  }

  .brand-foot {
    display: none;
  }

  .auth-panel {
    justify-content: flex-start;
    padding-top: 0.5rem;
  }
}
</style>
