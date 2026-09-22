import { BrowserRouter, useRoutes } from 'react-router-dom';
import routesConfig from '../config/routesConfig';
import Navbar from './Navbar';
import MeiPanel from './MeiPanel';
import { Suspense, useState, useEffect } from 'react';
import Loading from './Loading';
import { CssBaseline, Theme, ThemeProvider } from '@mui/material';
import { CustomSnackBarProvider } from '../contexts/CustomSnackBarContext';
import { SnackbarProvider } from 'notistack';
import { tools } from '../tools';
import './index.css';
import { darkTheme, lightTheme } from '../config/muiConfig';
import ScrollToTopButton from './ScrollToTopButton';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { UserTypeFilterProvider } from 'providers/UserTypeFilterProvider';

export type Mode = 'dark' | 'light' | 'system';

const AppRoutes = () => {
  const updatedRoutesConfig = [...routesConfig];
  tools.forEach((tool) => {
    updatedRoutesConfig.push({ path: tool.path, element: tool.component() });
  });
  return useRoutes(updatedRoutesConfig);
};

function App() {
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem('theme') || 'system') as Mode
  );
  const [theme, setTheme] = useState<Theme>(() => getTheme(mode));
  useEffect(() => setTheme(getTheme(mode)), [mode]);

  // 仅当用户未显式选择主题（mode 为 system）时才跟随系统深浅色，
  // 否则系统切换会覆盖用户的显式选择
  useEffect(() => {
    if (mode !== 'system') return;
    const systemDarkModeQuery = window.matchMedia(
      '(prefers-color-scheme: dark)'
    );
    const handleThemeChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? darkTheme : lightTheme);
    };
    // 进入 system 模式时先按当前系统值对齐一次
    setTheme(systemDarkModeQuery.matches ? darkTheme : lightTheme);
    systemDarkModeQuery.addEventListener('change', handleThemeChange);

    return () => {
      systemDarkModeQuery.removeEventListener('change', handleThemeChange);
    };
  }, [mode]);

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SnackbarProvider
          maxSnack={5}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right'
          }}
        >
          <CustomSnackBarProvider>
            <UserTypeFilterProvider>
              <BrowserRouter basename={import.meta.env.BASE_URL}>
                <Navbar
                  mode={mode}
                  onChangeMode={() => {
                    // 必须基于 setMode 的 prev 计算：用渲染闭包里的旧 mode 写存储，
                    // 快速连点时会写入漂移的旧值
                    setMode((prev) => {
                      const next = nextMode(prev);
                      try {
                        localStorage.setItem('theme', next);
                      } catch {
                        // localStorage 不可用时仅切换主题
                      }
                      return next;
                    });
                  }}
                />
                <MeiPanel />
                <Suspense fallback={<Loading />}>
                  <AppRoutes />
                </Suspense>
              </BrowserRouter>
            </UserTypeFilterProvider>
          </CustomSnackBarProvider>
        </SnackbarProvider>
        <ScrollToTopButton />
      </ThemeProvider>
    </I18nextProvider>
  );
}

function getTheme(mode: Mode): Theme {
  switch (mode) {
    case 'dark':
      return darkTheme;
    case 'light':
      return lightTheme;
    default:
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? darkTheme
        : lightTheme;
  }
}

function nextMode(mode: Mode): Mode {
  return mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
}

export default App;
