declare module "@alicloud/pop-core" {
  interface CoreOptions {
    accessKeyId: string;
    accessKeySecret: string;
    endpoint: string;
    apiVersion: string;
  }
  export default class Core {
    constructor(opts: CoreOptions);
    request<T = unknown>(
      action: string,
      params: Record<string, unknown>,
      opts: { method: string },
    ): Promise<T>;
  }
}
