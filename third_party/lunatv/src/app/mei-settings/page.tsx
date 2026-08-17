'use client';

// mei-allin 集成：影视设置独立页（门户设置集成页 iframe 深链入口）
// 复用 UserMenu 内的设置面板，挂载即自动打开；关闭后可点击按钮重新打开
// 管理面板入口：原顶栏用户菜单已移除，这里补上（单密码模式下已登录即可访问）
import { useState } from 'react';

import { UserMenu } from '@/components/UserMenu';

export default function MeiSettingsPage() {
  const [reopenKey, setReopenKey] = useState(0);

  return (
    <div className='w-full min-h-screen bg-white dark:bg-black flex flex-col items-center justify-center gap-6 p-6'>
      <UserMenu key={reopenKey} autoOpenSettings hideTrigger />
      <div className='text-center'>
        <p className='text-sm text-gray-500 mb-3'>影视设置</p>
        <div className='flex items-center justify-center gap-3'>
          <button
            onClick={() => setReopenKey((k) => k + 1)}
            className='px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors'
          >
            打开设置
          </button>
          <a
            href='/tv/admin'
            className='px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors'
          >
            管理面板
          </a>
        </div>
      </div>
    </div>
  );
}
