// 系统品牌名 store —— 由 sign-in-experience.page_title 驱动，默认 SupaOAuth。
// Admin Console 启动时调用 loadBrand() 一次，标题/footer 复用 brand.systemName。
import { getSignInExperience } from './api/client.js';

export const brand = $state({ systemName: 'SupaOAuth' });

let loaded = false;
export async function loadBrand() {
  if (loaded) return;
  loaded = true;
  try {
    const data = await getSignInExperience();
    if (data?.branding?.page_title) {
      brand.systemName = data.branding.page_title;
    }
  } catch {
    // 保留默认值，不阻断后台渲染
  }
}
