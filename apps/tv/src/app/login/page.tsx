'use client';
// mei-portal 统一身份：本应用自身的登录页已废弃，登录一律由门户根路径 /login 承载
// （middleware 对未认证页面请求也是跳门户 /login）。此路由保留仅为兼容旧书签/外链，
// 进入即转发到门户登录页；必须用 window.location 走绝对根路径——basePath=/tv 下
// next/router 的 '/login' 会被拼回 /tv/login 造成自跳循环。

import { useEffect } from 'react';

export default function LoginPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    const target =
      redirect && redirect.startsWith('/')
        ? `/login?redirect=${encodeURIComponent(redirect)}`
        : '/login';
    window.location.replace(target);
  }, []);

  return (
    <div className='flex min-h-screen items-center justify-center text-sm text-gray-500'>
      正在跳转到门户登录页…
    </div>
  );
}
