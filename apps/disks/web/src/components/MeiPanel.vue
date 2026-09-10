<script setup lang="ts">
// mei-portal：左侧窄浮动面板（全应用统一：Logo + 纵向名称 + 图标入口）
// 网盘搜索：入口仅「搜索」一项；折叠态为左缘小把手；localStorage 记忆
import { ref, onMounted } from 'vue';

const emit = defineEmits<{
  (e: 'navigate-search'): void;
}>();

const STORE_KEY = 'mei-float-pansou';
const open = ref(true);

onMounted(() => {
  try {
    open.value = localStorage.getItem(STORE_KEY) !== '1';
  } catch {
    open.value = true;
  }
});

const toggle = (next: boolean) => {
  open.value = next;
  try {
    localStorage.setItem(STORE_KEY, next ? '0' : '1');
  } catch {
    // ignore
  }
};
</script>

<template>
  <!-- 收起态：紧贴左缘的渐变小把手 -->
  <button
    v-if="!open"
    class="mei-panel-handle"
    title="展开面板"
    @click="toggle(true)"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  </button>

  <!-- 展开态：窄面板 -->
  <nav v-else class="mei-panel">
    <button class="p-info" title="网盘搜索" @click="emit('navigate-search')">
      <span class="p-logo">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </span>
      <span class="p-name">网盘搜索</span>
    </button>
    <div class="p-divider"></div>
    <button class="p-item active" title="搜索" @click="emit('navigate-search')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    </button>
    <div class="p-divider"></div>
    <button class="p-collapse" title="收起面板" @click="toggle(false)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
    </button>
  </nav>
</template>

<style scoped>
.mei-panel {
  position: fixed;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(23, 32, 56, 0.10);
  box-shadow: 0 8px 28px rgba(23, 32, 56, 0.10);
  backdrop-filter: blur(22px) saturate(1.5);
  -webkit-backdrop-filter: blur(22px) saturate(1.5);
}
.p-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 2px;
  border: none;
  background: transparent;
  border-radius: 16px;
  cursor: pointer;
  transition: background 0.15s;
}
.p-info:hover { background: rgba(23, 32, 56, 0.05); }
.p-logo {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 55%, #ec4899 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
}
.p-name {
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  line-height: 1;
  color: #1c2333;
  max-height: 96px;
  overflow: hidden;
  user-select: none;
}
.p-divider { width: 24px; height: 1px; background: rgba(23, 32, 56, 0.10); }
.p-item {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 12px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5d6778;
  cursor: pointer;
  transition: all 0.15s;
}
.p-item svg { width: 15px; height: 15px; }
.p-item:hover { background: rgba(23, 32, 56, 0.05); color: #6366f1; }
.p-item.active {
  background: linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(168,85,247,0.10) 55%, rgba(236,72,153,0.10) 100%);
  color: #6366f1;
}
.p-collapse {
  width: 34px;
  height: 24px;
  border: none;
  border-radius: 8px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #98a1b3;
  cursor: pointer;
  transition: all 0.15s;
}
.p-collapse:hover { background: rgba(23, 32, 56, 0.05); }
.p-collapse svg { width: 14px; height: 14px; }
.mei-panel-handle {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 60;
  width: 20px;
  height: 56px;
  border: none;
  border-radius: 0 10px 10px 0;
  background: linear-gradient(180deg, #6366f1, #a855f7);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 28px rgba(23, 32, 56, 0.10);
  transition: width 0.15s;
}
.mei-panel-handle:hover { width: 28px; }
</style>
