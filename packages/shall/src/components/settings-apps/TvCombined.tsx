'use client';

import { useEffect, useState } from 'react';
import { Pill, SettingsButton, SettingsPage, SettingsTabs } from '@/components/SettingsUI';
import TvSettings, { TV_DEFAULTS, loadTvSettings, type TvFormState } from './TvSettings';
import TvSources from './TvSources';

export default function TvCombined() {
  const [tab, setTab] = useState('settings');
  const [form, setForm] = useState<TvFormState>(TV_DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setForm(loadTvSettings()), []);

  function save() {
    localStorage.setItem('defaultAggregateSearch', JSON.stringify(form.defaultAggregateSearch));
    localStorage.setItem('fluidSearch', JSON.stringify(form.fluidSearch));
    localStorage.setItem('enableOptimization', JSON.stringify(form.enableOptimization));
    localStorage.setItem('liveDirectConnect', JSON.stringify(form.liveDirectConnect));
    localStorage.setItem('doubanDataSource', form.doubanDataSource);
    localStorage.setItem('doubanProxyUrl', form.doubanProxyUrl);
    localStorage.setItem('doubanImageProxyType', form.doubanImageProxyType);
    localStorage.setItem('doubanImageProxyUrl', form.doubanImageProxyUrl);
    setDirty(false);
    setMessage('影视设置已保存');
  }

  function reset() {
    setForm(TV_DEFAULTS);
    setDirty(true);
    setMessage('已恢复默认值，尚未保存');
  }

  function update(next: TvFormState) {
    setForm(next);
    setDirty(true);
    setMessage('');
  }

  return (
    <SettingsPage
      icon="lucide:tv"
      title="影视设置"
      description="搜索偏好、播放优化与影视源管理。"
      actions={tab === 'settings' ? (
        <>
          {message || dirty ? (
            <Pill tone={message && !dirty ? 'success' : 'warning'}>
              {message || '有未保存修改'}
            </Pill>
          ) : null}
          <SettingsButton onClick={reset}>恢复默认</SettingsButton>
          <SettingsButton variant="primary" onClick={save}>保存设置</SettingsButton>
        </>
      ) : undefined}
      tabs={
        <SettingsTabs
          items={[
            { id: 'settings', label: '基础设置', icon: 'lucide:settings' },
            { id: 'sources', label: '影视源', icon: 'lucide:database' },
          ]}
          active={tab}
          onChange={setTab}
        />
      }
    >
      {tab === 'settings' ? <TvSettings form={form} onChange={update} /> : <TvSources />}
    </SettingsPage>
  );
}
