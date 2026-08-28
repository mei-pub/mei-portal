'use client';

import { useState } from 'react';
import { SettingsPage, SettingsTabs } from '@/components/SettingsUI';
import TvSettings from './TvSettings';
import TvSources from './TvSources';

export default function TvCombined() {
  const [tab, setTab] = useState('settings');
  return (
    <SettingsPage
      icon="lucide:tv"
      title="影视设置"
      description="搜索偏好、播放优化与影视源管理。"
    >
      <SettingsTabs
        items={[
          { id: 'settings', label: '基础设置', icon: 'lucide:settings' },
          { id: 'sources', label: '影视源', icon: 'lucide:database' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'settings' ? <TvSettings /> : <TvSources />}
    </SettingsPage>
  );
}
