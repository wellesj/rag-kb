import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // 避免上层目录 lockfile 被误判为 monorepo root
  turbopack: {
    root: path.join(__dirname),
  },
  // 允许用局域网 IP 打开开发站时的 HMR / 静态资源（否则按钮像点不动）
  allowedDevOrigins: ["192.168.1.6", "localhost", "127.0.0.1"],
  // P6 生产部署：standalone 输出（配合 Dockerfile，极小运行时镜像）
  output: "standalone",
};

export default nextConfig;
