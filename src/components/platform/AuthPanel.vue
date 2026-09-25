<template>
  <view class="auth-card panel">
    <text class="eyebrow">YOUR MIND, YOUR SPACE</text>
    <h1>
      {{
        view === 'login'
          ? tr('欢迎回来', 'Welcome back')
          : view === 'register'
            ? tr('建立你的数字空间', 'Create your digital space')
            : tr('重置密码', 'Reset password')
      }}
    </h1>
    <p class="muted">
      {{
        view === 'login'
          ? tr('使用邮箱和密码登录，继续你的对话。', 'Sign in with your email and password.')
          : tr(
              '验证码将发送到你的邮箱，10 分钟内有效。',
              'A verification code will be emailed to you and is valid for 10 minutes.',
            )
      }}
    </p>
    <n-form @submit.prevent="run(submitAuth)">
      <n-label>
        {{ tr('邮箱', 'Email') }}
        <n-input
          v-model="credentials.email"
          type="email"
          autocomplete="email"
          required
          placeholder="you@example.com"
        />
      </n-label>
      <n-label v-if="view === 'register'">
        {{ tr('显示名称', 'Display name') }}
        <n-input v-model="credentials.display_name" maxlength="80" required />
      </n-label>
      <view v-if="view !== 'login'" class="row">
        <n-label class="grow">
          {{ tr('邮箱验证码', 'Verification code') }}
          <n-input v-model="credentials.code" inputmode="numeric" maxlength="6" />
        </n-label>
        <n-button
          type="button"
          class="small"
          :disabled="busy || cooldown > 0"
          @click="run(requestCode)"
        >
          {{
            cooldown > 0
              ? tr(`${cooldown}s 后重发`, `Resend in ${cooldown}s`)
              : tr('发送验证码', 'Send code')
          }}
        </n-button>
      </view>
      <n-label>
        {{
          view === 'login'
            ? tr('密码', 'Password')
            : tr(
                '设置新密码（8–128 位，包含字母和数字）',
                'New password (8–128 characters, letters and digits)',
              )
        }}
        <n-input
          v-model="credentials.password"
          type="password"
          :autocomplete="view === 'login' ? 'current-password' : 'new-password'"
          required
          maxlength="128"
        />
      </n-label>
      <n-label v-if="view !== 'login'">
        {{ tr('确认密码', 'Confirm password') }}
        <n-input
          v-model="credentials.confirm"
          type="password"
          autocomplete="new-password"
          required
        />
      </n-label>
      <n-button class="primary full" :disabled="busy" type="submit">
        {{
          view === 'login'
            ? tr('登录', 'Sign in')
            : view === 'register'
              ? tr('完成注册', 'Register')
              : tr('重置密码', 'Reset password')
        }}
      </n-button>
    </n-form>
    <view class="row spaced">
      <n-button class="link" @click="go(view === 'register' ? 'login' : 'register')">
        {{
          view === 'register'
            ? tr('已有账号，去登录', 'Already registered? Sign in')
            : tr('注册新账号', 'Create an account')
        }}
      </n-button>
      <n-button class="link" @click="go(view === 'reset' ? 'login' : 'reset')">
        {{
          view === 'reset' ? tr('返回登录', 'Back to sign in') : tr('忘记密码', 'Forgot password')
        }}
      </n-button>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, onUnmounted } from 'vue';
import { usePageUi } from '../../composables/usePageUi.js';
import { api, setSession } from '../../services/platform.js';
import { tr } from '../../services/locale.js';
import { validatePassword } from '../../services/account.js';
import { navigate, navigateUrl, safeReturnTo, paths } from '../../services/navigation.mjs';
import { NInput, NButton, NForm, NLabel } from '../native.js';
const props = defineProps({ pageName: String, query: Object });
const view = computed(() => props.pageName);
const { busy, run, notify } = usePageUi();
const credentials = ref({
  email: '',
  password: '',
  confirm: '',
  display_name: '',
  code: '',
  challenge_id: '',
});
const cooldown = ref(0);
let timer;
onUnmounted(() => clearInterval(timer));
const returnQuery = () =>
  props.query.returnTo ? { returnTo: safeReturnTo(props.query.returnTo) } : {};
const go = (page) => navigate(page, returnQuery());
async function requestCode() {
  const result = await api('/auth/email-codes', {
    method: 'POST',
    body: {
      email: credentials.value.email,
      purpose: view.value === 'register' ? 'register' : 'reset_password',
    },
  });
  credentials.value.challenge_id = result.challenge_id;
  cooldown.value = 60;
  clearInterval(timer);
  timer = setInterval(() => {
    if (--cooldown.value <= 0) clearInterval(timer);
  }, 1000);
  notify(
    tr('验证码请求已受理，请检查邮箱', 'Verification code requested. Please check your inbox.'),
  );
}
async function submitAuth() {
  const value = credentials.value;
  if (view.value !== 'login') {
    validatePassword(value.password);
    if (value.password !== value.confirm)
      throw new Error(tr('两次输入的密码不一致', 'Passwords do not match'));
  }
  if (view.value === 'login') {
    const state = await api('/auth/login', { method: 'POST', body: value });
    value.password = '';
    setSession(state);
    await navigateUrl(safeReturnTo(props.query.returnTo, paths.mine), true);
  } else {
    await api(view.value === 'register' ? '/auth/register' : '/auth/reset-password', {
      method: 'POST',
      body: value,
    });
    value.password = '';
    value.confirm = '';
    await navigate('login', returnQuery(), true);
  }
}
</script>
