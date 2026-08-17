'use client';

// mei-allin 集成：影视设置独立页（门户设置集成页 iframe 深链入口）
// 复用 UserMenu 内的设置面板，挂载即自动打开；关闭后可点击按钮重新打开
import { useState } from 'react';

import { UserMenu } from '@/components/UserMenu';

export default function MeiSettingsPage() {
  const [reopenKey, setReopenKey] = useState(0);

  return (
    <div className='w-full min-h-screen bg-white dark:bg-black flex flex-col items-center justify-center gap-6 p-6'>
      <UserMenu key={reopenKey} autoOpenSettings hideTrigger />
      <div className='text-center'>
        <p className='text-sm text-gray-500 mb-3'>影视设置</p>
        <button
          onClick={() => setReopenKey((k) => k + 1)}
          className='px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors'
        >
          打开设置
        </button>
      </div>
    </div>
  );
}
