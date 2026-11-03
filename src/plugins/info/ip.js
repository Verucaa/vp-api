export default {
  name: "IP Pengunjung",
  category: "info",
  description: "Mengembalikan alamat IP koneksi yang dilihat oleh backend ini saja.",
  method: ["GET"],
  hidden: true,
  params: {},
  execute: async (req) => ({
    client_ip: req.wolfClientIp || req.ip || req.socket?.remoteAddress || "unknown"
  })
};
