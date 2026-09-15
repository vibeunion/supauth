import { createApplication, getProject, getBrandingAsset, listUsers, uploadFile } from "./client.js";

type Assert<T extends true> = T;
type IsUnchecked<T> = 0 extends (1 & T) ? true : false;
export type ProjectIsChecked = Assert<IsUnchecked<Awaited<ReturnType<typeof getProject>>> extends false ? true : false>;
export type ProjectHasName = Assert<Awaited<ReturnType<typeof getProject>>["name"] extends string ? true : false>;
export type UserIdIsString = Assert<Awaited<ReturnType<typeof listUsers>>["items"][number]["id"] extends string ? true : false>;
export type BrandingIsBlob = Assert<Awaited<ReturnType<typeof getBrandingAsset>> extends Blob ? true : false>;

export function verifyAdminInputs(): void {
  void createApplication({ redirect_uris: ["https://app.example.test/callback"] });
  void listUsers({ page: 1, limit: 25 }, { signal: new AbortController().signal, timeoutMs: 100 });
  // @ts-expect-error: 输入类型必须来自对应 endpoint 的 schema。
  void createApplication({ redirect_uris: [123] });
  // @ts-expect-error: 分页字段不是任意字符串。
  void listUsers({ limit: "25" });
  // @ts-expect-error: 请求取消信号不能混入 query。
  void listUsers({ signal: new AbortController().signal });
  // @ts-expect-error: 上传不能接受未授权 bucket。
  void uploadFile("private", "logo.png", new Blob(), "image/png");
}
