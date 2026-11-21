import { requiredElement, errorRecord, textValue } from "./dom.js";

  window.__SUPAOAUTH_POST_LOGOUT_REDIRECT__ = null;
  const status = requiredElement("#status", "p");

  function clearHostedSessionStorage(): boolean {
    let cleared = true;
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      try {
        const storage = window[name];
        storage.removeItem('supaoauth.hosted.auth.session');
        if (storage.getItem('supaoauth.hosted.auth.session')) cleared = false;
      } catch {
        // 无法确认旧会话已移除时不能跳转，以免登录页重新读取残留状态。
        cleared = false;
      }
    }
    return cleared;
  }

  async function signOut() {
    const hostedAuth = window.SupaOAuthHostedAuth;
    if (!hostedAuth) {
      clearHostedSessionStorage();
      status.className = 'error';
      status.textContent = '退出组件加载失败，请刷新页面后重试。';
      return;
    }
    let error: unknown;
    try {
      // 退出页承诺的是「撤销当前 SupAuth 会话」：local 只清浏览器令牌，服务端会话仍然有效，
      // 下一次授权会被直接带回账号中心，无法切换账号，因此这里使用 global。
      ({ error } = await hostedAuth.signOut({ scope: 'global' }));
    } catch (caughtError) {
      error = caughtError;
    }
    const storageCleared = clearHostedSessionStorage();
    const details = errorRecord(error);
    const sessionAlreadyMissing = error && (details["status"] === 401 || details["name"] === 'AuthSessionMissingError');
    if (error && !sessionAlreadyMissing) {
      status.className = 'error';
      status.textContent = textValue(details["message"], '认证服务未能完成退出，请重试。');
      return;
    }
    if (!storageCleared) {
      status.className = 'error';
      status.textContent = '浏览器中的旧登录状态未能清理，请检查站点存储权限后重试。';
      return;
    }
    window.location.replace(window.__SUPAOAUTH_POST_LOGOUT_REDIRECT__ ?? '/oauth/authorize');
  }

  signOut();
