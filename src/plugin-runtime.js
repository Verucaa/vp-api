let runtime = {
  safeFetch: async () => { throw new Error("Runtime helper belum dikonfigurasi"); },
  assertPublicHttpUrl: async () => { throw new Error("Runtime helper belum dikonfigurasi"); }
};

export const configurePluginRuntime = (nextRuntime) => {
  if (!nextRuntime || typeof nextRuntime.safeFetch !== "function" || typeof nextRuntime.assertPublicHttpUrl !== "function") {
    throw new TypeError("Implementasi runtime plugin tidak lengkap");
  }
  runtime = nextRuntime;
};

export const safeFetch = (...args) => runtime.safeFetch(...args);
export const assertPublicHttpUrl = (...args) => runtime.assertPublicHttpUrl(...args);
