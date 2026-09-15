import { requiredElement, requiredInput, htmlElements, errorRecord, textValue } from "./dom.js";

  window.__SUPAOAUTH_POST_LOGOUT_REDIRECT__ = null;
  const status = requiredElement("#status", "p");

  function clearHostedSessionStorage() {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        storage.removeItem('supaoauth.hosted.auth.session');
      } catch {
        // 浏览器隐私模式可能禁用 Storage；GoTrue 撤销仍由 signOut 完成。
      }
    }
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
      ({ error } = await hostedAuth.signOut({ scope: 'local' }));
    } catch (caughtError) {
      error = caughtError;
    }
    clearHostedSessionStorage();
    const details = errorRecord(error);
    const sessionAlreadyMissing = error && (details["status"] === 401 || details["name"] === 'AuthSessionMissingError');
    if (error && !sessionAlreadyMissing) {
      status.className = 'error';
      status.textContent = textValue(details["message"], '认证服务未能完成退出，请重试。');
      return;
    }
    window.location.replace(window.__SUPAOAUTH_POST_LOGOUT_REDIRECT__ ?? '/oauth/authorize');
  }

  signOut();
